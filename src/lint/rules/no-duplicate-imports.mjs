/**
 * @fileoverview Lint rule: no-duplicate-imports
 *
 * Disallows duplicate import declarations for the same module path or reusing
 * the same import alias within the same file.
 *
 * @see {@link import("../../types/lint.js").LintRule}
 */

/**
 * Normalizes an import path literal for comparison.
 * @param {string} raw
 * @returns {string}
 */
function normalizePath(raw) {
  const unquoted = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  return unquoted.replaceAll("\\", "/").toLowerCase();
}

/**
 * Extracts the module path token and optional alias token from an Import node.
 * @param {readonly import("../../types/ast.js").Token[]} tokens
 * @param {import("../../types/ast.js").SyntaxNode} importNode
 * @returns {{ pathToken?: import("../../types/ast.js").Token, aliasToken?: import("../../types/ast.js").Token }}
 */
function getImportDetails(tokens, importNode) {
  const importTokens = tokens.filter(
    (t) => t.start >= importNode.start && t.end <= importNode.end && t.channel === "syntax"
  );

  let pathToken;
  let aliasToken;

  for (let i = 0; i < importTokens.length; i++) {
    const t = importTokens[i];
    if (t.kind === "STRING_LIT" || t.text.startsWith('"')) {
      pathToken = t;
    }
    if (t.text === "as" && i + 1 < importTokens.length) {
      aliasToken = importTokens[i + 1];
    }
  }

  return { pathToken, aliasToken };
}

/** @type {import("../../types/lint.js").LintRule} */
export const noDuplicateImports = {
  id: "no-duplicate-imports",
  description: "Disallow duplicate imports of the same module or conflicting aliases.",
  defaultSeverity: "error",

  create(context) {
    /** @type {Map<string, import("../../types/ast.js").Token>} */
    const seenPaths = new Map();
    /** @type {Map<string, import("../../types/ast.js").Token>} */
    const seenAliases = new Map();

    return {
      Import(node) {
        const { pathToken, aliasToken } = getImportDetails(context.tokens, node);

        if (pathToken) {
          const norm = normalizePath(pathToken.text);
          if (seenPaths.has(norm)) {
            context.report({
              token: pathToken,
              message: `Duplicate import for module ${pathToken.text}.`,
            });
          } else {
            seenPaths.set(norm, pathToken);
          }
        }

        if (aliasToken) {
          const alias = aliasToken.text;
          if (seenAliases.has(alias)) {
            context.report({
              token: aliasToken,
              message: `Import alias '${alias}' is already used by another import in this file.`,
            });
          } else {
            seenAliases.set(alias, aliasToken);
          }
        }
      },
    };
  },
};
