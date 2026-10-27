/**
 * @fileoverview Lint rule: no-self-assignment
 *
 * Disallows assignments where both the left-hand side and right-hand side
 * are identical (e.g. `x = x`, `obj.prop = obj.prop`).
 * Self-assignment is almost always a typo or an incomplete refactoring.
 *
 * @see {@link import("../../types/lint.js").LintRule}
 */

const STATEMENT_LEFT_BOUNDARIES = new Set([
  ";", "{", "}", "var", "return", "if", "while", "for", "\n"
]);

const STATEMENT_RIGHT_BOUNDARIES = new Set([
  ";", ",", "{", "}"
]);

/**
 * Extracts sequence of syntax tokens for the left operand of an assignment.
 * @param {readonly import("../../types/ast.js").Token[]} tokens
 * @param {number} assignIndex
 * @returns {import("../../types/ast.js").Token[] | null}
 */
function extractAssignLeft(tokens, assignIndex) {
  const result = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = assignIndex - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token.channel !== "syntax") continue;

    if (token.text === ")") { parenDepth++; result.unshift(token); continue; }
    if (token.text === "]") { bracketDepth++; result.unshift(token); continue; }
    if (token.text === "}") { braceDepth++; result.unshift(token); continue; }

    if (token.text === "(") {
      if (parenDepth > 0) { parenDepth--; result.unshift(token); continue; }
      break;
    }
    if (token.text === "[") {
      if (bracketDepth > 0) { bracketDepth--; result.unshift(token); continue; }
      break;
    }
    if (token.text === "{") {
      if (braceDepth > 0) { braceDepth--; result.unshift(token); continue; }
      break;
    }

    if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      if (STATEMENT_LEFT_BOUNDARIES.has(token.text)) break;
      if (token.line < tokens[assignIndex].line) break;
    }

    result.unshift(token);
  }

  // Must consist only of valid assignable expression tokens (identifiers, dots, index brackets)
  if (result.length === 0) return null;
  const isLValue = result.every(
    (t) => t.kind === "IDENTIFIER" || t.text === "." || t.text === "[" || t.text === "]" || t.kind.endsWith("_LIT")
  );
  return isLValue ? result : null;
}

/**
 * Extracts sequence of syntax tokens for the right operand of an assignment up to statement end.
 * @param {readonly import("../../types/ast.js").Token[]} tokens
 * @param {number} assignIndex
 * @returns {import("../../types/ast.js").Token[] | null}
 */
function extractAssignRight(tokens, assignIndex) {
  const result = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = assignIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.channel !== "syntax") continue;

    if (token.text === "(") { parenDepth++; result.push(token); continue; }
    if (token.text === "[") { bracketDepth++; result.push(token); continue; }
    if (token.text === "{") { braceDepth++; result.push(token); continue; }

    if (token.text === ")") {
      if (parenDepth > 0) { parenDepth--; result.push(token); continue; }
      break;
    }
    if (token.text === "]") {
      if (bracketDepth > 0) { bracketDepth--; result.push(token); continue; }
      break;
    }
    if (token.text === "}") {
      if (braceDepth > 0) { braceDepth--; result.push(token); continue; }
      break;
    }

    if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      if (STATEMENT_RIGHT_BOUNDARIES.has(token.text)) break;
      // Also stop at next line if next statement starts
      const prev = result.at(-1);
      if (prev && token.line > prev.line) {
        break;
      }
    }

    result.push(token);
  }

  return result.length > 0 ? result : null;
}

/**
 * Checks if two token sequences are structurally identical.
 * @param {import("../../types/ast.js").Token[]} left
 * @param {import("../../types/ast.js").Token[]} right
 * @returns {boolean}
 */
function areTokensIdentical(left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i].text !== right[i].text) return false;
  }
  return true;
}

/**
 * Recursively collects [start, end] ranges of node kinds that should be excluded from self-assignment checks.
 * (e.g. Signature default params, Enums, Struct initializers).
 * @param {import("../../types/ast.js").SyntaxNode} node
 * @param {Set<string>} excludedKinds
 * @param {Array<{ start: number, end: number }>} [ranges]
 * @returns {Array<{ start: number, end: number }>}
 */
function collectExcludedRanges(node, excludedKinds, ranges = []) {
  if (excludedKinds.has(node.kind)) {
    ranges.push({ start: node.start, end: node.end });
  }
  for (const child of node.children ?? []) {
    collectExcludedRanges(child, excludedKinds, ranges);
  }
  return ranges;
}

const EXCLUDED_KINDS = new Set(["Signature", "FunctionTypeSignature", "EnumDeclaration"]);

/** @type {import("../../types/lint.js").LintRule} */
export const noSelfAssignment = {
  id: "no-self-assignment",
  description: "Disallow assignments where both sides are identical.",
  defaultSeverity: "error",

  create(context) {
    let excludedRanges = [];

    return {
      File(node) {
        excludedRanges = collectExcludedRanges(node, EXCLUDED_KINDS);
      },

      "File:exit"() {
        const syntaxTokens = context.tokens.filter((t) => t.channel === "syntax");

        for (let i = 0; i < syntaxTokens.length; i++) {
          const token = syntaxTokens[i];
          if (token.text !== "=") continue;

          // Ignore compound operators or comparisons that might be parsed
          const prev = syntaxTokens[i - 1];
          const next = syntaxTokens[i + 1];
          if (prev && (prev.text === ":" || prev.text === "+" || prev.text === "-" || prev.text === "*" || prev.text === "/" || prev.text === "%" || prev.text === "!" || prev.text === "<" || prev.text === ">" || prev.text === "=")) {
            continue;
          }
          if (next && next.text === "=") {
            continue;
          }

          // Skip if inside function signature or enum declaration
          const isExcluded = excludedRanges.some((r) => token.start >= r.start && token.end <= r.end);
          if (isExcluded) continue;

          const left = extractAssignLeft(syntaxTokens, i);
          const right = extractAssignRight(syntaxTokens, i);

          if (!left || !right) continue;

          if (areTokensIdentical(left, right)) {
            const operandText = left.map((t) => t.text).join("");
            context.report({
              start: left[0].start,
              end: right.at(-1).end,
              line: token.line,
              column: token.column,
              message: `Assigning '${operandText}' to itself is redundant.`,
            });
          }
        }
      },
    };
  },
};
