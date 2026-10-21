/**
 * @fileoverview Lint rule: no-unreachable-code
 *
 * Disallows unreachable code after return, break, and continue statements.
 * Code following an unconditional jump will never execute and is often dead
 * code or a logic mistake (such as cleanup/destroy functions never being called).
 *
 * @see {@link import("../../types/lint.js").LintRule}
 */

const TERMINAL_KEYWORDS = new Set(["return", "break", "continue"]);

/**
 * Finds the first syntax token inside a node's span.
 * @param {readonly import("../../types/ast.js").Token[]} tokens
 * @param {import("../../types/ast.js").SyntaxNode} node
 * @returns {import("../../types/ast.js").Token | undefined}
 */
function getFirstSyntaxToken(tokens, node) {
  for (const token of tokens) {
    if (token.start >= node.start && token.end <= node.end && token.channel === "syntax") {
      return token;
    }
    if (token.start > node.end) break;
  }
  return undefined;
}

/** @type {import("../../types/lint.js").LintRule} */
export const noUnreachableCode = {
  id: "no-unreachable-code",
  description: "Disallow unreachable code following return, break, or continue statements.",
  defaultSeverity: "error",

  create(context) {
    return {
      CodeBlock(node) {
        const statements = node.children ?? [];

        for (let i = 0; i < statements.length - 1; i++) {
          const stmt = statements[i];
          const firstToken = getFirstSyntaxToken(context.tokens, stmt);

          if (firstToken && TERMINAL_KEYWORDS.has(firstToken.text)) {
            const unreachableStmt = statements[i + 1];
            context.report({
              node: unreachableStmt,
              message: `Unreachable code after '${firstToken.text}'.`,
            });
            break;
          }
        }
      },
    };
  },
};
