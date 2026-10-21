/**
 * @module syntax/query - context-aware structural predicates shared by formatter and linter.
 */

import { TokenId } from "../lex/grammar.generated.js";
import type { Content, Node } from "./classifier.js";
import type { Item } from "../lex/items.js";

/** Any keyword that may open a `{ }` block (declaration or control). */
const BLOCK_HEADER_KINDS: ReadonlySet<TokenId> = new Set<TokenId>([
  TokenId.IF,
  TokenId.ELSE,
  TokenId.FOR,
  TokenId.WHILE,
  TokenId.FUNC,
  TokenId.GRAPH,
  TokenId.EVENT,
  TokenId.COMPONENT,
  TokenId.TUPLE,
  TokenId.ENUM,
]);

/** Control-flow block headers. */
const CONTROL_BLOCK_KINDS: ReadonlySet<TokenId> = new Set<TokenId>([
  TokenId.IF,
  TokenId.ELSE,
  TokenId.FOR,
  TokenId.WHILE,
]);

/** Tokens that terminate a declaration/control header. Without an explicit
 *  fence, a composite literal later in a function body could inherit the
 *  enclosing `func`/`graph` keyword and be misclassified as a block. */
const HEADER_FENCE_KINDS: ReadonlySet<TokenId> = new Set<TokenId>([
  TokenId.RETURN,
  TokenId.BREAK,
  TokenId.CONTINUE,
  TokenId.START,
  TokenId.WAIT,
  TokenId.VAR,
  TokenId.ASSIGN,
  TokenId.DECLARE_ASSIGN,
]);

/** Parent contexts where `(...` is not a statement call. */
const NON_STATEMENT_CALL_HEADER_KINDS: ReadonlySet<TokenId> = new Set<TokenId>([
  TokenId.FUNC,
  TokenId.RETURN,
  TokenId.ASSIGN,
  TokenId.DECLARE_ASSIGN,
  TokenId.DEFINE,
]);

/** Keywords whose condition parens wrap a value expression. */
const CONDITION_HEADER_KINDS: ReadonlySet<TokenId> = new Set<TokenId>([
  TokenId.IF,
  TokenId.FOR,
  TokenId.WHILE,
]);

/** Tokens after which `+`/`-` is a unary prefix rather than binary. */
const UNARY_PRECEDER_KINDS: ReadonlySet<TokenId> = new Set<TokenId>([
  TokenId.L_PAREN,
  TokenId.L_BRACKET,
  TokenId.L_CURLY,
  TokenId.COMMA,
  TokenId.COLON,
  TokenId.ASSIGN,
  TokenId.DECLARE_ASSIGN,
  TokenId.RETURN,
  TokenId.PLUS,
  TokenId.MINUS,
  TokenId.STAR,
  TokenId.DIV,
  TokenId.MOD,
  TokenId.LOGICAL_AND,
  TokenId.LOGICAL_OR,
  TokenId.EXCLAMATION,
]);

/**
 * Narrow `Content` to `Node`.
 *
 * @param content - content entry.
 * @returns true if entry is a delimiter node.
 */
function isNode(content: Content): content is Node {
  return "content" in content;
}

/**
 * Project only the direct statement header into items. Nested delimiters are
 * represented by their open/close tokens, while their internal keywords stay
 * in the nested expression and cannot affect block/call classification.
 */
function projectHeader(content: readonly Content[]): Item[] {
  const result: Item[] = [];
  for (const entry of content) {
    if (isNode(entry)) {
      if (entry.open) result.push(entry.open);
      if (entry.close) result.push(entry.close);
    } else {
      result.push(entry);
    }
  }
  return result;
}

