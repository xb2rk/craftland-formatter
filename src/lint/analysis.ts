/**
 * @module lint/analysis - shared analysis and helpers for the linter.
 * Extracted from `index.ts` to keep the rule orchestrator small.
 */

import { TokenId } from "../lex/grammar.generated.js";
import { classify, DelimKind, isNode, type Content, type Node } from "../syntax/classifier.js";
import { itemize, type Item, type LexedDocument } from "../lex/items.js";
import { tokenize } from "../lex/tokenizer.js";
import { importBucket } from "../shared/import-bucket.js";
import { JSDOC_LOOKBACK_ITEMS } from "../shared/constants.js";

/** Identifier character sets. */
const IDENTIFIER_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const PASCAL_CASE_RE = /^[A-Z][A-Za-z0-9]*$/u;
const CAMEL_CASE_RE = /^[a-z][A-Za-z0-9]*$/u;
const CONSTANT_NAME_RE = /^_[A-Z][A-Z0-9_]*$/u;

/** Delimiter token sets. */
export const OPEN_KINDS = new Set<TokenId>([TokenId.L_PAREN, TokenId.L_BRACKET, TokenId.L_CURLY]);
export const CLOSE_KINDS = new Set<TokenId>([TokenId.R_PAREN, TokenId.R_BRACKET, TokenId.R_CURLY]);
/** Declaration kinds that may need JSDoc. */
export const DECLARATION_KINDS = new Set<TokenId>([
  TokenId.FUNC,
  TokenId.EVENT,
  TokenId.COMPONENT,
  TokenId.TUPLE,
  TokenId.ENUM,
  TokenId.GRAPH,
]);
export const ENUM_KINDS = new Set<TokenId>([TokenId.ENUM]);
export const PREFIX_KINDS = new Set<TokenId>([TokenId.STATIC, TokenId.READONLY, TokenId.ASYNC, TokenId.PARTIAL, TokenId.EXPORT]);
export const PLATFORM_NAMES = new Set(["platform_server", "platform_client"]);
export const GRAPH_KINDS = new Set<TokenId>([TokenId.GRAPH]);
export const VECTOR_CONSTRUCTOR_KINDS = new Set<TokenId>([TokenId.VECTOR2, TokenId.VECTOR3, TokenId.QUATERNION]);

export interface ImportFact {
  kind: "library" | "script";
  raw: string;
  path: string;
  alias?: string;
  importItem: Item;
  aliasItem?: Item;
  aliasEndItem?: Item;
  pathItem?: Item;
  endItem: Item;
}

export interface QualifiedName {
  text: string;
  first: Item;
  last: Item;
  endIndex: number;
}

export interface Analysis {
  source: string;
  document: LexedDocument;
  root: Node;
  items: readonly Item[];
  itemIndex: Map<Item, number>;
  owner: Map<Item, Node>;
  nodes: Node[];
}

/**
 * Check if text is a valid identifier.
 *
 * @param text - text to test.
 * @returns true for identifiers.
 */
export function isName(text: string): boolean {
  return IDENTIFIER_RE.test(text);
}

/**
 * Check if text is PascalCase.
 *
 * @param text - text to test.
 * @returns true for `A-Z` start.
 */
export function isPascalCase(text: string): boolean {
  return PASCAL_CASE_RE.test(text);
}

/**
 * Check if text is camelCase.
 *
 * @param text - text to test.
 * @returns true for `a-z` start.
 */
export function isCamelCase(text: string): boolean {
  return CAMEL_CASE_RE.test(text);
}

/**
 * Check if text is a constant name (`_UPPER_SNAKE`).
 *
 * @param text - text to test.
 * @returns true for constant style.
 */
export function isConstantName(text: string): boolean {
  return CONSTANT_NAME_RE.test(text);
}

/**
 * Remove surrounding quotes/backticks.
 *
 * @param text - raw literal text.
 * @returns unquoted content.
 */
export function unquote(text: string): string {
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("`") && text.endsWith("`")))) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Check if an item has a given token kind.
 *
 * @param item - item to test.
 * @param kind - expected kind.
 * @returns true on match.
 */
