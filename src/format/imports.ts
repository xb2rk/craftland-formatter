/**
 * @module format/imports - grammar-aware import collection and deterministic rendering.
 */

import { TokenId } from "../lex/grammar.generated.js";
import type { Item } from "../lex/items.js";
import { importBucket } from "../shared/import-bucket.js";

/** The kind of import declaration. */
export enum ImportKind {
  Library = "library",
  Script = "script",
}

/** Structured view of one syntactically valid import declaration. */
export interface ImportSpec {
  kind: ImportKind;
  /** Library: quoted module path without delimiters; script: imported name. */
  raw: string;
  /** Optional script alias; mandatory for library imports. */
  alias?: string;
  /** Script-only path without quote delimiters. */
  from?: string;
}

/** Token kinds for string literals. */
const STRING_KINDS = new Set<TokenId>([TokenId.INTERPRETED_STRING_LIT, TokenId.RAW_STRING_LIT]);
/** Token kinds that open a delimiter. */
const OPEN_KINDS = new Set<TokenId>([TokenId.L_PAREN, TokenId.L_BRACKET, TokenId.L_CURLY]);
/** Token kinds that close a delimiter. */
const CLOSE_KINDS = new Set<TokenId>([TokenId.R_PAREN, TokenId.R_BRACKET, TokenId.R_CURLY]);
/** Regex for a valid identifier. */
const IDENTIFIER_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/**
 * Check if an item is a string literal.
 *
 * @param item - item to test.
 * @returns true for interpreted/raw string.
 */
function isString(item: Item | undefined): boolean {
  return item !== undefined && STRING_KINDS.has(item.token.kind);
}

/**
 * Check if an item is a valid name token.
 *
 * @param item - item to test.
 * @returns true if it matches an identifier.
 */
function isName(item: Item | undefined): item is Item {
  return item !== undefined && item.token.kind !== TokenId.EOF && IDENTIFIER_RE.test(item.token.text);
}

/**
 * Remove surrounding quotes/backticks from a string literal.
 *
 * @param value - raw token text.
 * @returns unquoted content.
 */
function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("`") && value.endsWith("`")))) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Quote a value as a double-quoted string literal.
 *
 * @param value - unquoted content.
 * @returns quoted literal.
 */
function quote(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

/**
 * Parse one import declaration starting at `import`.
 *
 * @param items - full item list.
 * @param start - index of the `import` token.
 * @returns parsed spec and end index.
 * @throws {Error} when syntax is invalid.
 */
function parseImport(items: readonly Item[], start: number): { spec: ImportSpec; end: number } {
  const first = items[start + 1];
  if (!first) {
    throw new Error(`import at token ${start} has no target`);
  }

  // Library import: `import "path" as Alias`
  if (isString(first)) {
    const aliasKeyword = items[start + 2];
    const alias = items[start + 3];
    if (aliasKeyword?.token.kind !== TokenId.AS || !isName(alias)) {
      throw new Error(`library import at token ${start} requires a single alias after 'as'`);
    }
    return { spec: { kind: ImportKind.Library, raw: unquote(first.token.text), alias: alias.token.text }, end: start + 3 };
  }

  if (!isName(first)) {
    throw new Error(`script import at token ${start} requires an imported name`);
  }
  let cursor = start + 2;
  let alias: string | undefined;
  if (items[cursor]?.token.kind === TokenId.AS) {
    const aliasItem = items[cursor + 1];
    if (!isName(aliasItem)) {
      throw new Error(`script import at token ${start} has an invalid alias`);
    }
    alias = aliasItem.token.text;
    cursor += 2;
  }
  const pathItem = items[cursor + 1];
  if (!pathItem || items[cursor]?.token.kind !== TokenId.FROM || !isString(pathItem)) {
    throw new Error(`script import at token ${start} requires 'from "path"'`);
  }
  return {
    spec: { kind: ImportKind.Script, raw: first.token.text, ...(alias ? { alias } : {}), from: unquote(pathItem.token.text) },
    end: cursor + 1,
  };
}

/**
 * Collect top-level imports in source order. Delimiter depth prevents an
 * import-like token in a malformed body from being mistaken for a declaration.
 */
export function collectImports(items: readonly Item[]): ImportSpec[] {
  const result: ImportSpec[] = [];
  let depth = 0;
  for (let index = 0; index < items.length; index += 1) {
    const kind = items[index]!.token.kind;
    if (OPEN_KINDS.has(kind)) {
      depth += 1;
      continue;
    }
    if (CLOSE_KINDS.has(kind)) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && kind === TokenId.IMPORT) {
      const parsed = parseImport(items, index);
      result.push(parsed.spec);
      index = parsed.end;
    }
  }
  return result;
}

