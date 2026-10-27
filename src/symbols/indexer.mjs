/**
 * @fileoverview Workspace indexer and symbol resolver for Craftland FC.
 * Resolves imported files, manages AST symbol caching, and powers Smart
 * Completion and Go to Definition.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseSource, parseTolerantSource } from "../syntax/parser.mjs";
import { extractSymbols, extractImports, flattenSymbols, extractFoldingRanges } from "./extractor.mjs";

/**
 * @typedef {import("./extractor.mjs").SymbolNode} SymbolNode
 * @typedef {import("./extractor.mjs").ImportRecord} ImportRecord
 *
 * @typedef {{
 *   mtimeMs: number,
 *   symbols: SymbolNode[],
 *   imports: ImportRecord[],
 *   flatSymbols: Map<string, SymbolNode>,
 *   graphMembers: SymbolNode[],
 * }} FileIndexEntry
 *
 * @typedef {{
 *   label: string,
 *   kind: "Function" | "EventListener" | "Property" | "Enum" | "EnumMember" | "Tuple" | "Component" | "Define" | "Alias" | "Import",
 *   detail: string,
 *   docComment?: string,
 *   signature?: { params: string, returnType: string },
 *   insertSnippet: string,
 * }} CompletionItemDescriptor
 *
 * @typedef {{
 *   filePath: string,
 *   range: {
 *     start: number,
 *     end: number,
 *     line: number,
 *     column: number,
 *     endLine: number,
 *     endColumn: number,
 *   },
 * }} DefinitionLocation
 */

/** Scoring constants for ranked workspace symbol search (Ctrl + T). */
const SCORE_EXACT_MATCH = 1000;
const SCORE_PREFIX_MATCH = 500;
const SCORE_EXACT_CASE_MATCH = 250;
const SCORE_SUBSTRING_MATCH = 100;
const BONUS_PRIMARY_DECL = 40; // Graph, Tuple, Enum
const BONUS_FUNCTION = 20;     // Function
const LENGTH_NORMALIZATION_BASE = 50;

/** Check cancellation token every N symbols to avoid stalling quick keystrokes. */
const CANCELLATION_CHECK_INTERVAL = 1000;

/** Number of files indexed between event loop setImmediate yields during warmup. */
const WARMUP_YIELD_INTERVAL = 15;

/** In-memory cache of parsed file symbols keyed by absolute file path. */
const fileIndexCache = new Map();

/** Map of normalized file path -> Array of SymbolFlatRecord */
const fileSymbolsMap = new Map();

/** Map of filename (lowercase) -> absolute file path for O(1) import resolution */
const fileNameToPathMap = new Map();

/** Flattened array of all workspace symbols across all indexed files */
let workspaceSymbolList = [];
let workspaceSymbolsDirty = false;

/** Cache of workspace Assets root directory. */
let cachedAssetsRoot = null;

/** Cache of workspace files to avoid rescanning directory tree on every keystroke. */
let cachedFileList = null;
let cachedFileListRoot = null;


/**
 * Clear all cached index entries. Useful for tests or configuration reloads.
 */
export function clearIndexCache() {
  fileIndexCache.clear();
  fileSymbolsMap.clear();
  fileNameToPathMap.clear();
  workspaceSymbolList = [];
  workspaceSymbolsDirty = false;
  cachedAssetsRoot = null;
  cachedFileList = null;
  cachedFileListRoot = null;
}

/**
 * Locate the nearest Assets root directory by ascending from the given file path.
 *
 * @param {string} startPath
 * @returns {string | null}
 */
export function findAssetsRoot(startPath) {
  if (cachedAssetsRoot && startPath.startsWith(cachedAssetsRoot)) {
    return cachedAssetsRoot;
  }

  let current = path.resolve(startPath);
  if (fs.existsSync(current) && fs.statSync(current).isFile()) {
    current = path.dirname(current);
  }

  const root = path.parse(current).root;

  while (current && current !== root) {
    const assetsDir = path.join(current, "Assets");
    if (fs.existsSync(assetsDir) && fs.statSync(assetsDir).isDirectory()) {
      cachedAssetsRoot = assetsDir;
      return assetsDir;
    }

    if (path.basename(current).toLowerCase() === "assets") {
      cachedAssetsRoot = current;
      return current;
    }

    current = path.dirname(current);
  }

  return null;
}

/**
 * Fallback regex-based import extractor when the structural parser rejects an unclosed block or incomplete syntax.
 *
 * @param {string} source
 * @returns {ImportRecord[]}
 */
