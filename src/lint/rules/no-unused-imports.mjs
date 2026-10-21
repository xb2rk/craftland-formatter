/**
 * @fileoverview Lint rule: no-unused-imports
 *
 * Disallows imports that are declared but never referenced in the file.
 * Unused imports clutter the namespace, increase compile times, and create
 * unnecessary file dependencies.
 *
 * @see {@link import("../../types/lint.js").LintRule}
 */

/**
 * Extracts the bound identifier token from an Import node.
 * @param {readonly import("../../types/ast.js").Token[]} tokens
 * @param {import("../../types/ast.js").SyntaxNode} importNode
 * @returns {import("../../types/ast.js").Token | undefined}
 */
function getImportBindingToken(tokens, importNode) {
  const importTokens = tokens.filter(
    (t) => t.start >= importNode.start && t.end <= importNode.end && t.channel === "syntax"
  );

  // Check for 'as Alias'
  const asIndex = importTokens.findIndex((t) => t.text === "as");
  if (asIndex >= 0 && asIndex + 1 < importTokens.length) {
    return importTokens[asIndex + 1];
  }

  // Check for 'import Name from "path"'
  if (importTokens[0]?.text === "import" && importTokens[1]?.kind === "IDENTIFIER") {
    return importTokens[1];
  }

  return undefined;
}

/** @type {import("../../types/lint.js").LintRule} */
export const noUnusedImports = {
  id: "no-unused-imports",
  description: "Disallow imports that are never used in the file.",
  defaultSeverity: "warn",

  create(context) {
    /** @type {Array<{ node: import("../../types/ast.js").SyntaxNode, token: import("../../types/ast.js").Token }>} */
    const importBindings = [];

    return {
      Import(node) {
        const token = getImportBindingToken(context.tokens, node);
        if (token) {
          importBindings.push({ node, token });
        }
      },

      "File:exit"() {
        if (importBindings.length === 0) return;

        // Find the end offset of the import section
        let lastImportEnd = 0;
        for (const item of importBindings) {
          if (item.node.end > lastImportEnd) {
            lastImportEnd = item.node.end;
          }
        }

        // Collect all identifier/syntax token texts occurring after the imports
        const usedIdentifiers = new Set();
        for (const token of context.tokens) {
          if (token.start >= lastImportEnd && token.channel === "syntax") {
            usedIdentifiers.add(token.text);
          }
        }

        // Check each import binding
        for (const { node, token } of importBindings) {
          if (!usedIdentifiers.has(token.text)) {
            context.report({
              token,
              message: `Import '${token.text}' is declared but its symbols are never used in this file.`,
            });
          }
        }
      },
    };
  },
};
