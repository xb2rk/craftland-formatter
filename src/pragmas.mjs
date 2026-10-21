/**
 * @fileoverview Collects lexical pragma markers (e.g. `// fc-format-ignore`,
 * `/* fc-format-ignore-start * /`) to determine verbatim-preserved source ranges
 * and report unmatched ignore markers as diagnostics.
 */

/** @typedef {import("./types/ast.d.ts").SyntaxNode} SyntaxNode */
/** @typedef {import("./types/ast.d.ts").Token} Token */

/**
 * Diagnostic produced when an ignore marker is improperly placed or unclosed.
 * @typedef {{
 *   phase: "pragma",
 *   code: "unmatched-ignore-marker",
 *   message: string,
 *   start: number,
 *   end: number,
 *   line: number,
 *   column: number
 * }} PragmaDiagnostic
 */

/**
 * A source range protected from formatting.
 * @typedef {{
 *   start: number,
 *   end: number,
 *   absolute?: boolean
 * }} ProtectedRange
 */

/** Token kinds representing line or block comments. */
const COMMENTS = new Set(["LINE_COMMENT", "COMMENT"]);

/** Grammar nodes that constitute complete top-level or block entries. */
const ENTRIES = new Set([
  "Import",
  "Graph",
  "Declaration",
  "Function",
  "EventListener",
  "Property",
  "Statement",
  "ControlFlow",
]);

/**
 * Find the 0-based character offset of the start of the line containing the given offset.
 *
 * @param {string} source - The source code text.
 * @param {number} offset - The target offset.
 * @returns {number}
 */
function lineStart(source, offset) {
  return source.lastIndexOf("\n", offset - 1) + 1;
}

/**
 * Anchor a span start to the beginning of the line if there is only whitespace preceding it.
 * This guarantees leading indentation whitespace is preserved verbatim along with the ignored block.
 *
 * @param {string} source - The source code text.
 * @param {number} offset - The starting offset of the protected node or comment.
 * @returns {number}
 */
function anchoredStart(source, offset) {
  const start = lineStart(source, offset);
  const leadingWhitespaceOnly = /^[ \t]*$/.test(source.slice(start, offset));

  return leadingWhitespaceOnly ? start : offset;
}

/**
 * Collect protected source ranges governed by pragma comments and validate marker nesting.
 *
 * Supported markers:
 * - `// fc-format-ignore`: Protects the entire following declaration, member, or statement.
 * - `/* fc-format-ignore-start * /` and `/* fc-format-ignore-end * /`: Protects an arbitrary block span.
 *
 * @param {string} source - The complete source code.
 * @param {SyntaxNode & { tokens: Token[] }} tree - The parsed concrete syntax tree.
 * @returns {{ ranges: ProtectedRange[], diagnostics: PragmaDiagnostic[] }}
 */
export function collectPragmas(source, tree) {
  // 1. Flatten all non-File syntax nodes into a list for fast spatial boundary lookup
  const nodes = [];
  const pendingNodes = [tree];

  while (pendingNodes.length > 0) {
    const node = pendingNodes.pop();

    if (node.kind !== "File") {
      nodes.push(node);
    }

    pendingNodes.push(...node.children);
  }

  // 2. State setup for pragma scanning
  const syntaxTokens = tree.tokens.filter((token) => token.channel === "syntax");
  const rawRanges = [];
  const blockStack = [];
  const diagnostics = [];

  /**
   * Helper to record pragma diagnostics for misplaced or mismatched markers.
   * @param {Token} token
   * @param {string} message
   */
  function reportError(token, message) {
    diagnostics.push({
      phase: "pragma",
      code: "unmatched-ignore-marker",
      message,
      start: token.start,
      end: token.end,
      line: token.line,
      column: token.column,
    });
  }

  // 3. Scan comment tokens for pragma markers
  for (const token of tree.tokens) {
    if (!COMMENTS.has(token.kind)) {
      continue;
    }

    const marker = token.text.trim();

    if (/^\/\*\s*fc-format-ignore-start\s*\*\/$/.test(marker)) {
      blockStack.push(token);
    } else if (/^\/\*\s*fc-format-ignore-end\s*\*\/$/.test(marker)) {
      if (blockStack.length === 0) {
        reportError(token, "Ignore end marker has no matching start marker.");
      } else {
        const startToken = blockStack.pop();

        // Only register the range when closing the outermost block ignore
        if (blockStack.length === 0) {
          rawRanges.push({
            start: anchoredStart(source, startToken.start),
            end: token.end,
          });
        }
      }
    } else if (/^\/\/\s*fc-format-ignore$/.test(marker) && blockStack.length === 0) {
      // Find the first syntax token immediately following this line marker
      const nextSyntaxToken = syntaxTokens.find((part) => part.start >= token.end);

      if (!nextSyntaxToken) {
        continue;
      }

      // Locate the exact entry that starts at or encloses this token
      const matchingEntries = nodes
        .filter((node) => ENTRIES.has(node.kind) && node.start === nextSyntaxToken.start)
        .sort((left, right) => right.end - left.end);

      const enclosingEntries = nodes
        .filter((node) => node.start <= nextSyntaxToken.start && node.end > nextSyntaxToken.start)
        .sort((left, right) => (left.end - left.start) - (right.end - right.start));

      const targetEntry = matchingEntries[0] ?? enclosingEntries[0];

      if (targetEntry) {
        let entryEnd = targetEntry.end;

        // Absorb trailing line comments attached to this entry
        const trailingComments = tree.tokens.filter((part) =>
          COMMENTS.has(part.kind) && part.start >= entryEnd
        );

        for (const comment of trailingComments) {
          if (!/^[ \t]*$/.test(source.slice(entryEnd, comment.start))) {
            break;
          }

          entryEnd = comment.end;
        }

        rawRanges.push({
          start: Math.min(anchoredStart(source, token.start), targetEntry.start),
          end: entryEnd,
        });
      }
    }
  }

  // Any unclosed start markers left on the stack are reported as diagnostics
  for (const token of blockStack) {
    reportError(token, "Ignore start marker has no matching end marker.");
  }

  // 4. Boundary entry expansion:
  // If an ignore region cuts across the boundary of a syntax entry, widen the range
  // so complete syntactic entities remain intact rather than partially formatted fragments.
  for (const range of rawRanges) {
    let changed = false;

    do {
      changed = false;

      for (const node of nodes.filter((candidate) => ENTRIES.has(candidate.kind))) {
        if (node.start < range.start && node.end > range.start && node.end < range.end) {
          range.start = anchoredStart(source, node.start);
          changed = true;
        }

        if (node.start > range.start && node.start < range.end && node.end > range.end) {
          range.end = node.end;
          changed = true;
        }
      }
    } while (changed);
  }

  // 5. Merge contiguous and overlapping ranges in ascending offset order
  rawRanges.sort((left, right) => left.start - right.start);
  const mergedRanges = [];

  for (const range of rawRanges) {
    const previous = mergedRanges.at(-1);

    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      mergedRanges.push({
        ...range,
        absolute: range.start === lineStart(source, range.start),
      });
    }
  }

  return { ranges: mergedRanges, diagnostics };
}