function fallbackExtractImports(source) {
  const records = [];
  const regex = /import\s+["']([^"']+)["'](?:\s+as\s+([A-Za-z0-9_]+))?/g;
  let match;

  while ((match = regex.exec(source)) !== null) {
    const rawPath = match[1];
    let defaultAlias = rawPath.split(/[\\/]/).pop() ?? "";
    defaultAlias = defaultAlias.replace(/\.(fcg|fcc)$/i, "");
    const alias = match[2] ?? defaultAlias;

    records.push({
      path: rawPath,
      alias,
      range: { start: match.index, end: match.index + match[0].length, line: 1, column: 0, endLine: 1, endColumn: 0 },
      pathRange: { start: match.index, end: match.index + match[0].length, line: 1, column: 0, endLine: 1, endColumn: 0 },
    });
  }

  return records;
}

/**
 * Parse and index a single FC source file, caching its symbols and imports.
 *
 * @param {string} absolutePath
 * @param {string} [overrideContent]
 * @returns {FileIndexEntry | null}
 */
export function getFileIndex(absolutePath, overrideContent = null) {
  if (!absolutePath) return null;
  const normalized = path.normalize(absolutePath);

  try {
    const cached = fileIndexCache.get(normalized);
    let mtime = 0;

    if (overrideContent !== null) {
      if (cached && cached.source === overrideContent) {
        return cached;
      }
    } else {
      if (!fs.existsSync(normalized)) {
        return null;
      }
      mtime = fs.statSync(normalized).mtimeMs;
      if (cached && cached.mtimeMs === mtime) {
        return cached;
      }
    }

    const source = overrideContent ?? fs.readFileSync(normalized, "utf8");
    const ext = path.extname(normalized).slice(1).toLowerCase();
    const kind = ext === "fcc" ? "fcc" : "fcg";

    let parsed = null;
    try {
      parsed = parseTolerantSource(source, kind);
    } catch {
      parsed = null;
    }

    if (!parsed?.tree || !parsed.tree.children?.length) {
      // If parsing fails during typing, salvage imports and reuse previous cached symbols if available
      const fallbackImports = fallbackExtractImports(source);
      const previous = cached;

      const entry = {
        mtimeMs: mtime,
        source,
        symbols: previous?.symbols ?? [],
        imports: fallbackImports.length > 0 ? fallbackImports : (previous?.imports ?? []),
        flatSymbols: previous?.flatSymbols ?? new Map(),
        graphMembers: previous?.graphMembers ?? [],
        foldingRanges: previous?.foldingRanges ?? [],
      };

      fileIndexCache.set(normalized, entry);
      return entry;
    }

    const symbols = extractSymbols(parsed.tree, kind);
    const imports = extractImports(parsed.tree);
    const fallbackImports = fallbackExtractImports(source);
    // Merge fallback imports if parser missed any during incomplete syntax
    const allImports = imports.length > 0 ? imports : fallbackImports;
    const flatSymbols = flattenSymbols(symbols);
    const foldingRanges = extractFoldingRanges(parsed.tree);

    // Extract top-level graph members for quick dot-access lookup
    const graphNode = symbols.find((s) => s.kind === "Graph");
    const graphMembers = graphNode?.children ?? [];

    const entry = {
      mtimeMs: mtime,
      source,
      symbols,
      imports: allImports,
      flatSymbols,
      graphMembers,
      foldingRanges,
    };

    fileIndexCache.set(normalized, entry);

    const flatList = [];
    for (const sym of flatSymbols.values()) {
      flatList.push({
        name: sym.name,
        lowerName: sym.name.toLowerCase(),
        kind: sym.kind,
        containerName: sym.parentName ?? path.basename(normalized),
        filePath: normalized,
        range: sym.range,
      });
    }
    fileSymbolsMap.set(normalized, flatList);
    fileNameToPathMap.set(path.basename(normalized).toLowerCase(), normalized);
    workspaceSymbolsDirty = true;

    return entry;
  } catch {
    return null;
  }
}

/**
 * Search recursively for a file by name inside a directory up to a max depth.
 *
 * @param {string} dir
 * @param {string} fileName
 * @param {number} [depth=4]
 * @returns {string | null}
 */
