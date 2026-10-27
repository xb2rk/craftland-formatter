/**
 * @fileoverview Concrete symbol extraction from lossless FC AST for VS Code
 * Document Symbols (Outline), Autocompletion, and Go to Definition.
 */

/** @typedef {import("../types/ast.d.ts").SyntaxNode} SyntaxNode */
/** @typedef {import("../types/ast.d.ts").Token} Token */

/**
 * @typedef {"Graph" | "Function" | "EventListener" | "Property" | "Enum" | "EnumMember" | "Tuple" | "Component" | "Define" | "Alias" | "Import"} SymbolKind
 *
 * @typedef {{
 *   start: number,
 *   end: number,
 *   line: number,
 *   column: number,
 *   endLine: number,
 *   endColumn: number,
 * }} SourceRange
 *
 * @typedef {{
 *   name: string,
 *   kind: SymbolKind,
 *   detail: string,
 *   docComment?: string,
 *   range: SourceRange,
 *   selectionRange: SourceRange,
 *   children?: SymbolNode[],
 *   signature?: {
 *     params: string,
 *     returnType: string,
 *   },
 *   parentName?: string,
 * }} SymbolNode
 *
 * @typedef {{
 *   path: string,
 *   alias: string,
 *   range: SourceRange,
 *   pathRange: SourceRange,
 *   aliasRange?: SourceRange,
 * }} ImportRecord
 */

const TRIVIA_KINDS = new Set(["WS", "NEWLINE"]);
const COMMENT_KINDS = new Set(["LINE_COMMENT", "COMMENT"]);

/**
 * Clean up raw comment token text to a readable documentation string.
 * Strips leading //, / * *, * / and normalizes line indents.
 *
 * @param {string} raw
 * @returns {string}
 */
export function formatDocComment(raw) {
  if (!raw) return "";
  const lines = raw.split(/\r\n|\r|\n/);
  const cleaned = [];

  for (let line of lines) {
    line = line.trim();
    if (line.startsWith("/**")) {
      line = line.slice(3).trim();
    } else if (line.startsWith("/*")) {
      line = line.slice(2).trim();
    }
    if (line.endsWith("*/")) {
      line = line.slice(0, -2).trim();
    }
    if (line.startsWith("*")) {
      line = line.slice(1).trim();
    } else if (line.startsWith("//")) {
      line = line.slice(2).trim();
    }
    if (line.length > 0) {
      cleaned.push(line);
    }
  }

  return cleaned.join("\n");
}

/**
 * Format a list of tokens into clean source-like representation without ugly spaces.
 * Ensures `entity<Player>, seedId int` instead of `entity < Player > , seedId int`.
 *
 * @param {readonly Token[]} tokens
 * @returns {string}
 */
export function formatTokenSequence(tokens) {
  if (!tokens || tokens.length === 0) return "";
  let result = "";
  for (let i = 0; i < tokens.length; i++) {
    const text = tokens[i].text;
    const prev = tokens[i - 1]?.text;
    if (i === 0) {
      result += text;
      continue;
    }
    // No space before punctuation
    if (text === "," || text === ";" || text === ")" || text === "]" || text === ">") {
      result += text;
    } else if (text === "<" || (text === "[" && prev !== "]")) {
      result += text;
    } else if (text === "}" && prev === "{") {
      result += text;
    } else if (prev === "<" || prev === "(" || prev === "[") {
      result += text;
    } else if (prev === ",") {
      result += " " + text;
    } else {
      result += " " + text;
    }
  }
  return result;
}

/**
 * Scan backward from startOffset in tokens stream to collect immediately preceding doc comments.
 *
 * @param {readonly Token[]} tokens
 * @param {number} startOffset
 * @returns {string | undefined}
 */
function findDocComment(tokens, startOffset) {
  let index = tokens.findIndex((t) => t.start >= startOffset);
  if (index === -1) {
    index = tokens.length;
  }

  const commentParts = [];
  let newlineCount = 0;

  for (let i = index - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.kind === "WS") {
      continue;
    }
    if (t.kind === "NEWLINE") {
      newlineCount++;
      if (newlineCount > 2) {
        break;
      }
      continue;
    }
    if (COMMENT_KINDS.has(t.kind)) {
      commentParts.unshift(t.text);
      newlineCount = 0;
    } else {
      break;
    }
  }

  if (commentParts.length === 0) {
    return undefined;
  }

  return commentParts.map(formatDocComment).filter(Boolean).join("\n\n");
}