/**
 * Get the sort key path for an import.
 *
 * @param spec - import spec.
 * @returns library path or script `from` path.
 */
function pathOf(spec: ImportSpec): string {
  return spec.kind === ImportKind.Library ? spec.raw : spec.from ?? "";
}

/**
 * Seven deterministic buckets from the formatter contract (delegates to shared bucket).
 *
 * @param spec - import spec.
 * @returns bucket index.
 */
function bucketOf(spec: ImportSpec): number {
  return importBucket(spec.kind === ImportKind.Library ? "library" : "script", pathOf(spec));
}

/**
 * Map bucket to visual group for blank insertion.
 *
 * @param bucket - bucket 0–6.
 * @returns group 0–3.
 */
function bucketGroup(bucket: number): number {
  if (bucket <= 3) {
    return 0;
  }
  if (bucket === 4) {
    return 1;
  }
  if (bucket === 5) {
    return 2;
  }
  return 3;
}

/**
 * Sort imports by bucket, then path, then raw name.
 *
 * @param imports - unsorted imports.
 * @returns sorted imports.
 */
function sortedImports(imports: readonly ImportSpec[]): ImportSpec[] {
  return imports
    .map((spec, index) => ({ spec, index }))
    .sort((left, right) => {
      const bucket = bucketOf(left.spec) - bucketOf(right.spec);
      if (bucket !== 0) {
        return bucket;
      }
      const path = pathOf(left.spec).localeCompare(pathOf(right.spec), "en", { sensitivity: "base" });
      if (path !== 0) {
        return path;
      }
      const raw = left.spec.raw.localeCompare(right.spec.raw, "en", { sensitivity: "base" });
      return raw !== 0 ? raw : left.index - right.index;
    })
    .map(({ spec }) => spec);
}

/**
 * Render one import to source text.
 *
 * @param spec - import spec.
 * @returns source line.
 * @throws {Error} when required fields are missing.
 */
function renderOne(spec: ImportSpec): string {
  if (spec.kind === ImportKind.Library) {
    if (!spec.alias) {
      throw new Error(`library import ${spec.raw} cannot render without an alias`);
    }
    if (spec.alias.includes(".")) {
      throw new Error(`import alias '${spec.alias}' must be one identifier`);
    }
    return `import ${quote(spec.raw)} as ${spec.alias}`;
  }
  if (!spec.from) {
    throw new Error(`script import ${spec.raw} cannot render without a source path`);
  }
  if (spec.alias?.includes(".")) {
    throw new Error(`import alias '${spec.alias}' must be one identifier`);
  }
  return `import ${spec.raw}${spec.alias ? ` as ${spec.alias}` : ""} from ${quote(spec.from)}`;
}

/**
 * Sort and render imports, inserting one blank line between groups.
 *
 * @param imports - unsorted imports.
 * @returns rendered imports block.
 */
export function renderImports(imports: readonly ImportSpec[]): string {
  const sorted = sortedImports(imports);
  const lines: string[] = [];
  let previousGroup: number | undefined;
  for (const spec of sorted) {
    const bucket = bucketOf(spec);
    const group = bucketGroup(bucket);
    if (previousGroup !== undefined && group !== previousGroup) {
      lines.push("");
    }
    lines.push(renderOne(spec));
    previousGroup = group;
  }
  return lines.join("\n");
}