export function sameToken(item: Item | undefined, kind: TokenId): boolean {
  return item?.token.kind === kind;
}

/**
 * Read an import alias while retaining dotted spellings for a precise diagnostic.
 *
 * @param items - item list.
 * @param start - start index.
 * @returns qualified name or undefined.
 */
export function readQualifiedName(items: readonly Item[], start: number): QualifiedName | undefined {
  const first = items[start];
  if (!first || !isName(first.token.text)) {
    return undefined;
  }
  const parts = [first.token.text];
  let last = first;
  let endIndex = start;
  for (let index = start + 1; index + 1 < items.length; index += 2) {
    const dot = items[index]!;
    const next = items[index + 1]!;
    if (dot.token.kind !== TokenId.DOT || !isName(next.token.text)) {
      break;
    }
    if (next.token.span.start.line !== first.token.span.start.line) {
      break;
    }
    parts.push(next.token.text);
    last = next;
    endIndex = index + 1;
  }
  return { text: parts.join("."), first, last, endIndex };
}

/**
 * Build a full analysis from source (or reuse a supplied document).
 *
 * @param source - raw source text.
 * @param suppliedDocument - optional pre-built document.
 * @returns analysis with indexes and ownership.
 */
export function buildAnalysis(source: string, suppliedDocument?: LexedDocument): Analysis {
  const document = suppliedDocument ?? itemize(tokenize(source));
  const root = classify(document);
  const itemIndex = new Map<Item, number>();
  document.items.forEach((item, index) => {
    itemIndex.set(item, index);
  });
  const owner = new Map<Item, Node>();
  const nodes: Node[] = [];
  const visit = (node: Node): void => {
    nodes.push(node);
    for (const entry of node.content) {
      if (isNode(entry)) {
        if (entry.open) {
          owner.set(entry.open, node);
        }
        if (entry.close) {
          owner.set(entry.close, node);
        }
        visit(entry);
      } else {
        owner.set(entry, node);
      }
    }
  };
  visit(root);
  return { source, document, root, items: document.items, itemIndex, owner, nodes };
}

/**
 * Project node content to a flat header (open/close tokens + direct items).
 *
 * @param content - node content.
 * @returns flattened header items.
 */
export function projectHeader(content: readonly Content[]): Item[] {
  const result: Item[] = [];
  for (const entry of content) {
    if (isNode(entry)) {
      if (entry.open) {
        result.push(entry.open);
      }
      if (entry.close) {
        result.push(entry.close);
      }
    } else {
      result.push(entry);
    }
  }
  return result;
}

/**
 * Get items on the same statement as a node's owner before the node.
 *
 * @param node - node to inspect.
 * @returns header items.
 */
export function directHeader(node: Node): Item[] {
  if (!node.parent) {
    return [];
  }
  const index = node.parent.content.indexOf(node);
  if (index < 0) {
    return [];
  }
  const prefix = node.parent.content.slice(0, index);
  let start = 0;
  // Walk backward to the last block boundary or semicolon.
  for (let cursor = prefix.length - 1; cursor >= 0; cursor -= 1) {
    const entry = prefix[cursor]!;
    if (isNode(entry) && entry.kind === DelimKind.Block && entry.close) {
      start = cursor + 1;
      break;
    }
    if (!isNode(entry) && entry.token.kind === TokenId.SEMI) {
      start = cursor + 1;
      break;
    }
  }
  return projectHeader(prefix.slice(start));
}

/**
 * Check if a node's header contains any of the given kinds.
 *
 * @param node - node to test.
 * @param kinds - token kinds to look for.
 * @returns true on match.
 */
export function hasHeader(node: Node, kinds: ReadonlySet<TokenId>): boolean {
  return directHeader(node).some((item) => kinds.has(item.token.kind));
}

/**
 * Check if a node's header is a graph header.
 *
 * @param node - node to test.
 * @returns true for graph.
 */
export function graphHeader(node: Node): boolean {
  return hasHeader(node, GRAPH_KINDS);
}