/** Header tokens preceding `node` on its physical source line. */
function lineHeader(node: Node): Item[] {
  if (!node.parent) return [];
  const index = node.parent.content.indexOf(node);
  if (index < 0) return [];
  const prefix = node.parent.content.slice(0, index);
  let startContent = 0;
  for (let cursor = prefix.length - 1; cursor >= 0; cursor -= 1) {
    const entry = prefix[cursor]!;
    // A completed statement block is a reliable fence. Composite literals
    // also close with `}`, but they are part of the current expression and
    // must not hide an earlier assignment/return keyword from call queries.
    if (isNode(entry) && entry.kind === "block" && entry.close?.token.kind === TokenId.R_CURLY) {
      startContent = cursor + 1;
      break;
    }
    if (!isNode(entry) && entry.token.kind === TokenId.SEMI) {
      startContent = cursor + 1;
      break;
    }
  }
  // A declaration header may span several physical lines (notably `func`
  // parameters). Newline is not a statement boundary here; the enclosing
  // block/semicolon boundary above is the reliable fence against stale words
  // from a previous statement.
  return projectHeader(prefix.slice(startContent));
}

/** Return the last direct item before a delimiter in its containing sequence. */
function previousDirectItem(node: Node): Item | undefined {
  if (!node.parent) return undefined;
  const index = node.parent.content.indexOf(node);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const entry = node.parent.content[cursor]!;
    if (!isNode(entry)) return entry;
    if (entry.close) return entry.close;
  }
  return undefined;
}

/** True only for `LocString{...}` positional composite literals (always flat). */
export function isLocStringLiteral(node: Node): boolean {
  if (node.open?.token.kind !== TokenId.L_CURLY) return false;
  const prev = previousDirectItem(node);
  return prev !== undefined && prev.token.kind === TokenId.LOC_STRING;
}

/** True if `node` is directly inside a `LocString{...}` literal (nested data stays flat). */
export function isInsideLocStringLiteral(node: Node): boolean {
  let current: Node | undefined = node.parent;
  while (current) {
    if (isLocStringLiteral(current)) return true;
    current = current.parent;
  }
  return false;
}

/** True only for a `{` whose same-line header is a declaration/control scope. */
export function isBlockOpen(node: Node): boolean {
  if (node.open?.token.kind !== TokenId.L_CURLY) return false;
  const header = lineHeader(node).map((item) => item.token.kind);
  let lastBlock = -1;
  let lastControl = -1;
  for (let index = 0; index < header.length; index += 1) {
    const kind = header[index]!;
    if (BLOCK_HEADER_KINDS.has(kind)) {
      lastBlock = index;
      if (CONTROL_BLOCK_KINDS.has(kind)) lastControl = index;
    }
  }
  if (lastBlock < 0) return false;

  // Control headers (`for i = 0, ...`, in particular) may contain assignment
  // tokens, so the control keyword itself wins over expression fences.
  if (lastControl >= 0 && lastControl === lastBlock) return true;

  for (let index = lastBlock + 1; index < header.length; index += 1) {
    if (HEADER_FENCE_KINDS.has(header[index]!)) return false;
  }
  return true;
}

/** True for a paren call that is an assignment/return value (e.g. `var x = Foo(a,b)`). */
export function isAssignmentCall(node: Node): boolean {
  if (node.open?.token.kind !== TokenId.L_PAREN) return false;
  const header = lineHeader(node);
  let lineStart = 0;
  for (let index = header.length - 1; index >= 0; index -= 1) {
    if (header[index]!.lineBreakBefore) {
      lineStart = index;
      break;
    }
  }
  const kinds = header.slice(lineStart).map((item) => item.token.kind);
  return kinds.includes(TokenId.ASSIGN) || kinds.includes(TokenId.RETURN) || kinds.includes(TokenId.VAR) || kinds.includes(TokenId.COLON);
}

