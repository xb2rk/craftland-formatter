// =============================================================================
// rules/imports.ts - import collection, grouping, sorting, and rendering.
//
// FC import grammar (from the official FCGParser, rules `importDecl`):
//   library style : IMPORT STRING_LIT [AS IDENTIFIER]
//   script  style : IMPORT IDENTIFIER [AS IDENTIFIER] [FROM STRING_LIT]
// Token kinds come from `tokenizer.ts` (`TokenKind`, derived from FCGLexer).
//
// Formatting rule: imports are sorted into five stable buckets and re-emitted
// at the top of the file. This mirrors the tool the user saw at the meeting
// (it reorders/normalizes imports on save). All behavior is driven by
// `FormatConfig.importSort` (see `config.ts`) so it is fully configurable.
//
// Bucket order (outer -> inner):
//   1. std       : library imports ending in `.fcc` that are NOT stdlib/res
//                  (e.g. "List.fcc", "Map.fcc", "Math.fcc", "Time.fcc").
//   2. stdlib    : the reserved "StdLibrary.fcc".
//   3. editorgelib: "EditorGenLib.fcc" and any "Res/..." path.
//   4. contracts : "../Contracts/..." paths.
//   5. relative  : other relative (script) imports, sorted by path depth.
// A blank line separates buckets when `blankLineBetweenGroups` is true.
// =============================================================================

import { Item, isCommentItem } from "../items.js";
import { Token, TokenKind } from "../tokenizer.js";
import { FormatConfig, ImportGroup } from "../config.js";
import { Doc, concat, text, hardline, nil } from "../doc.js";

export interface ImportStatement {
  style: "library" | "script";
  /** Library path (library style) or `from` path (script style). */
  path: string;
  /** Alias after `as`. */
  alias: string;
  /** Script-style import name (before `as`). */
  name: string | null;
  group: ImportGroup;
  /** Inclusive item index range in the source `Item[]` (for removal). */
  itemStart: number;
  itemEnd: number; // exclusive
}

const RESERVED_LIBS = new Set(["StdLibrary.fcc", "EditorGenLib.fcc"]);

// Import aliases (and script-style names) are usually identifiers, but FC also
// permits type names that the lexer classifies as keywords (e.g. `Map`,
// `List`, `Vector3`). Accept those as alias/name tokens too; otherwise an alias
// like `import "Map.fcc" as Map` would fail to parse.
const NAME_KEYWORDS = new Set<TokenKind>([
  TokenKind.MAP,
  TokenKind.LIST,
  TokenKind.VECTOR2,
  TokenKind.VECTOR3,
  TokenKind.QUATERNION,
  TokenKind.COLOR,
  TokenKind.LOC_STRING,
  TokenKind.ENTITY,
  TokenKind.OBJECT,
  TokenKind.BOOL,
  TokenKind.INT,
  TokenKind.INT64,
  TokenKind.FLOAT,
  TokenKind.STRING,
  TokenKind.TYPE,
]);

function isNameToken(k: TokenKind): boolean {
  return k === TokenKind.IDENTIFIER || NAME_KEYWORDS.has(k);
}

export function classifyImport(path: string): ImportGroup {
  // Contracts imports may be nested (e.g. "../../Contracts/CustomEnum.fcc"),
  // so detect by the `Contracts/` segment before the `.fcc` suffix check.
  if (path.includes("Contracts/")) return "contracts";
  // Required toolchain libs are grouped together in the `stdlib` bucket.
  if (RESERVED_LIBS.has(path)) return "stdlib";
  if (path.startsWith("Res/") || path === "EditorGenLib.fcc") return "stdlib";
  if (path.endsWith(".fcc")) return "std";
  return "relative";
}

/** Parse one import statement starting at `items[start]` (which is IMPORT). */
function parseImport(items: Item[], start: number): ImportStatement {
  const tok = (i: number): Token => items[i].tok;
  let j = start + 1;
  let path = "";
  let alias = "";
  let name: string | null = null;
  let style: "library" | "script" = "library";

  if (tok(j).kind === TokenKind.INTERPRETED_STRING_LIT) {
    path = stripQuotes(tok(j).text);
    j++;
    if (tok(j)?.kind === TokenKind.AS) {
      j++;
      const q = readQualified(items, j);
      if (q.text) {
        alias = q.text;
        j = q.next;
      }
    }
  } else if (tok(j) && isNameToken(tok(j).kind)) {
    name = tok(j).text;
    style = "script";
    j++;
    if (tok(j)?.kind === TokenKind.AS) {
      j++;
      const q = readQualified(items, j);
      if (q.text) {
        alias = q.text;
        j = q.next;
      }
    }
    if (tok(j)?.kind === TokenKind.FROM) {
      j++;
      if (tok(j)?.kind === TokenKind.INTERPRETED_STRING_LIT) {
        path = stripQuotes(tok(j).text);
        j++;
      }
    }
  }

  // Consume trailing comment (if any) as part of the statement range.
  while (j < items.length && isCommentItem(items[j]) && items[j].lineBreaks === 0) j++;

  return {
    style,
    path,
    alias,
    name,
    group: classifyImport(path),
    itemStart: start,
    itemEnd: j,
  };
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'")) return s.slice(1, -1);
  return s;
}