/**
 * Convert a token or start/end tokens to a standard SourceRange.
 *
 * @param {Token} startToken
 * @param {Token} [endToken]
 * @returns {SourceRange}
 */
function makeRange(startToken, endToken = startToken) {
  return {
    start: startToken.start,
    end: endToken.end,
    line: startToken.line,
    column: startToken.column,
    endLine: endToken.endLine,
    endColumn: endToken.endColumn,
  };
}

/**
 * Binary search for the first token whose start offset is >= target start.
 *
 * @param {readonly Token[]} tokens
 * @param {number} start
 * @returns {number}
 */
/**
 * Finds the index of the first token starting at or after the given character offset.
 *
 * @param {readonly Token[]} tokens - Sorted array of tokens.
 * @param {number} start - Target character start offset.
 * @returns {number} Index of first matching token, or `tokens.length` if none.
 */
function findFirstTokenIndex(tokens, start) {
  let low = 0;
  let high = tokens.length - 1;
  let result = tokens.length;

  while (low <= high) {
    // Fast integer division by 2 for binary search midpoint
    const mid = (low + high) >> 1;
    if (tokens[mid].start >= start) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result;
}

/**
 * Find all tokens belonging to the given offset span using O(log N) binary search.
 *
 * @param {readonly Token[]} tokens
 * @param {number} start
 * @param {number} end
 * @param {boolean} [syntaxOnly=true]
 * @returns {Token[]}
 */
function getTokensInRange(tokens, start, end, syntaxOnly = true) {
  if (!tokens || tokens.length === 0) return [];
  const first = findFirstTokenIndex(tokens, start);
  const out = [];

  for (let i = first; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.start > end) break;
    if (t.end <= end && (!syntaxOnly || t.channel === "syntax")) {
      out.push(t);
    }
  }

  return out;
}

/**
 * Extract all import records from the parsed syntax tree.
 *
 * @param {SyntaxNode & { tokens: Token[] }} tree
 * @returns {ImportRecord[]}
 */
export function extractImports(tree) {
  if (!tree?.children || !tree.tokens) {
    return [];
  }

  const importNodes = tree.children.filter((c) => c.kind === "Import");
  const records = [];

  for (const node of importNodes) {
    const nodeTokens = getTokensInRange(tree.tokens, node.start, node.end, true);
    const pathToken = nodeTokens.find((t) =>
      t.kind === "INTERPRETED_STRING_LIT" || t.kind === "RAW_STRING_LIT"
    );

    if (!pathToken) {
      continue;
    }

    const rawPath = pathToken.text.slice(1, -1);
    const asIndex = nodeTokens.findIndex((t) => t.text === "as");
    const aliasToken = asIndex >= 0 ? nodeTokens[asIndex + 1] : undefined;

    // Default alias is the filename without extension if no explicit alias
    let defaultAlias = rawPath.split(/[\\/]/).pop() ?? "";
    defaultAlias = defaultAlias.replace(/\.(fcg|fcc)$/i, "");

    const alias = aliasToken ? aliasToken.text : defaultAlias;

    records.push({
      path: rawPath,
      alias,
      range: makeRange(nodeTokens[0], nodeTokens.at(-1)),
      pathRange: makeRange(pathToken),
      aliasRange: aliasToken ? makeRange(aliasToken) : undefined,
    });
  }

  return records;
}

/**
 * Extract hierarchical symbols from a parsed FC document (.fcg or .fcc).
 *
 * @param {SyntaxNode & { tokens: Token[] }} tree
 * @param {"fcg" | "fcc"} kind
 * @returns {SymbolNode[]}
 */