/** A paren enclosure that is the call expression of a standalone statement. */
export function isStatementCall(node: Node): boolean {
  if (node.open?.token.kind !== TokenId.L_PAREN || !node.parent) return false;
  // Only a paren directly owned by a statement container can be a standalone
  // call. Nested calls inside another paren or a composite literal are value
  // expressions; keeping them flat avoids introducing parser-invalid newlines.
  if (node.parent.kind !== "block" && node.parent.kind !== "root") return false;
  const header = lineHeader(node);
  // Only the current line's header matters: a previous assignment on the
  // prior line (`a = b\nCall(`) must not leak into the next statement's
  // header. Func signatures span lines, but there `lineBreakBefore` is on the
  // parameter items, not on the statement-call opener, so the slice still
  // keeps the `func`/`event` keyword for the signature check.
  let lineStart = 0;
  for (let index = header.length - 1; index >= 0; index -= 1) {
    if (header[index]!.lineBreakBefore) {
      lineStart = index;
      break;
    }
  }
  const kinds = header.slice(lineStart).map((item) => item.token.kind);
  if (kinds.some((kind) => NON_STATEMENT_CALL_HEADER_KINDS.has(kind))) {
    return false;
  }
  // A call directly inside a control header is still a value expression,
  // even though its parent delimiter is the block/root sequence. Wrapping it
  // would introduce a newline into `if !Call(...) {`/`for ... Call(...) {`,
  // which the compiler does not accept.
  if (kinds.some((kind) => CONDITION_HEADER_KINDS.has(kind))) return false;
  if (kinds.includes(TokenId.START) || kinds.includes(TokenId.WAIT)) return true;
  const previous = header.at(-1)?.token.kind;
  return previous === TokenId.IDENTIFIER || previous === TokenId.R_PAREN || previous === TokenId.R_BRACKET;
}

/** True for the parameter list owned by a `func` or contract `event` declaration. */
export function isSignatureParameterList(node: Node): boolean {
  if (node.open?.token.kind !== TokenId.L_PAREN || !node.parent) return false;
  const header = lineHeader(node).map((item) => item.token.kind);
  for (let index = header.length - 1; index >= 0; index -= 1) {
    const kind = header[index]!;
    if (kind === TokenId.FUNC || kind === TokenId.EVENT) return true;
    if (kind === TokenId.IF || kind === TokenId.FOR || kind === TokenId.WHILE || HEADER_FENCE_KINDS.has(kind)) {
      return false;
    }
  }
  return false;
}

/** True for parentheses belonging to an `if`, `for`, or `while` condition header. */
export function isConditionParen(node: Node): boolean {
  if (node.open?.token.kind !== TokenId.L_PAREN || !node.parent) return false;
  // Only the delimiter immediately following the control keyword is the
  // condition wrapper. Calls nested inside `if foo && List.Length(...)` must
  // remain ordinary value calls and must not be reported or flattened as a
  // condition.
  const previous = previousDirectItem(node);
  return previous?.token.kind === TokenId.IF || previous?.token.kind === TokenId.FOR || previous?.token.kind === TokenId.WHILE;
}

/** Whether `+` / `-` is an operand prefix rather than a binary operator. */
export function isUnary(previous: Item | undefined, operator: Item): boolean {
  if (operator.token.kind !== TokenId.PLUS && operator.token.kind !== TokenId.MINUS) return false;
  if (!previous) return true;
  return UNARY_PRECEDER_KINDS.has(previous.token.kind);
}

/** Find a direct (not nested) separator in an enclosure. */
export function findTopLevelSeparator(node: Node, separator: TokenId = TokenId.ASSIGN): Item | undefined {
  for (const entry of node.content) {
    if (!isNode(entry) && entry.token.kind === separator) return entry;
  }
  return undefined;
}

/** Split direct enclosure content on top-level commas while preserving nodes. */
export function splitSegments(node: Node): Content[][] {
  const segments: Content[][] = [[]];
  for (const entry of node.content) {
    if (!isNode(entry) && entry.token.kind === TokenId.COMMA) {
      segments.push([]);
    } else {
      segments.at(-1)!.push(entry);
    }
  }
  return segments;
}
