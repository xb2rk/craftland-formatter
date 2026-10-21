/**
 * @fileoverview Lint rule: no-empty-block
 *
 * Disallows empty statement blocks ({}) in control flow statements (if, else, while, for)
 * unless they contain at least one explanatory comment (e.g. `// intentional no-op`).
 *
 * Empty function and event callback declarations (stubs) are intentionally permitted.
 *
 * @see {@link import("../../types/lint.js").LintRule}
 */

/**
 * Checks if a span between start and end offsets contains any comment trivia.
 * @param {readonly import("../../types/ast.js").Token[]} tokens
 * @param {number} start
 * @param {number} end
 * @returns {boolean}
 */
function hasComment(tokens, start, end) {
  for (const token of tokens) {
    if (token.start < start) continue;
    if (token.end > end) break;
    if (
      token.channel === "trivia" &&
      (token.kind === "LINE_COMMENT" || token.kind === "BLOCK_COMMENT" || token.kind.includes("COMMENT"))
    ) {
      return true;
    }
  }
  return false;
}

/** @type {import("../../types/lint.js").LintRule} */
export const noEmptyBlock = {
  id: "no-empty-block",
  description: "Disallow empty control flow blocks without comments.",
  defaultSeverity: "off",

  create(context) {
    return {
      ControlFlow(node) {
        for (const child of node.children ?? []) {
          if (child.kind === "CodeBlock" && (child.children ?? []).length === 0) {
            // Check if there are any comments inside the block { ... }
            if (!hasComment(context.tokens, child.start, child.end)) {
              context.report({
                node: child,
                message: "Empty control flow block. Add an explanatory comment or remove the empty block.",
              });
            }
          }
        }
      },
    };
  },
};