/**
 * Find the owning node for an item.
 *
 * @param analysis - analysis.
 * @param item - item to locate.
 * @returns owning node or undefined.
 */
export function containingNode(analysis: Analysis, item: Item): Node | undefined {
  return analysis.owner.get(item);
}

/**
 * Check if an item is inside any graph block.
 *
 * @param analysis - analysis.
 * @param item - item to test.
 * @returns true if inside a graph.
 */
export function isWithinGraph(analysis: Analysis, item: Item): boolean {
  let node = containingNode(analysis, item);
  while (node) {
    if (node.kind === DelimKind.Block && graphHeader(node)) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

/**
 * Check if an item is a direct field of a graph block.
 *
 * @param analysis - analysis.
 * @param item - item to test.
 * @returns true for direct graph fields.
 */
export function isDirectGraphField(analysis: Analysis, item: Item): boolean {
  const owner = containingNode(analysis, item);
  return Boolean(owner && owner.kind === DelimKind.Block && graphHeader(owner));
}

export type Severity = "error" | "warning" | "info";

export interface Edit {
  start: number;
  end: number;
  replacement: string;
}

export interface Diagnostic {
  ruleId: string;
  message: string;
  line: number;
  column: number;
  length: number;
  severity: Severity;
  fix?: Edit;
}

export function diagnosticForItem(
  ruleId: string,
  message: string,
  severity: Severity,
  item: Item,
  fix?: Edit,
): Diagnostic {
  const { start, end } = item.token.span;
  return {
    ruleId,
    message,
    line: start.line,
    column: start.column,
    length: Math.max(1, end.offset - start.offset),
    severity,
    ...(fix ? { fix } : {}),
  };
}

export function diagnosticForRange(
  ruleId: string,
  message: string,
  severity: Severity,
  first: Item,
  last: Item,
  fix?: Edit,
): Diagnostic {
  const start = first.token.span.start;
  const end = last.token.span.end;
  return {
    ruleId,
    message,
    line: start.line,
    column: start.column,
    length: Math.max(1, end.offset - start.offset),
    severity,
    ...(fix ? { fix } : {}),
  };
}

export function diagnosticAt(
  ruleId: string,
  message: string,
  severity: Severity,
  line: number,
  column: number,
  length: number,
  fix?: Edit,
): Diagnostic {
  return { ruleId, message, line, column, length: Math.max(1, length), severity, ...(fix ? { fix } : {}) };
}

/**
 * Check if a declaration at `index` has a preceding `/**` JSDoc comment.
 *
 * @param items - item list.
 * @param index - declaration index.
 * @returns true if documented.
 */
export function hasJSDoc(items: readonly Item[], index: number): boolean {
  const lower = Math.max(0, index - JSDOC_LOOKBACK_ITEMS);
  for (let cursor = index; cursor >= lower; cursor -= 1) {
    const item = items[cursor]!;
    for (let triviaIndex = item.before.length - 1; triviaIndex >= 0; triviaIndex -= 1) {
      const trivia = item.before[triviaIndex]!;
      if (trivia.kind === "block-comment" && trivia.token.text.trimStart().startsWith("/**")) {
        return true;
      }
    }
    // Stop at a preceding declaration - doc belongs to the closer one.
    if (cursor !== index && DECLARATION_KINDS.has(item.token.kind)) {
      return false;
    }
  }
  return false;
}

/**
 * Check if a bracket node is a platform qualifier `[platform_server]`.
 *
 * @param node - bracket node.
 * @returns true for platform qualifiers.
 */
export function isPlatformBracket(node: Node): boolean {
  return node.kind === DelimKind.Bracket && node.content.some((entry) => !isNode(entry) && PLATFORM_NAMES.has(entry.token.text));
}

/**
 * Check if a node is preceded by `graph [platform_*]` in the same header.
 *
 * @param node - node to test.
 * @returns true when platform-scoped.
 */
export function hasPlatformBefore(node: Node): boolean {
  if (!node.parent) {
    return false;
  }
  const index = node.parent.content.indexOf(node);
  let graphSeen = false;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const entry = node.parent.content[cursor]!;
    if (isNode(entry)) {
      if (isPlatformBracket(entry) && graphSeen) {
        return true;
      }
      if (entry.kind === DelimKind.Block) {
        return false;
      }
      continue;
    }
    if (entry.token.kind === TokenId.GRAPH) {
      graphSeen = true;
      continue;
    }
    if (entry.token.kind === TokenId.SEMI || entry.token.kind === TokenId.R_CURLY) {
      return false;
    }
  }
  return false;
}

/**
 * Get the previous direct item sibling before a node.
 *
 * @param node - node to inspect.
 * @returns previous item or undefined.
 */
export function previousDirectItem(node: Node): Item | undefined {
  if (!node.parent) {
    return undefined;
  }
  const index = node.parent.content.indexOf(node);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const entry = node.parent.content[cursor]!;
    if (!isNode(entry)) {
      return entry;
    }
    if (entry.close) {
      return entry.close;
    }
  }
  return undefined;
}