function findFileInTree(dir, fileName, depth = 4) {
  if (depth < 0 || !fs.existsSync(dir)) return null;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
        return path.join(dir, entry.name);
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        const found = findFileInTree(path.join(dir, entry.name), fileName, depth - 1);
        if (found) return found;
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Resolve an import path string to an absolute file path on disk.
 *
 * @param {string} currentFilePath
 * @param {string} rawImportPath
 * @returns {string | null}
 */
export function resolveImportPath(currentFilePath, rawImportPath) {
  if (!rawImportPath || !currentFilePath) return null;
  const currentDir = path.dirname(path.normalize(currentFilePath));

  // 1. Check relative path directly from current file directory
  if (/^\.\.?[\/\\]/.test(rawImportPath)) {
    const candidate = path.resolve(currentDir, rawImportPath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // 2. Check sibling file in same directory
  const sibling = path.resolve(currentDir, path.basename(rawImportPath));
  if (fs.existsSync(sibling)) {
    return sibling;
  }

  // 3. Search in Assets directory tree
  const assetsDir = findAssetsRoot(currentFilePath);
  if (assetsDir) {
    // Check common standard directories
    const commonSubs = [
      path.join(assetsDir, "Scripts", "Contracts"),
      path.join(assetsDir, "Scripts", "Utils"),
      path.join(assetsDir, "Scripts", "Core"),
      path.join(assetsDir, "Scripts", "Components"),
      path.join(assetsDir, "Scripts"),
      assetsDir,
    ];

    for (const sub of commonSubs) {
      const candidate = path.resolve(sub, path.basename(rawImportPath));
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // Fast O(1) in-memory lookup before walking directory tree
    const baseNameLower = path.basename(rawImportPath).toLowerCase();
    const mapped = fileNameToPathMap.get(baseNameLower);
    if (mapped && fs.existsSync(mapped)) {
      return mapped;
    }

    // Deeper tree search inside Assets
    const found = findFileInTree(assetsDir, path.basename(rawImportPath));
    if (found) {
      fileNameToPathMap.set(baseNameLower, found);
      return found;
    }
  }

  // 4. Check Craftland Studio library release folder (system stdlib)
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (home) {
    const stdLibDir = path.join(
      home,
      ".vscode",
      "extensions",
      "craftlandstudio.ffugclanguage-1.11.0",
      "library",
      "release"
    );
    const candidate = path.resolve(stdLibDir, path.basename(rawImportPath));
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Retrieve autocompletion candidates when typing `<Target>.<Member>` (Dot-Access).
 *
 * @param {string} currentFilePath
 * @param {string} currentContent
 * @param {string} targetAlias
 * @param {string} [prefix=""]
 * @returns {CompletionItemDescriptor[]}
 */
export function getMemberCompletions(currentFilePath, currentContent, targetAlias, prefix = "") {
  if (!currentFilePath || !targetAlias) return [];

  const currentIndex = getFileIndex(currentFilePath, currentContent);
  if (!currentIndex) return [];

  // Find matching import record for targetAlias
  const lowerAlias = targetAlias.toLowerCase();
  const matchedImport = currentIndex.imports.find(
    (imp) => imp.alias.toLowerCase() === lowerAlias
  );

  if (!matchedImport) {
    return [];
  }

  // Resolve target file
  const resolvedPath = resolveImportPath(currentFilePath, matchedImport.path);
  if (!resolvedPath) {
    return [];
  }

  const targetIndex = getFileIndex(resolvedPath);
  if (!targetIndex) {
    return [];
  }

  const results = [];
  const lowerPrefix = prefix.toLowerCase();

  // If target has a Graph, suggest graph functions and properties
  const candidateSymbols = targetIndex.graphMembers.length > 0
    ? targetIndex.graphMembers
    : targetIndex.symbols;

  for (const sym of candidateSymbols) {
    if (lowerPrefix && !sym.name.toLowerCase().startsWith(lowerPrefix)) {
      continue;
    }

    const isFunc = sym.kind === "Function";
    const insertSnippet = isFunc ? `${sym.name}($0)` : sym.name;

    results.push({
      label: sym.name,
      kind: sym.kind,
      detail: sym.detail,
      docComment: sym.docComment,
      signature: sym.signature,
      insertSnippet,
    });
  }

  return results;
}

/**
 * Retrieve autocompletion candidates for imported aliases (modules).
 * Local functions/members in the current file are delegated to the official language extension
 * to avoid duplicate completion items.
 *
 * @param {string} currentFilePath
 * @param {string} currentContent
 * @param {string} [prefix=""]
 * @returns {CompletionItemDescriptor[]}
 */
export function getLocalCompletions(currentFilePath, currentContent, prefix = "") {
  if (!currentFilePath) return [];

  const currentIndex = getFileIndex(currentFilePath, currentContent);
  if (!currentIndex) return [];

  const results = [];
  const lowerPrefix = prefix.toLowerCase();

  // Add imported aliases as module/class completions (e.g. typing "Grid" -> suggests "GridMath")
  for (const imp of currentIndex.imports) {
    if (lowerPrefix && !imp.alias.toLowerCase().startsWith(lowerPrefix)) {
      continue;
    }

    results.push({
      label: imp.alias,
      kind: "Import",
      detail: `import "${imp.path}"`,
      insertSnippet: imp.alias,
    });
  }

  return results;
}

/**
 * Find the definition location for a symbol under the cursor.
 * Supports:
 * - `Alias.Member` -> definition in imported file
 * - `import "path"` -> jumps to file
 * - Local function / property -> definition in current file
 *
 * @param {string} currentFilePath
 * @param {string} currentContent
 * @param {string} lineText
 * @param {number} characterOffset - 0-based column index in line
 * @returns {DefinitionLocation | null}
 */
export function findDefinition(currentFilePath, currentContent, lineText, characterOffset) {
  if (!currentFilePath || !lineText) return null;

  const currentIndex = getFileIndex(currentFilePath, currentContent);
  if (!currentIndex) return null;

  // 1. Check if cursor is on an import path literal
  const importStringMatch = lineText.match(/import\s+["']([^"']+)["']/);
  if (importStringMatch) {
    const importPath = importStringMatch[1];
    const matchStart = lineText.indexOf(importStringMatch[0]);
    const matchEnd = matchStart + importStringMatch[0].length;

    if (characterOffset >= matchStart && characterOffset <= matchEnd) {
      const resolved = resolveImportPath(currentFilePath, importPath);
      if (resolved) {
        return {
          filePath: resolved,
          range: { start: 0, end: 0, line: 1, column: 0, endLine: 1, endColumn: 0 },
        };
      }
    }
  }

  // 2. Extract word and context under cursor
  // Find full identifier or member expression around characterOffset
  let start = characterOffset;
  while (start > 0 && /[A-Za-z0-9_.]/.test(lineText[start - 1])) {
    start--;
  }

  let end = characterOffset;
  while (end < lineText.length && /[A-Za-z0-9_]/.test(lineText[end])) {
    end++;
  }

  const expr = lineText.slice(start, end);
  if (!expr) return null;

  // Case A: Member expression: e.g. "GridMath.GetGardenLaneHeightY"
  if (expr.includes(".")) {
    const parts = expr.split(".");
    const alias = parts[0];
    const memberName = parts[1];

    if (alias && memberName) {
      const matchedImport = currentIndex.imports.find(
        (imp) => imp.alias.toLowerCase() === alias.toLowerCase()
      );

      if (matchedImport) {
        const resolvedPath = resolveImportPath(currentFilePath, matchedImport.path);
        if (resolvedPath) {
          const targetIndex = getFileIndex(resolvedPath);
          if (targetIndex) {
            const sym = targetIndex.flatSymbols.get(memberName);
            if (sym) {
              return {
                filePath: resolvedPath,
                range: sym.selectionRange,
              };
            }
          }
        }
      }
    }
  }

  // Case B: Simple word under cursor
  const word = expr;

  // Check if word is an imported alias
  const matchedImport = currentIndex.imports.find(
    (imp) => imp.alias.toLowerCase() === word.toLowerCase()
  );
  if (matchedImport) {
    const resolvedPath = resolveImportPath(currentFilePath, matchedImport.path);
    if (resolvedPath) {
      return {
        filePath: resolvedPath,
        range: { start: 0, end: 0, line: 1, column: 0, endLine: 1, endColumn: 0 },
      };
    }
  }

  // Local symbols in the current file are handled natively by the official language extension.
  // Returning null here prevents VS Code from opening duplicate "Definitions (2)" peek panels.
  return null;
}

/**
 * Retrieve folding ranges for a document.
 *
 * @param {string} currentFilePath
 * @param {string} [currentContent]
 * @returns {import("./extractor.mjs").FoldingRangeRecord[]}
 */
export function getFoldingRanges(currentFilePath, currentContent = null) {
  if (!currentFilePath) return [];
  const index = getFileIndex(currentFilePath, currentContent);
  return index?.foldingRanges ?? [];
}

/**
 * Retrieve document links for all import path statements.
 *
 * @param {string} currentFilePath
 * @param {string} [currentContent]
 * @returns {{ range: import("./extractor.mjs").SourceRange, targetFilePath: string }[]}
 */
export function getDocumentLinks(currentFilePath, currentContent = null) {
  if (!currentFilePath) return [];
  const index = getFileIndex(currentFilePath, currentContent);
  if (!index) return [];

  const links = [];
  for (const imp of index.imports) {
    const resolved = resolveImportPath(currentFilePath, imp.path);
    if (resolved) {
      links.push({
        range: imp.pathRange,
        targetFilePath: resolved,
      });
    }
  }

  return links;
}

/**
 * @typedef {{
 *   label: string,
 *   parameters: string[],
 *   activeParameter: number,
 *   docComment?: string,
 * }} SignatureHelpDescriptor
 */

/**
 * Parse function call context around cursor to provide signature help / parameter hints.
 *
 * @param {string} currentFilePath
 * @param {string} currentContent
 * @param {string} lineText
 * @param {number} characterOffset
 * @returns {SignatureHelpDescriptor | null}
 */
export function getSignatureHelp(currentFilePath, currentContent, lineText, characterOffset) {
  if (!currentFilePath || !lineText) return null;

  const lineBefore = lineText.slice(0, characterOffset);
  let depth = 0;
  let commas = 0;
  let openParenIdx = -1;

  for (let i = lineBefore.length - 1; i >= 0; i--) {
    const char = lineBefore[i];
    if (char === ")") {
      depth++;
    } else if (char === "(") {
      if (depth === 0) {
        openParenIdx = i;
        break;
      }
      depth--;
    } else if (char === "," && depth === 0) {
      commas++;
    }
  }

  if (openParenIdx === -1) return null;

  // Extract call expression before '('
  const expr = lineBefore.slice(0, openParenIdx).trim();
  const match = expr.match(/([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)?)$/);
  if (!match) return null;

  const callee = match[1];
  const currentIndex = getFileIndex(currentFilePath, currentContent);
  if (!currentIndex) return null;

  let targetSymbol = null;

  if (callee.includes(".")) {
    const [alias, funcName] = callee.split(".");
    const matchedImport = currentIndex.imports.find(
      (imp) => imp.alias.toLowerCase() === alias.toLowerCase()
    );

    if (matchedImport) {
      const resolvedPath = resolveImportPath(currentFilePath, matchedImport.path);
      if (resolvedPath) {
        const targetIndex = getFileIndex(resolvedPath);
        targetSymbol = targetIndex?.flatSymbols.get(funcName) ?? null;
      }
    }
  } else {
    // Local functions in the current file are handled exclusively by the official language extension,
    // which provides richer syntax-highlighted parameter descriptions and type annotations.
    return null;
  }

  if (!targetSymbol || targetSymbol.kind !== "Function") {
    return null;
  }

  const paramString = targetSymbol.signature?.params ?? "";
  const params = paramString
    ? paramString.split(",").map((p) => p.trim()).filter(Boolean)
    : [];

  const retType = targetSymbol.signature?.returnType ? ` : ${targetSymbol.signature.returnType}` : "";
  const label = `${targetSymbol.name}(${paramString})${retType}`;
  const activeParameter = Math.min(commas, Math.max(0, params.length - 1));

  return {
    label,
    parameters: params,
    activeParameter,
    docComment: targetSymbol.docComment,
  };
}

/**
 * Scan all .fcg and .fcc files in the workspace / Assets directory.
 *
 * @param {string} dir
 * @param {string[]} [list=[]]
 * @returns {string[]}
 */
function scanWorkspaceFcFiles(dir, list = []) {
  if (!fs.existsSync(dir)) return list;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "Temp") {
          scanWorkspaceFcFiles(fullPath, list);
        }
      } else if (/\.(fcg|fcc)$/i.test(entry.name)) {
        list.push(fullPath);
        fileNameToPathMap.set(entry.name.toLowerCase(), fullPath);
      }
    }
  } catch {
    return list;
  }

  return list;
}


/**
 * Rebuild the unified in-memory symbol list from all indexed files.
 */
function rebuildWorkspaceSymbolList() {
  workspaceSymbolList = [];
  for (const symbols of fileSymbolsMap.values()) {
    for (let i = 0; i < symbols.length; i++) {
      workspaceSymbolList.push(symbols[i]);
    }
  }
  workspaceSymbolsDirty = false;
}

/**
 * Search symbols matching query across the entire workspace (for Ctrl + T).
 *
 * @param {string} startPath
 * @param {string} query
 * @param {number} [maxResults=50]
 * @param {() => boolean} [cancellationChecker]
 * @returns {{ name: string, kind: string, containerName: string, filePath: string, range: import("./extractor.mjs").SourceRange }[]}
 */
export function searchWorkspaceSymbols(startPath, query, maxResults = 50, cancellationChecker = null) {
  if (!startPath || !query || query.trim().length === 0) {
    return [];
  }

  const root = findAssetsRoot(startPath) ?? path.resolve(startPath);
  if (!cachedFileList || cachedFileListRoot !== root) {
    cachedFileList = scanWorkspaceFcFiles(root);
    cachedFileListRoot = root;
  }

  // Ensure all workspace files have been indexed into memory
  for (let i = 0; i < cachedFileList.length; i++) {
    if (cancellationChecker?.()) return [];
    const filePath = cachedFileList[i];
    if (!fileIndexCache.has(filePath)) {
      getFileIndex(filePath);
    }
  }

  if (workspaceSymbolsDirty) {
    rebuildWorkspaceSymbolList();
  }

  const lowerQuery = query.toLowerCase();
  const scored = [];

  for (let i = 0; i < workspaceSymbolList.length; i++) {
    // Check cancellation periodically to abort promptly when user continues typing
    if (i % CANCELLATION_CHECK_INTERVAL === 0 && cancellationChecker?.()) {
      return [];
    }

    const sym = workspaceSymbolList[i];
    const lowerName = sym.lowerName;
    if (!lowerName.includes(lowerQuery)) {
      continue;
    }

    let score = 0;
    if (lowerName === lowerQuery) {
      score = SCORE_EXACT_MATCH;
    } else if (lowerName.startsWith(lowerQuery)) {
      score = SCORE_PREFIX_MATCH + Math.max(0, LENGTH_NORMALIZATION_BASE - sym.name.length);
    } else if (sym.name.includes(query)) {
      score = SCORE_EXACT_CASE_MATCH + Math.max(0, LENGTH_NORMALIZATION_BASE - sym.name.length);
    } else {
      score = SCORE_SUBSTRING_MATCH + Math.max(0, LENGTH_NORMALIZATION_BASE - sym.name.length);
    }

    if (sym.kind === "Graph" || sym.kind === "Tuple" || sym.kind === "Enum") {
      score += BONUS_PRIMARY_DECL;
    } else if (sym.kind === "Function") {
      score += BONUS_FUNCTION;
    }

    scored.push({ sym, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults).map((s) => s.sym);
}

/**
 * Asynchronously warm up the workspace symbol index in small non-blocking chunks.
 *
 * @param {string} startPath
 * @param {() => boolean} [cancellationChecker]
 * @returns {Promise<void>}
 */
export async function warmupWorkspaceIndex(startPath, cancellationChecker = null) {
  if (!startPath) return;
  const root = findAssetsRoot(startPath) ?? path.resolve(startPath);
  if (!cachedFileList || cachedFileListRoot !== root) {
    cachedFileList = scanWorkspaceFcFiles(root);
    cachedFileListRoot = root;
  }

  for (let i = 0; i < cachedFileList.length; i++) {
    if (cancellationChecker?.()) return;
    const filePath = cachedFileList[i];
    if (!fileIndexCache.has(filePath)) {
      getFileIndex(filePath);
    }
    // Yield every N files to keep the VS Code event loop responsive
    if (i % WARMUP_YIELD_INTERVAL === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  if (workspaceSymbolsDirty) {
    rebuildWorkspaceSymbolList();
  }
}

/**
 * Update the index entry for a single file (e.g. on file save or document change).
 *
 * @param {string} filePath
 * @param {string} [overrideContent]
 */
export function updateFileIndex(filePath, overrideContent = null) {
  if (!filePath) return;
  const normalized = path.normalize(filePath);
  getFileIndex(normalized, overrideContent);
}

/**
 * Remove a deleted file from the symbol index.
 *
 * @param {string} filePath
 */
export function removeFileFromIndex(filePath) {
  if (!filePath) return;
  const normalized = path.normalize(filePath);
  fileIndexCache.delete(normalized);
  fileSymbolsMap.delete(normalized);
  fileNameToPathMap.delete(path.basename(normalized).toLowerCase());
  workspaceSymbolsDirty = true;
  if (cachedFileList) {
    cachedFileList = cachedFileList.filter((f) => f !== normalized);
  }
}
