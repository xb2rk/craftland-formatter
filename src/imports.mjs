/**
 * @fileoverview Reorders import declarations into canonical groups while
 * preserving attached comments, trailing inline comments, and verbatim literal bytes.
 */

/** @typedef {import("./types/ast.d.ts").SyntaxNode} SyntaxNode */
/** @typedef {import("./types/ast.d.ts").Token} Token */

/** Token kinds representing line or block comments. */
const COMMENTS = new Set(["LINE_COMMENT", "COMMENT"]);

/**
 * Canonical import classification groups in order of presentation:
 * - LIBRARY (0): Standard engine/SDK libraries (non-relative paths).
 * - CONTRACTS (1): Cross-system interface definitions (paths traversing 'Contracts').
 * - SCRIPTS (2): Relative workspace module imports (../ or ./).
 */
export const IMPORT_GROUP = Object.freeze({
  LIBRARY: 0,
  CONTRACTS: 1,
  SCRIPTS: 2,
});

/**
 * Pinned sort rank for primary Craftland Studio system libraries within group 0.
 * "StdLibrary.fcc" must precede "EditorGenLib.fcc" according to compiler conventions.
 */
const RESERVED_LIB_ORDER = Object.freeze({
  "stdlibrary.fcc": 1,
  "editorgenlib.fcc": 2,
});

/** Regex matching relative parent directory navigation prefixes (e.g. "../../"). */
const PARENT_DEPTH_REGEX = /^(?:\.\.\/)+/;

/**
 * Gets the pinned priority rank for standard library imports.
 * @param {string} path - Import module path.
 * @returns {number} Rank (1 for StdLibrary, 2 for EditorGenLib, 0 for other).
 */
function getReservedOrder(path) {
  return RESERVED_LIB_ORDER[path.toLowerCase()] ?? 0;
}

/**
 * Measures the directory nesting depth of a relative import path.
 * Deeper parent paths (e.g. "../../") sort above shallower paths ("../").
 *
 * @param {string} path - Relative import path.
 * @returns {number} Character length of leading parent prefixes.
 */
function getParentDepth(path) {
  return path.match(PARENT_DEPTH_REGEX)?.[0].length ?? 0;
}

/**
 * Compare two strings lexicographically.
 * @param {string} left
 * @param {string} right
 * @returns {-1 | 0 | 1}
 */
