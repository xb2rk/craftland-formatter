/**
 * @fileoverview Lint rule: no-self-compare
 *
 * Disallows comparisons where both sides are identical (e.g. `x == x`, `a.b != a.b`).
 * Comparing an operand to itself is almost always a bug caused by copy-pasting code.
 *
 * @see {@link import("../../types/lint.js").LintRule}
 */

const COMPARISON_OPS = new Set(["==", "!=", "<", "<=", ">", ">="]);

const LEFT_BOUNDARIES = new Set([
  "&&", "||", ";", ",", "?", "=", ":=", "+=", "-=", "*=", "/=", "%=",
  "return", "var", "if", "while", "for", "{", "}"
]);

const RIGHT_BOUNDARIES = new Set([
  "&&", "||", ";", ",", "?", ":", "{", "}",
  "==", "!=", "<", "<=", ">", ">="
]);

/**
 * Extracts sequence of syntax tokens for the left operand of a comparison.
 * @param {readonly import("../../types/ast.js").Token[]} tokens
 * @param {number} opIndex
 * @returns {import("../../types/ast.js").Token[] | null}
 */
function extractLeftOperand(tokens, opIndex) {
  const result = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = opIndex - 1; i >= 0; i--) {
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
      if (LEFT_BOUNDARIES.has(token.text)) break;
    }

    result.unshift(token);
  }

  return result.length > 0 ? result : null;
}

/**
 * Extracts sequence of syntax tokens for the right operand of a comparison.
 * @param {readonly import("../../types/ast.js").Token[]} tokens
 * @param {number} opIndex
 * @returns {import("../../types/ast.js").Token[] | null}
 */
function extractRightOperand(tokens, opIndex) {
  const result = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = opIndex + 1; i < tokens.length; i++) {
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
      if (RIGHT_BOUNDARIES.has(token.text)) break;
    }

    result.push(token);
  }

  return result.length > 0 ? result : null;
}

/**
 * Checks if two token sequences are structurally identical in text.
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
 * Recursively collects [start, end] ranges of all nodes of a specific kind.
 * @param {import("../../types/ast.js").SyntaxNode} node
 * @param {string} targetKind
 * @param {Array<{ start: number, end: number }>} [ranges]
 * @returns {Array<{ start: number, end: number }>}
 */
function collectRangesOfKind(node, targetKind, ranges = []) {
  if (node.kind === targetKind) {
    ranges.push({ start: node.start, end: node.end });
  }
  for (const child of node.children ?? []) {
    collectRangesOfKind(child, targetKind, ranges);
  }
  return ranges;
}

/** @type {import("../../types/lint.js").LintRule} */
export const noSelfCompare = {
  id: "no-self-compare",
  description: "Disallow comparisons where both sides are identical.",
  defaultSeverity: "error",

  create(context) {
    const typeArgumentRanges = collectRangesOfKind(context.tree, "TypeArguments");

    return {
      File() {
        const syntaxTokens = context.tokens.filter((t) => t.channel === "syntax");

        for (let i = 0; i < syntaxTokens.length; i++) {
          const opToken = syntaxTokens[i];
          if (!COMPARISON_OPS.has(opToken.text)) continue;

          // Ignore '<' or '>' tokens that are part of generic TypeArguments (e.g. List<T>)
          if (opToken.text === "<" || opToken.text === ">") {
            const isInsideGeneric = typeArgumentRanges.some(
              (r) => opToken.start >= r.start && opToken.end <= r.end
            );
            if (isInsideGeneric) continue;

            // Also check if preceded by common generic container name (List, Map)
            const prev = syntaxTokens[i - 1];
            if (opToken.text === "<" && prev && ["List", "Map", "Set"].includes(prev.text)) {
              continue;
            }
          }

          const leftTokens = extractLeftOperand(syntaxTokens, i);
          const rightTokens = extractRightOperand(syntaxTokens, i);

          if (!leftTokens || !rightTokens) continue;

          if (areTokensIdentical(leftTokens, rightTokens)) {
            const leftText = leftTokens.map((t) => t.text).join("");
            const isEquality = opToken.text === "==";
            const message = isEquality
              ? `Comparing '${leftText}' to itself is always true.`
              : `Comparing '${leftText}' to itself with '${opToken.text}' is always redundant or false.`;

            context.report({
              start: leftTokens[0].start,
              end: rightTokens.at(-1).end,
              line: opToken.line,
              column: opToken.column,
              message,
            });
          }
        }
      },
    };
  },
};