// Read a qualified identifier: name (DOT name)*. The FC grammar's import alias
// is a `qualifiedIdent` (see `importFile`/`importPartFile` in the official
// FCGParser), so an alias may contain dots (e.g. `EditorGenLib.Res`).
function readQualified(items: Item[], j: number): { text: string; next: number } {
  if (j >= items.length || !isNameToken(items[j].tok.kind)) return { text: "", next: j };
  let text = items[j].tok.text;
  j++;
  while (j < items.length && items[j].tok.kind === TokenKind.DOT) {
    text += ".";
    j++;
    if (j < items.length && isNameToken(items[j].tok.kind)) {
      text += items[j].tok.text;
      j++;
    }
  }
  return { text, next: j };
}

function relativeDepth(path: string): number {
  const m = path.match(/\.\.\//g);
  return m ? m.length : 0;
}

/**
 * Collect all import statements from the item list. FC requires imports at the
 * top of a file, so we only collect the leading contiguous run; any non-import
 * code before the first import stops collection (preserving unusual files).
 * Returns the statements and a set of item indices that belong to them.
 */
export function collectImports(items: Item[]): {
  imports: ImportStatement[];
  importItemIndices: Set<number>;
} {
  const imports: ImportStatement[] = [];
  const idx = new Set<number>();
  let i = 0;
  while (i < items.length) {
    if (items[i].tok.kind === TokenKind.IMPORT) {
      const stmt = parseImport(items, i);
      for (let k = stmt.itemStart; k < stmt.itemEnd; k++) idx.add(k);
      imports.push(stmt);
      i = stmt.itemEnd;
      continue;
    }
    // Only treat the leading run as imports: break once we hit a real
    // statement (code token that is not an import and not a comment). A
    // comment-only / blank prefix before imports is allowed.
    if (!isCommentItem(items[i]) && items[i].tok.kind !== TokenKind.IMPORT) {
      break;
    }
    i++;
  }
  return { imports, importItemIndices: idx };
}

/** Sort imports per `config.importSort` (stable within a bucket). */
export function sortImports(imports: ImportStatement[], cfg: FormatConfig): ImportStatement[] {
  const order = cfg.importSort.order;
  const rank = (g: ImportGroup): number => {
    const i = order.indexOf(g);
    return i < 0 ? order.length : i;
  };
  return [...imports].sort((a, b) => {
    const ra = rank(a.group);
    const rb = rank(b.group);
    if (ra !== rb) return ra - rb;
    if (a.group === "relative") {
      const da = relativeDepth(a.path);
      const db = relativeDepth(b.path);
      const cmp =
        cfg.importSort.relativeDepthOrder === "descending" ? db - da : da - db;
      if (cmp !== 0) return cmp;
    }
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

/** Render the import block as a `Doc`. */
export function renderImports(imports: ImportStatement[], cfg: FormatConfig): Doc {
  if (imports.length === 0) return nil();
  const sorted = cfg.importSort.enabled ? sortImports(imports, cfg) : imports;
  const parts: Doc[] = [];
  let prevGroup: ImportGroup | null = null;
  sorted.forEach((imp, i) => {
    if (i > 0) {
      if (cfg.importSort.blankLineBetweenGroups && imp.group !== prevGroup) {
        parts.push(hardline()); // blank line between buckets
      }
      parts.push(hardline());
    }
    const line =
      imp.style === "library"
        ? imp.alias
          ? `import "${imp.path}" as ${imp.alias}`
          : `import "${imp.path}"`
        : imp.alias
          ? `import ${imp.name} as ${imp.alias} from "${imp.path}"`
          : `import ${imp.name} from "${imp.path}"`;
    parts.push(text(line));
    prevGroup = imp.group;
  });
  parts.push(hardline());
  return concat(parts);
}