function compareText(left, right) {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

/**
 * Normalize import file paths by converting backslashes to forward slashes and collapsing duplicates.
 * @param {string} path
 * @returns {string}
 */
function normalize(path) {
  return path.replaceAll("\\", "/").replace(/\/+/g, "/");
}

/**
 * Classify an import path into one of three canonical sorting groups:
 * - Group 0: Library / SDK imports (non-relative paths, e.g. "StdLibrary.fcc", "EditorGenLib.fcc").
 * - Group 1: Contract / interface imports (relative paths traversing into "Contracts").
 * - Group 2: Relative script imports (e.g. "../Core/GameLoop.fcg", "./Utils.fcg").
 *
 * @param {string} path
 * @returns {0 | 1 | 2}
 */
function classification(path) {
  if (!/^\.\.?\//.test(path)) {
    return IMPORT_GROUP.LIBRARY;
  }

  const isContract = path.split("/").some((segment) => segment.toLowerCase() === "contracts");
  if (isContract) {
    return IMPORT_GROUP.CONTRACTS;
  }

  return IMPORT_GROUP.SCRIPTS;
}

/**
 * Compare two import records according to Craftland FC import ordering rules:
 * 1. Primary sort: Group tier (0 = Library, 1 = Contracts, 2 = Scripts).
 * 2. Group 0 tie-breaker: Pinned system order ("stdlibrary.fcc" first, "editorgenlib.fcc" second).
 * 3. Group 2 tie-breaker: Directory nesting depth (deeper relative parents like "../../" come first).
 * 4. Alphabetic sort by normalized path (stripping leading "./").
 * 5. Stable order preservation for identical paths.
 *
 * @param {{ path: string, group: number, order: number }} left
 * @param {{ path: string, group: number, order: number }} right
 * @returns {number}
 */
function compareImports(left, right) {
  const groupDifference = left.group - right.group;
  if (groupDifference !== 0) {
    return groupDifference;
  }

  if (left.group === IMPORT_GROUP.LIBRARY) {
    const rankDifference = getReservedOrder(left.path) - getReservedOrder(right.path);

    if (rankDifference !== 0) {
      return rankDifference;
    }
  } else if (left.group === IMPORT_GROUP.SCRIPTS) {
    const depthDifference = getParentDepth(right.path) - getParentDepth(left.path);

    if (depthDifference !== 0) {
      return depthDifference;
    }
  }

  const leftComparable = left.path.replace(/^\.\//, "");
  const rightComparable = right.path.replace(/^\.\//, "");

  return compareText(leftComparable, rightComparable) || (left.order - right.order);
}

/**
 * Organizes and sorts import declarations in the source text.
 *
 * Attached comments (both preceding comments on their own line and trailing inline
 * comments on the same line) move along with their respective import.
 * If a detached banner comment or ignore marker is detected, sorting is safely aborted.
 *
 * @param {string} source - The original source code text.
 * @param {SyntaxNode & { tokens: Token[] }} tree - The parsed concrete syntax tree.
 * @param {readonly { start: number, end: number }[]} ignored - Protected source spans from pragmas.
 * @param {string} eol - The configured newline sequence ("\n" or "\r\n").
 * @returns {string} The updated source text with imports organized, or the original source if unchanged.
 */
export function organizeImports(source, tree, ignored, eol) {
  const imports = tree.children.filter((node) => node.kind === "Import");
  const lastImport = imports.at(-1);

  // Guard: Nothing to organize if fewer than 2 imports exist, or if any import
  // falls within an ignored pragma range.
  if (imports.length < 2 || (lastImport && ignored.some((range) => range.start < lastImport.end))) {
    return source;
  }

  const records = [];

  for (const [order, node] of imports.entries()) {
    const nodeTokens = tree.tokens.filter((token) => token.start >= node.start && token.end <= node.end);
    const pathToken = nodeTokens.find((token) =>
      ["INTERPRETED_STRING_LIT", "RAW_STRING_LIT"].includes(token.kind));

    if (!pathToken) {
      continue;
    }

    const path = normalize(pathToken.text.slice(1, -1));
    let start = node.start;
    let end = node.end;

    // Attach preceding comments that directly belong to this import line.
    const previousRecordEnd = records.at(-1)?.end ?? 0;
    const leadingComments = tree.tokens.filter((token) =>
      COMMENTS.has(token.kind) && token.end <= start && token.start >= previousRecordEnd
    );

    for (const token of leadingComments.reverse()) {
      const gap = source.slice(token.end, start);
      const lineStart = source.lastIndexOf("\n", token.start - 1) + 1;
      const prefix = source.slice(lineStart, token.start);

      const isLineEmpty = /^[ \t]*$/.test(prefix);
      const isGapWhitespace = /^\s*$/.test(gap);
      const newlineCount = (gap.match(/\r\n|\r|\n/g) ?? []).length;

      // Stop attaching if the comment is preceded by non-whitespace or separated by blank lines.
      if (!isLineEmpty || !isGapWhitespace || newlineCount > 1) {
        break;
      }

      start = token.start;
    }

    // Attach trailing inline comments on the same line after the import.
    const trailingComments = tree.tokens.filter((token) =>
      COMMENTS.has(token.kind) && token.start >= end
    );

    for (const comment of trailingComments) {
      if (!/^[ \t]*$/.test(source.slice(end, comment.start))) {
        break;
      }

      end = comment.end;
    }

    records.push({
      start,
      end,
      path,
      group: classification(path),
      order,
      text: source.slice(start, end),
    });
  }

  // A detached banner comment between imports acts as an explicit boundary.
  // Preserve its exact placement rather than silently rearranging or losing it.
  const hasDetachedBanner = records.some((record, index) =>
    index > 0 && /\S/.test(source.slice(records[index - 1].end, record.start))
  );

  if (hasDetachedBanner) {
    return source;
  }

  const sorted = [...records].sort(compareImports);

  // Grouped imports have an extra blank line between different group tiers.
  const formattedImports = sorted.map((record, index) => {
    if (index === 0) {
      return record.text;
    }

    const isDifferentGroup = record.group !== sorted[index - 1].group;
    const separator = eol.repeat(isDifferentGroup ? 2 : 1);

    return separator + record.text;
  }).join("");

  return source.slice(0, records[0].start) + formattedImports + source.slice(records.at(-1).end);
}