export function extractSymbols(tree, kind) {
  if (!tree?.children || !tree.tokens) {
    return [];
  }

  const tokens = tree.tokens;
  const symbols = [];

  if (kind === "fcg") {
    // Look for Graph declaration in top-level children
    for (const child of tree.children) {
      if (child.kind !== "Graph") {
        continue;
      }

      const graphTokens = getTokensInRange(tokens, child.start, child.end, true);
      const graphKeywordIdx = graphTokens.findIndex((t) => t.text === "graph");

      if (graphKeywordIdx === -1) {
        continue;
      }

      const nameToken = graphTokens[graphKeywordIdx + 1];
      if (!nameToken) {
        continue;
      }

      const graphName = nameToken.text;
      const modifiers = graphTokens.slice(0, graphKeywordIdx).map((t) => t.text);
      const docComment = findDocComment(tokens, child.start);

      const block = child.children.find((c) => c.kind === "GraphBlock");
      const memberSymbols = [];

      if (block) {
        for (const member of block.children) {
          const memberTokens = getTokensInRange(tokens, member.start, member.end, true);
          if (memberTokens.length === 0) continue;

          if (member.kind === "Function") {
            const funcKeywordIdx = memberTokens.findIndex((t) => t.text === "func");
            if (funcKeywordIdx === -1) continue;

            const fnNameToken = memberTokens[funcKeywordIdx + 1];
            if (!fnNameToken) continue;

            const codeBlock = member.children.find((c) => c.kind === "CodeBlock");
            const headerEnd = codeBlock ? codeBlock.start : member.end;
            const headerTokens = getTokensInRange(tokens, member.start, headerEnd, true);

            const openParen = headerTokens.findIndex((t) => t.text === "(");
            const closeParen = headerTokens.findLastIndex((t) => t.text === ")");
            const params = openParen >= 0 && closeParen > openParen
              ? formatTokenSequence(headerTokens.slice(openParen + 1, closeParen))
              : "";
            const retType = closeParen >= 0
              ? formatTokenSequence(headerTokens.slice(closeParen + 1))
              : "";

            const detail = retType ? `(${params}) : ${retType}` : `(${params})`;

            memberSymbols.push({
              name: fnNameToken.text,
              kind: "Function",
              detail,
              docComment: findDocComment(tokens, member.start),
              range: makeRange(memberTokens[0], memberTokens.at(-1)),
              selectionRange: makeRange(fnNameToken),
              signature: {
                params,
                returnType: retType,
              },
              parentName: graphName,
            });
          } else if (member.kind === "EventListener") {
            const eventKeywordIdx = memberTokens.findIndex((t) => t.text === "event");
            if (eventKeywordIdx === -1) continue;

            const evNameToken = memberTokens[eventKeywordIdx + 1];
            if (!evNameToken) continue;

            const codeBlock = member.children.find((c) => c.kind === "CodeBlock");
            const headerEnd = codeBlock ? codeBlock.start : member.end;
            const headerTokens = getTokensInRange(tokens, member.start, headerEnd, true);

            const openParen = headerTokens.findIndex((t) => t.text === "(");
            const closeParen = headerTokens.findLastIndex((t) => t.text === ")");
            const params = openParen >= 0 && closeParen > openParen
              ? formatTokenSequence(headerTokens.slice(openParen + 1, closeParen))
              : "";

            memberSymbols.push({
              name: evNameToken.text,
              kind: "EventListener",
              detail: `event (${params})`,
              docComment: findDocComment(tokens, member.start),
              range: makeRange(memberTokens[0], memberTokens.at(-1)),
              selectionRange: makeRange(evNameToken),
              signature: {
                params,
                returnType: "",
              },
              parentName: graphName,
            });
          } else if (member.kind === "Property") {
            // e.g. TileScale float = 2.0 or _DATASTORE_KEY string = "FlagStatuses"
            const propNameToken = memberTokens[0];
            if (!propNameToken) continue;

            const detail = formatTokenSequence(memberTokens.slice(1));

            memberSymbols.push({
              name: propNameToken.text,
              kind: "Property",
              detail,
              docComment: findDocComment(tokens, member.start),
              range: makeRange(memberTokens[0], memberTokens.at(-1)),
              selectionRange: makeRange(propNameToken),
              parentName: graphName,
            });
          }
        }
      }

      const modifiersStr = formatTokenSequence(graphTokens.slice(0, graphKeywordIdx));
      const graphDetail = modifiersStr ? `${modifiersStr} graph` : "graph";

      symbols.push({
        name: graphName,
        kind: "Graph",
        detail: graphDetail,
        docComment,
        range: makeRange(graphTokens[0], graphTokens.at(-1)),
        selectionRange: makeRange(nameToken),
        children: memberSymbols,
        modifiers: graphTokens.slice(0, graphKeywordIdx).map((t) => t.text),
      });
    }
  } else if (kind === "fcc") {
    // FCC header declarations
    for (const child of tree.children) {
      if (child.kind !== "Declaration") {
        continue;
      }

      const declTokens = getTokensInRange(tokens, child.start, child.end, true);
      if (declTokens.length === 0) continue;

      // Find declaration keyword (enum, tuple, component, define, alias, func, event)
      const DECL_KEYWORDS = new Set(["enum", "tuple", "component", "define", "alias", "func", "event"]);
      const kwIdx = declTokens.findIndex((t) => DECL_KEYWORDS.has(t.text));
      if (kwIdx === -1) continue;

      const kw = declTokens[kwIdx].text;
      const nameToken = declTokens[kwIdx + 1];
      if (!nameToken) continue;

      const declName = nameToken.text;
      const docComment = findDocComment(tokens, child.start);
      const block = child.children.find((c) => c.kind === "DeclarationBlock");

      if (kw === "enum") {
        const enumMembers = [];
        if (block) {
          for (const member of block.children) {
            const mTokens = getTokensInRange(tokens, member.start, member.end, true);
            if (mTokens.length === 0) continue;
            const mName = mTokens[0];
            const detail = mTokens.slice(1).map((t) => t.text).join(" ");
            enumMembers.push({
              name: mName.text,
              kind: "EnumMember",
              detail,
              docComment: findDocComment(tokens, member.start),
              range: makeRange(mTokens[0], mTokens.at(-1)),
              selectionRange: makeRange(mName),
              parentName: declName,
            });
          }
        }

        symbols.push({
          name: declName,
          kind: "Enum",
          detail: "enum",
          docComment,
          range: makeRange(declTokens[0], declTokens.at(-1)),
          selectionRange: makeRange(nameToken),
          children: enumMembers,
        });
      } else if (kw === "tuple" || kw === "component") {
        const fields = [];
        if (block) {
          for (const member of block.children) {
            const mTokens = getTokensInRange(tokens, member.start, member.end, true);
            if (mTokens.length === 0) continue;
            const mName = mTokens[0];
            const detail = formatTokenSequence(mTokens.slice(1));
            fields.push({
              name: mName.text,
              kind: "Property",
              detail,
              docComment: findDocComment(tokens, member.start),
              range: makeRange(mTokens[0], mTokens.at(-1)),
              selectionRange: makeRange(mName),
              parentName: declName,
            });
          }
        }

        symbols.push({
          name: declName,
          kind: kw === "tuple" ? "Tuple" : "Component",
          detail: kw,
          docComment,
          range: makeRange(declTokens[0], declTokens.at(-1)),
          selectionRange: makeRange(nameToken),
          children: fields,
        });
      } else if (kw === "define") {
        const detail = formatTokenSequence(declTokens.slice(kwIdx + 2));
        symbols.push({
          name: declName,
          kind: "Define",
          detail: detail ? `define : ${detail}` : "define",
          docComment,
          range: makeRange(declTokens[0], declTokens.at(-1)),
          selectionRange: makeRange(nameToken),
        });
      } else if (kw === "alias") {
        const detail = formatTokenSequence(declTokens.slice(kwIdx + 2));
        symbols.push({
          name: declName,
          kind: "Alias",
          detail: detail ? `alias : ${detail}` : "alias",
          docComment,
          range: makeRange(declTokens[0], declTokens.at(-1)),
          selectionRange: makeRange(nameToken),
        });
      } else if (kw === "func") {
        const openParen = declTokens.findIndex((t) => t.text === "(");
        const closeParen = declTokens.findLastIndex((t) => t.text === ")");
        const params = openParen >= 0 && closeParen > openParen
          ? formatTokenSequence(declTokens.slice(openParen + 1, closeParen))
          : "";
        const retType = closeParen >= 0
          ? formatTokenSequence(declTokens.slice(closeParen + 1))
          : "";

        const detail = retType ? `(${params}) : ${retType}` : `(${params})`;

        symbols.push({
          name: declName,
          kind: "Function",
          detail,
          docComment,
          range: makeRange(declTokens[0], declTokens.at(-1)),
          selectionRange: makeRange(nameToken),
          signature: {
            params,
            returnType: retType,
          },
        });
      } else if (kw === "event") {
        const openParen = declTokens.findIndex((t) => t.text === "(");
        const closeParen = declTokens.findLastIndex((t) => t.text === ")");
        const params = openParen >= 0 && closeParen > openParen
          ? formatTokenSequence(declTokens.slice(openParen + 1, closeParen))
          : "";

        symbols.push({
          name: declName,
          kind: "EventListener",
          detail: `event (${params})`,
          docComment,
          range: makeRange(declTokens[0], declTokens.at(-1)),
          selectionRange: makeRange(nameToken),
          signature: {
            params,
            returnType: "",
          },
        });
      }
    }
  }

  return symbols;
}