/**
 * Collect top-level import facts.
 *
 * @param items - item list.
 * @returns import facts in source order.
 */
export function collectImports(items: readonly Item[]): ImportFact[] {
  const imports: ImportFact[] = [];
  let depth = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (OPEN_KINDS.has(item.token.kind)) {
      depth += 1;
      continue;
    }
    if (CLOSE_KINDS.has(item.token.kind)) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0 || item.token.kind !== TokenId.IMPORT) {
      continue;
    }

    const target = items[index + 1];
    if (!target) {
      continue;
    }
    // Library import: `import "path" as Alias`
    if (target.token.kind === TokenId.INTERPRETED_STRING_LIT || target.token.kind === TokenId.RAW_STRING_LIT) {
      const aliasKeyword = items[index + 2];
      const alias = sameToken(aliasKeyword, TokenId.AS) ? readQualifiedName(items, index + 3) : undefined;
      const endItem = alias?.last ?? target;
      imports.push({
        kind: "library",
        raw: unquote(target.token.text),
        path: unquote(target.token.text),
        ...(alias ? { alias: alias.text, aliasItem: alias.first, aliasEndItem: alias.last } : {}),
        importItem: item,
        pathItem: target,
        endItem,
      });
      index = Math.max(index, alias?.endIndex ?? index);
      continue;
    }

    const nameItem = target;
    if (!isName(nameItem.token.text)) {
      continue;
    }
    let cursor = index + 2;
    let alias: QualifiedName | undefined;
    if (sameToken(items[cursor], TokenId.AS)) {
      alias = readQualifiedName(items, cursor + 1);
      if (!alias) {
        continue;
      }
      cursor = alias.endIndex + 1;
    }
    const from = items[cursor];
    const pathItem = items[cursor + 1];
    if (!sameToken(from, TokenId.FROM) || !pathItem) {
      continue;
    }
    imports.push({
      kind: "script",
      raw: nameItem.token.text,
      path: unquote(pathItem.token.text),
      ...(alias ? { alias: alias.text, aliasItem: alias.first, aliasEndItem: alias.last } : {}),
      importItem: item,
      pathItem,
      endItem: pathItem,
    });
    index = Math.max(index, alias?.endIndex ?? cursor + 1);
  }
  return imports;
}

/**
 * Build a stable sort key for an import fact.
 *
 * @param importFact - import fact.
 * @returns sort key string.
 */
export function importSortKey(importFact: ImportFact): string {
  return [
    importBucket(importFact.kind, importFact.path),
    importFact.path.toLocaleLowerCase(),
    importFact.raw.toLocaleLowerCase(),
  ].join("\u0000");
}

/**
 * Sort import facts deterministically.
 *
 * @param imports - import facts.
 * @returns sorted facts.
 */
export function sortedImportFacts(imports: readonly ImportFact[]): ImportFact[] {
  return imports
    .map((entry, index) => ({ entry, index }))
    .sort(
      (left, right) =>
        importSortKey(left.entry).localeCompare(importSortKey(right.entry), "en") || left.index - right.index,
    )
    .map(({ entry }) => entry);
}