/**
 * Flatten symbol tree to a direct map for fast completion and definition lookup.
 *
 * @param {SymbolNode[]} symbols
 * @returns {Map<string, SymbolNode>}
 */
export function flattenSymbols(symbols) {
  const map = new Map();

  function visit(node) {
    map.set(node.name, node);
    if (node.children) {
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  for (const s of symbols) {
    visit(s);
  }

  return map;
}

/**
 * @typedef {{
 *   startLine: number,
 *   endLine: number,
 *   kind?: "comment" | "imports" | "region",
 * }} FoldingRangeRecord
 */

/**
 * Extract semantic folding ranges from the concrete syntax tree and token stream.
 * Covers consecutive imports, multiline block comments, and braces { ... }.
 *
 * @param {SyntaxNode & { tokens: Token[] }} tree
 * @returns {FoldingRangeRecord[]}
 */
export function extractFoldingRanges(tree) {
  if (!tree?.tokens) return [];
  const tokens = tree.tokens;
  const ranges = [];

  // 1. Multiline comments (/* ... */)
  for (const t of tokens) {
    if (t.kind === "COMMENT" && t.endLine > t.line) {
      ranges.push({
        startLine: t.line - 1,
        endLine: t.endLine - 1,
        kind: "comment",
      });
    }
  }

  // 2. Consecutive Imports block (fold imports together)
  const imports = tree.children?.filter((c) => c.kind === "Import") ?? [];
  if (imports.length >= 2) {
    const firstImport = imports[0];
    const lastImport = imports.at(-1);
    const firstToken = tokens.find((t) => t.start >= firstImport.start && t.channel === "syntax");
    const lastToken = tokens.findLast((t) => t.end <= lastImport.end && t.channel === "syntax");
    if (firstToken && lastToken && lastToken.endLine > firstToken.line) {
      ranges.push({
        startLine: firstToken.line - 1,
        endLine: lastToken.endLine - 1,
        kind: "imports",
      });
    }
  }

  // 3. Structural blocks with { ... }
  const BLOCK_KINDS = new Set(["GraphBlock", "CodeBlock", "DeclarationBlock"]);
  function visit(node) {
    if (BLOCK_KINDS.has(node.kind)) {
      const blockTokens = tokens.filter((t) => t.channel === "syntax" && t.start >= node.start && t.end <= node.end);
      const openBrace = blockTokens.find((t) => t.text === "{");
      const closeBrace = blockTokens.findLast((t) => t.text === "}");
      if (openBrace && closeBrace && closeBrace.endLine > openBrace.line) {
        ranges.push({
          startLine: openBrace.line - 1,
          endLine: closeBrace.endLine - 1,
        });
      }
    }

    if (node.children) {
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  visit(tree);

  return ranges;
}
