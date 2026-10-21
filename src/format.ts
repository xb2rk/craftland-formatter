// =============================================================================
// format.ts - the fc-format formatter orchestrator.
//
// Pipeline (all deterministic, like `gofmt`):
//   1. tokenize()      -> tokens          (vocabulary: tokenizer.ts / FCGLexer)
//   2. itemize()       -> items           (significant tokens + line breaks)
//   3. collectImports()-> sorted imports   (rules/imports.ts)
//   4. emitItems()     -> Doc             (structure + spacing + trailing comma)
//   5. printDoc()      -> string          (doc.ts, wrapped to maxLineLength)
//   6. EOL / final-newline normalization
//
// Every whitespace/indentation decision is recomputed from scratch, so the
// formatter never depends on the author's original layout (only on token order
// and comment text). This makes it safe to run on save.
//
// Extension / grammar reference: open the official extension
//   %USERPROFILE%\.vscode\extensions\craftlandstudio.ffugclanguage-*/dist/server_syntax.js
// module `FCGLexer` (token IDs) / `FCGParser` (rule names, e.g. `importDecl`,
// `parameters`, `listV`/`vectorV`/`mapV`/`tupleV`). Token *names* map 1:1 to
// `TokenKind` in tokenizer.ts.
// =============================================================================

import { tokenize, Token, TokenKind } from "./tokenizer.js";
import { itemize, Item, isCommentItem } from "./items.js";
import { resolveConfig, FormatConfig } from "./config.js";
import {
  Doc,
  concat,
  text,
  space,
  line,
  softline,
  hardline,
  indent,
  group,
  ifBreak,
  nil,
  printDoc,
} from "./doc.js";
import { collectImports, renderImports } from "./rules/imports.js";

// ---------------------------------------------------------------------------
// Spacing policy. Default = "add a space between adjacent tokens" unless the
// token is in one of these sets. This mirrors Go/gofmt whitespace rules, which
// FC (a Go-derived language) follows. See AGENTS.md / CODING_CONVENTION.md.
// ---------------------------------------------------------------------------

// No space BEFORE these tokens (they cling to the preceding token).
const NO_SPACE_BEFORE = new Set<TokenKind>([
  TokenKind.COMMA,
  TokenKind.SEMI,
  TokenKind.COLON,
  TokenKind.R_PAREN,
  TokenKind.R_BRACKET,
  TokenKind.R_CURLY,
  TokenKind.DOT,
  TokenKind.L_BRACKET,
]);

// No space AFTER these tokens (they cling to the following token).
const NO_SPACE_AFTER = new Set<TokenKind>([
  TokenKind.L_PAREN,
  TokenKind.L_BRACKET,
  TokenKind.EXCLAMATION, // unary `!x`
  TokenKind.PLUS_PLUS, // postfix `i++`
  TokenKind.MINUS_MINUS,
  TokenKind.DOT,
]);

// Keywords that take a single space before their operand, e.g. `if x`,
// `return y`, `import "z"`, `func f`. (`L_PAREN` is separately excluded so
// `func f()` keeps no space before `(`.)
const SPACE_KEYWORDS = new Set<TokenKind>([
  TokenKind.IF,
  TokenKind.ELSE,
  TokenKind.FOR,
  TokenKind.WHILE,
  TokenKind.RETURN,
  TokenKind.FUNC,
  TokenKind.ASYNC,
  TokenKind.STATIC,
  TokenKind.DECLARE,
  TokenKind.GRAPH,
  TokenKind.COMPONENT,
  TokenKind.TUPLE,
  TokenKind.ENUM,
  TokenKind.EVENT,
  TokenKind.IMPORT,
  TokenKind.VAR,
  TokenKind.TYPE,
  TokenKind.SWITCH,
  TokenKind.CASE,
  TokenKind.IN,
  TokenKind.BREAK,
  TokenKind.CONTINUE,
  TokenKind.START,
  TokenKind.WAIT,
  TokenKind.ACCEPT,
  TokenKind.BIND,
  TokenKind.FROM,
  TokenKind.AS,
  TokenKind.STRUCT,
  TokenKind.ABSTRACT,
  TokenKind.PARTIAL,
  TokenKind.READONLY,
  TokenKind.EXPORT,
  TokenKind.DEFINE,
  TokenKind.ALIAS,
  TokenKind.COMBINE,
  TokenKind.BRIDGING,
  TokenKind.ELEMENT,
  TokenKind.OBJECT,
  TokenKind.TYPEOF,
  TokenKind.THISENTITY,
  TokenKind.GLOBALENTITY,
  TokenKind.OUT,
]);

// Type names used in generic brackets (`List<object>`, `Map<string,int>`).
// Sourced from the FCGLexer token set (see the official extension's
// `dist/server_syntax.js`): LIST, MAP, VECTOR2/3, QUATERNION, COLOR,
// LOC_STRING, ENTITY, OBJECT, BOOL, INT, INT64, FLOAT, STRING, TYPE, plus any
// PascalCase identifier (user-defined types).
const TYPE_KEYWORDS = new Set<TokenKind>([
  TokenKind.LIST,
  TokenKind.MAP,
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

function isTypeNameTok(t: Token | null): boolean {
  if (!t) return false;
  if (t.kind === TokenKind.IDENTIFIER) return /^[A-Z]/.test(t.text);
  return TYPE_KEYWORDS.has(t.kind);
}

// A token that looks like a *type argument*, used to tell a generic `<` apart
// from the binary comparison/shift `<`. Confirmed against the codebase:
// `List<object>`, `Map<object, object>`, `entity<Entity>`,
// `targetZombieEntity<Transform>.Position`, `List<entity<Entity>>`.
function isTypeLikeTok(t: Token | null): boolean {
  if (!t) return false;
  return isTypeNameTok(t) || t.kind === TokenKind.LESS;
}

// Punctuation that may legally follow a generic close `>` (so it stays attached).
const PUNCT_AFTER_GENERIC = new Set<TokenKind>([
  TokenKind.COMMA,
  TokenKind.R_PAREN,
  TokenKind.R_CURLY,
  TokenKind.R_BRACKET,
  TokenKind.L_CURLY, // composite literal: `List<object>{ ... }`
  TokenKind.DOT,
  TokenKind.COLON,
  TokenKind.SEMI,
]);

/**
 * Decide whether a space is needed BEFORE `cur`, given the surrounding items.
 * Spacing is grounded in FC conventions verified against the codebase:
 *  - generic brackets `List<object>` are attached (no spaces) - confirmed by
 *    1771 `List<` vs 0 `List <` occurrences in Assets/Scripts.
 *  - composite-literal braces cling to their type/expression (`List<object>{`),
 *    while block braces get a space (`func F() int {`).
 *  - everything else: a space between tokens (FC is free-form; whitespace is
 *    never significant outside string/comment literals).
 */
// The token kind immediately before `idx`, skipping comments (or null at start).
function prevTokenKind(items: Item[], idx: number): TokenKind | null {
  for (let i = idx - 1; i >= 0; i--) {
    if (!isCommentItem(items[i])) return items[i].tok.kind;
  }
  return null;
}

// A token that ends an expression (so a following `+`/`-` is the binary operator,
// not a unary sign). Unary signs cling to their operand with no space.
function isExprEnding(k: TokenKind): boolean {
  return (
    k === TokenKind.IDENTIFIER ||
    k === TokenKind.DECIMAL_LIT ||
    k === TokenKind.FLOAT_LIT ||
    k === TokenKind.HEX_LIT ||
    k === TokenKind.COLOR_HEX_LIT ||
    k === TokenKind.STRING ||
    k === TokenKind.LOC_STRING ||
    k === TokenKind.R_PAREN ||
    k === TokenKind.R_BRACKET ||
    k === TokenKind.R_CURLY ||
    k === TokenKind.PLUS_PLUS ||
    k === TokenKind.MINUS_MINUS
  );
}

function shouldSpaceBefore(
  prev: Item | null,
  cur: Item,
  next: Item | null,
  atLineStart: boolean,
  items: Item[],
  itemIndex: number,
  matching: Map<number, number>,
): boolean {
  if (atLineStart) return false; // leading indentation, never a space
  if (prev === null) return false;
  const pk = prev.tok.kind;
  const ck = cur.tok.kind;
  const nk = next ? next.tok.kind : null;

  // Unary `+`/`-` cling to their operand: `-2`, `+x`. A binary sign keeps its
  // spaces because the preceding token ends an expression (`a - b`). Detect the
  // sign as unary when the token before it is NOT expression-ending.
  if (pk === TokenKind.MINUS || pk === TokenKind.PLUS) {
    const before = prevTokenKind(items, itemIndex - 1);
    if (before !== null && !isExprEnding(before)) return false;
  }

  // Composite-literal brace clings to its type/expression with NO space:
  // `List<object>{`, `GardenPlacement{`, `LocString{`, `arr[...]{}`, `} {...}`.
  // A block brace (`func F() {`, `if x {`) keeps a space - it follows `)`, a
  // block keyword, or an expression value. `isBlockOpen` is the authoritative
  // distinguisher (a block header never crosses into a previous statement).
  if (ck === TokenKind.L_CURLY) {
    // A control-flow/function block always gets a space (K&R), even when its
    // header ends in `>` (generic return type) or `]`/`}` - `isBlockOpen` is the
    // authoritative check and must run first.
    const block = isBlockOpen(items, itemIndex, matching);
    if (block) return true;
    // A composite literal (e.g. `List<object>{`, `GardenPlacement{`) clings to
    // its type with no space, unless it follows an assignment: `= {}`,
    // `= GameplayActionPlan{`.
    if (pk === TokenKind.ASSIGN || pk === TokenKind.DECLARE_ASSIGN) return true;
    return false;
  }

  // Generic brackets `Name<Type>` are attached (no spaces). The codebase uses
  // `List<object>`, `Map<object, object>`, `entity<Entity>`,
  // `targetZombieEntity<Transform>.Position`, `List<entity<Entity>>` (1771
  // `List<` vs 0 `List <` in Assets/Scripts). A `<` opens a generic when the
  // token that follows looks like a type; otherwise it is the binary `<`
  // (comparison/shift) and gets a space.
  if (ck === TokenKind.LESS) {
    if (pk === TokenKind.LESS) return false; // inside `<<`
    if (next && isTypeLikeTok(next.tok)) return false; // generic open `Name<Type`
    return true; // binary `<`
  }
  if (pk === TokenKind.LESS && isTypeLikeTok(cur.tok)) return false; // after `<` in a generic
  if (ck === TokenKind.GREATER) {
    if (pk === TokenKind.GREATER) return false; // inside `>>`
    // Generic close `>`: attached when it terminates a type-arg list (prev is a
    // type name or a nested-generic closer). A binary `>` has a value operand on
    // the left and keeps its surrounding space. `nk` is irrelevant here.
    if (isTypeNameTok(prev.tok) || pk === TokenKind.R_BRACKET || pk === TokenKind.R_CURLY || pk === TokenKind.R_PAREN) {
      return false;
    }
  }

  if (NO_SPACE_BEFORE.has(ck)) return false;
  if (NO_SPACE_AFTER.has(pk)) return false;
  // A call `(` clings to its callee/selector; a grouping `(` (after `if`,
  // `return`, an operator, `=`, etc.) keeps its space.
  if (ck === TokenKind.L_PAREN) {
    if (pk === TokenKind.IDENTIFIER || pk === TokenKind.R_PAREN || pk === TokenKind.R_BRACKET || pk === TokenKind.R_CURLY || pk === TokenKind.GREATER) {
      return false;
    }
    return true;
  }
  if (SPACE_KEYWORDS.has(pk)) return true;
  return true;
}

// ---------------------------------------------------------------------------
// Delimiter ( ) [ ] { } handling.
// ---------------------------------------------------------------------------

const OPENER = new Set<TokenKind>([
  TokenKind.L_PAREN,
  TokenKind.L_CURLY,
  TokenKind.L_BRACKET,
]);

// Keywords that introduce a block statement whose `{` must NOT receive a
// trailing comma (only composite literals get trailing commas).
const BLOCK_KEYWORDS = new Set<TokenKind>([
  TokenKind.IF,
  TokenKind.ELSE,
  TokenKind.FOR,
  TokenKind.WHILE,
  TokenKind.FUNC,
  TokenKind.ASYNC,
  TokenKind.GRAPH,
  TokenKind.COMPONENT,
  TokenKind.TUPLE,
  TokenKind.ENUM,
  TokenKind.EVENT,
  TokenKind.STATIC,
  TokenKind.DECLARE,
  TokenKind.SWITCH,
  TokenKind.CASE,
  TokenKind.STRUCT,
  TokenKind.ABSTRACT,
  TokenKind.PARTIAL,
  TokenKind.READONLY,
  TokenKind.EXPORT,
  TokenKind.BRIDGING,
  TokenKind.COMBINE,
  TokenKind.ACCEPT,
  TokenKind.BIND,
  TokenKind.START,
  TokenKind.WAIT,
]);

/** Build a {opener -> closer} index map over items (comments are transparent). */
export function buildMatching(items: Item[]): Map<number, number> {
  const map = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isCommentItem(items[i])) continue;
    const k = items[i].tok.kind;
    // NOTE: `<`/`>` are deliberately NOT tracked here. A binary `>`/`>>`
    // operator would otherwise pair with an earlier `(`/`{`/`[` and corrupt
    // block/parameter detection. Generic nesting is handled separately where
    // only comma-splitting / colon-finding needs it.
    if (k === TokenKind.L_PAREN || k === TokenKind.L_CURLY || k === TokenKind.L_BRACKET) {
      stack.push(i);
    } else if (k === TokenKind.R_PAREN || k === TokenKind.R_CURLY || k === TokenKind.R_BRACKET) {
      const open = stack.pop();
      if (open !== undefined) map.set(open, i);
    }
  }
  return map;
}

/** True if any item strictly inside the delimiter had a line break. */
export function enclosedMultiline(items: Item[], open: number, close: number): boolean {
  for (let i = open + 1; i < close; i++) {
    if (items[i].lineBreaks >= 1) return true;
  }
  return false;
}

/** True if this `(` belongs to a func/event/method parameter list (grammar
 *  forbids trailing commas there, so it is always off regardless of config). */
function isFuncParamList(items: Item[], open: number): boolean {
  for (let k = open - 1; k >= 0; k--) {
    const kind = items[k].tok.kind;
    if (kind === TokenKind.FUNC || kind === TokenKind.ASYNC || kind === TokenKind.EVENT) return true;
    if (kind === TokenKind.L_CURLY || kind === TokenKind.R_CURLY || kind === TokenKind.SEMI) {
      return false;
    }
  }
  return false;
}

// True if this `(` is a *statement* call (its result is not consumed), e.g.
// `CreateTween(...)`, `NotifyShowTips(...)`, `Destroy(...)`, `wait Foo(...)`.
// Such calls may carry a trailing comma per the codebase convention. A *value*
// call (assigned to a var, returned, an argument, an operand) must NOT have a
// trailing comma - FC grammar `arg (COMMA arg)*` forbids it there.
export function isStatementCall(items: Item[], open: number): boolean {
  let cs = open - 1;
  while (cs >= 0) {
    const k = items[cs].tok.kind;
    if (k === TokenKind.IDENTIFIER || k === TokenKind.DOT) {
      cs--;
      continue;
    }
    break;
  }
  const first = cs + 1; // first token of the callee (qualified name)
  if (cs < 0) return true; // start of file/block
  const pk = items[cs].tok.kind;
  if (pk === TokenKind.WAIT || pk === TokenKind.START) return true;
  if (pk === TokenKind.L_CURLY || pk === TokenKind.R_CURLY || pk === TokenKind.SEMI) return true;
  if (first < items.length && items[first].lineBreaks >= 1) return true; // call starts a new line
  return false;
}

/** True if this `{` opens a block statement rather than a composite literal. */
export function isBlockOpen(items: Item[], open: number, matching: Map<number, number>): boolean {
  // matching maps opener -> closer; invert for the reverse lookup used while
  // scanning backwards over closers.
  const closeToOpen = new Map<number, number>();
  for (const [o, c] of matching) closeToOpen.set(c, o);

  let k = open - 1;
  while (k >= 0) {
    const kind = items[k].tok.kind;
    if (kind === TokenKind.R_PAREN || kind === TokenKind.R_BRACKET) {
      const opener = closeToOpen.get(k);
      k = opener !== undefined ? opener - 1 : k - 1;
      continue;
    }
    // A `}` closes a previous block: the current statement (whose `{` we are
    // classifying) starts after it, so a preceding block keyword belongs to an
    // unrelated earlier statement. Stop without crossing into it.
    if (kind === TokenKind.R_CURLY) return false;
    if (kind === TokenKind.L_CURLY || kind === TokenKind.L_PAREN || kind === TokenKind.L_BRACKET) {
      return false; // exited the header without a block keyword
    }
    if (BLOCK_KEYWORDS.has(kind)) return true;
    if (kind === TokenKind.SEMI) return false;
    k--;
  }
  return false;
}

/** Did the source already place a trailing comma before the closer? */
function sourceHasTrailingComma(items: Item[], open: number, close: number): boolean {
  for (let i = close - 1; i > open; i--) {
    if (isCommentItem(items[i])) continue;
    return items[i].tok.kind === TokenKind.COMMA;
  }
  return false;
}

/** Split the inner items of a delimiter into top-level comma-separated
 *  segments (respecting nested delimiters). Returns [start, end) ranges. */
function splitSegments(items: Item[], open: number, close: number): Array<[number, number]> {
  const segs: Array<[number, number]> = [];
  const stack: number[] = [];
  let genDepth = 0; // separate nesting for generic `<`/`>` (binary `>`/`>>` must not pop `()`/`{}`/`[]`)
  let segStart = open + 1;
  for (let i = open + 1; i < close; i++) {
    const kind = items[i].tok.kind;
    if (kind === TokenKind.L_PAREN || kind === TokenKind.L_CURLY || kind === TokenKind.L_BRACKET) {
      stack.push(i);
    } else if (kind === TokenKind.R_PAREN || kind === TokenKind.R_CURLY || kind === TokenKind.R_BRACKET) {
      stack.pop();
    } else if (kind === TokenKind.LESS) {
      genDepth++;
    } else if (kind === TokenKind.GREATER) {
      genDepth = Math.max(0, genDepth - 1);
    } else if (kind === TokenKind.COMMA && stack.length === 0 && genDepth === 0) {
      if (i > segStart) segs.push([segStart, i]);
      segStart = i + 1;
    }
  }
  if (segStart < close) segs.push([segStart, close]);
  return segs;
}

// ---------------------------------------------------------------------------
// Emitting items -> Doc.
// ---------------------------------------------------------------------------

interface EmitResult {
  doc: Doc;
  next: number;
  /** Kind of the opener token (used for spacing BEFORE the group). */
  openKind: TokenKind;
  /** Kind of the closer token (used as `prevKind` for the NEXT token). */
  closeKind: TokenKind;
}

function renderComment(tok: Token): Doc {
  const t = tok.text;
  if (tok.kind === TokenKind.COMMENT && t.includes("\n")) {
    const lines = t.split("\n");
    let d: Doc = text(lines[0]);
    for (let i = 1; i < lines.length; i++) d = concat([d, hardline(), text(lines[i])]);
    return d;
  }
  return text(t);
}

/**
 * Emit one item (or a whole delimiter group if it is an opener) as a Doc.
 * `suppressFirstHardline` is set when this item is the first inside a delimiter
 * group, whose leading `softline` already provides the newline.
 */
function emitOne(
  items: Item[],
  i: number,
  cfg: FormatConfig,
  matching: Map<number, number>,
): EmitResult {
  const item = items[i];
  if (isCommentItem(item)) {
    return { doc: renderComment(item.tok), next: i + 1, openKind: item.tok.kind, closeKind: item.tok.kind };
  }
  const kind = item.tok.kind;
  if (OPENER.has(kind)) {
    const close = matching.get(i);
    if (close !== undefined) {
      const res = emitDelimiter(items, i, close, cfg, matching);
      return { doc: res, next: close + 1, openKind: kind, closeKind: items[close].tok.kind };
    }
  }
  return { doc: text(item.tok.text), next: i + 1, openKind: kind, closeKind: kind };
}

// Find the index of the top-level `:` that separates a map/struct literal key
// from its value, or null if this segment is not a `key: value` pair. Nesting
// depth is tracked so a `:` inside a nested `()/[]/{}` is ignored. This matches
// the grammar's `mapLiteralListItem: expression COLON expression`.
function findTopLevelColon(items: Item[], a: number, b: number): number | null {
  let depth = 0; // `()`/`{}`/`[]`
  let genDepth = 0; // `<>` (separate so a binary `>` doesn't corrupt `depth`)
  for (let i = a; i < b; i++) {
    if (isCommentItem(items[i])) continue;
    const k = items[i].tok.kind;
    if (k === TokenKind.L_PAREN || k === TokenKind.L_CURLY || k === TokenKind.L_BRACKET) depth++;
    else if (k === TokenKind.R_PAREN || k === TokenKind.R_CURLY || k === TokenKind.R_BRACKET) depth = Math.max(0, depth - 1);
    else if (k === TokenKind.LESS) genDepth++;
    else if (k === TokenKind.GREATER) genDepth = Math.max(0, genDepth - 1);
    else if (k === TokenKind.COLON && depth === 0 && genDepth === 0) return i;
  }
  return null;
}

// Top-level field-assignment (`=`) inside a composite literal segment, used to
// tell a struct/tuple literal (`Field = value`) apart from a positional
// data-type literal (`LocString{a, b}`). `:=` declare-assign counts too.
function findTopLevelAssign(items: Item[], a: number, b: number): number | null {
  let depth = 0;
  let genDepth = 0;
  for (let i = a; i < b; i++) {
    if (isCommentItem(items[i])) continue;
    const k = items[i].tok.kind;
    if (k === TokenKind.L_PAREN || k === TokenKind.L_CURLY || k === TokenKind.L_BRACKET) depth++;
    else if (k === TokenKind.R_PAREN || k === TokenKind.R_CURLY || k === TokenKind.R_BRACKET) depth = Math.max(0, depth - 1);
    else if (k === TokenKind.LESS) genDepth++;
    else if (k === TokenKind.GREATER) genDepth = Math.max(0, genDepth - 1);
    else if ((k === TokenKind.ASSIGN || k === TokenKind.DECLARE_ASSIGN) && depth === 0 && genDepth === 0) return i;
  }
  return null;
}

// Visual width of tokens [a, b) (comments ignored). Good enough for alignment
// since map/struct keys are normally a single identifier or string literal.
function tokenWidth(items: Item[], a: number, b: number): number {
  let w = 0;
  for (let i = a; i < b; i++) if (!isCommentItem(items[i])) w += items[i].tok.text.length;
  return w;
}

// Rough flat width of a delimiter's interior, used to decide whether a
// `key: value` literal will be laid out multiline (and thus should align).
function estimateFlatLength(items: Item[], open: number, close: number): number {
  let n = 0;
  let count = 0;
  for (let i = open; i <= close; i++) {
    if (!isCommentItem(items[i])) {
      n += items[i].tok.text.length;
      count++;
    }
  }
  return n + count; // ~1 space between tokens, plus the surrounding `{}`
}

function emitDelimiter(
  items: Item[],
  open: number,
  close: number,
  cfg: FormatConfig,
  matching: Map<number, number>,
): Doc {
  const openKind = items[open].tok.kind;
  const openChar = items[open].tok.text;
  const closeChar = items[close].tok.text;
  const multiline = enclosedMultiline(items, open, close);
  const isParams = openKind === TokenKind.L_PAREN ? isFuncParamList(items, open) : false;

  // Wrap strategy:
  //   - func/event params -> wrapLongSignatures (default "never": grammar
  //     forbids a trailing comma and multi-line is unsafe)
  //   - `[...]` array/index -> "never": FC grammar rejects both newlines and a
  //     trailing comma inside brackets
  //   - statement call -> wrapLongCalls (may break + trailing comma)
  //   - value call      -> "never": FC rejects a dangling `)` when a value call
  //     breaks (its nested last arg must itself break, which we can't safely
  //     reflow), so keep value calls on one line
  //   - everything else (composite literals) -> wrapLongCalls
  let mode =
    openKind === TokenKind.L_PAREN
      ? isParams
        ? cfg.wrapLongSignatures
        : isStatementCall(items, open)
          ? cfg.wrapLongCalls
          : "never"
      : openKind === TokenKind.L_BRACKET
        ? "never"
        : cfg.wrapLongCalls;

  if (open + 1 === close) {
    // Empty delimiter: `()`, `{}`, `[]`.
    return group(text(openChar + closeChar));
  }

  const segs = splitSegments(items, open, close);

  // A control-flow block (`if`, `for`, `func`, ...) is a sequence of
  // statements, NOT comma-separated values. `splitSegments` splits on
  // top-level commas, which wrongly breaks `for a, b in c {` at the header
  // comma. Treat the whole block body as a single segment so its original
  // statement separators (hardlines) are preserved verbatim, and never add a
  // trailing comma to a block.
  const block = openKind === TokenKind.L_CURLY && isBlockOpen(items, open, matching);
  if (block) {
    segs.length = 0;
    segs.push([open + 1, close]);
  }

  // A `{` composite literal that is NOT a control-flow block is either a
  // struct/tuple literal (`Field = value`), a map literal (`key: value`), or a
  // positional data-type literal (`LocString{a, b}`, `Vector2{x, y}`). The
  // latter must stay on a single line: the FC grammar rejects a break right
  // after `{` or right after a top-level comma for these. So force "never".
  if (openKind === TokenKind.L_CURLY && !block) {
    const positional = !segs.some(
      ([a, b]) => findTopLevelAssign(items, a, b) !== null || findTopLevelColon(items, a, b) !== null,
    );
    if (positional) mode = "never";
  }

  // Trailing comma policy (per config; func params are always off).
  let trailing = false;
  if (openKind === TokenKind.L_PAREN) {
    if (!isParams) {
      const policy = cfg.trailingComma.multilineCalls;
      const stmtCall = isStatementCall(items, open);
      // A broken statement call must end with a trailing comma (or a joined
      // `})`); the FC grammar rejects a dangling `)` after a multi-line last
      // arg. Force a comma whenever a statement call actually breaks.
      if (stmtCall && (mode === "always" || (mode === "fit" && multiline))) {
        trailing = true;
      } else if (policy === "always") {
        // Only statement calls may carry a trailing comma (grammar-forbidden
        // on value calls); gate it so "always" never breaks value calls.
        trailing = stmtCall;
      } else {
        trailing = decideTrailing(policy, items, open, close); // "never" | "preserve"
      }
    }
  } else if (openKind === TokenKind.L_BRACKET) {
    // Bare `[...]` (array literal / index expression): FC grammar forbids a
    // trailing comma, so it is always off regardless of config.
    trailing = false;
  } else if (openKind === TokenKind.L_CURLY) {
    if (!block) trailing = decideTrailing(cfg.trailingComma.multilineCollections, items, open, close);
  }

  // Func/event parameter lists: the grammar `parameters: (COMMA paramDecl)*
  // R_PAREN` forbids a trailing comma, and multi-line is only safe when the
  // user opts in (wrapLongSignatures). In "never" mode we emit the list flat
  // on one line with no softlines, so it can never be split or given a comma.
  // Same for any single-line source under "fit": emit flat so it can never be
  // reflowed onto multiple lines (FC rejects many reflowed breaks). Blocks are
  // never flattened (their statements keep their original hardline separators).
  if (mode === "never" || (mode === "fit" && !multiline) || block) {
    if (block) {
      return group(
        concat([text(openChar), indent(concat([softline(), emitItems(items, cfg, open + 1, close, true)])), softline(), text(closeChar)]),
        true,
      );
    }
    const flatParts: Doc[] = [];
    segs.forEach(([a, b], idx) => {
      flatParts.push(emitItems(items, cfg, a, b, true));
      if (idx < segs.length - 1) flatParts.push(text(", "));
    });
    return concat([text(openChar), concat(flatParts), text(closeChar)]);
  }

  // Column-align `key: value` pairs inside map/struct/tuple literals (gofmt
  // style). The grammar's `mapV` uses `key COLON value`, so this is valid FCC.
  // Only align when the literal is actually laid out multiline: `always` mode,
  // or `fit`/`never` when the flat form would exceed maxLineLength. Aligning a
  // single-line literal would just inject stray padding spaces.
  const allColon = segs.length >= 1 && segs.every(([a, b]) => findTopLevelColon(items, a, b) !== null);
  const flatLen = estimateFlatLength(items, open, close);
  const align =
    openKind === TokenKind.L_CURLY &&
    !block &&
    allColon &&
    (mode === "always" || flatLen > cfg.maxLineLength);
  let maxKey = 0;
  if (align) {
    for (const [a, b] of segs) {
      const ci = findTopLevelColon(items, a, b)!;
      maxKey = Math.max(maxKey, tokenWidth(items, a, ci));
    }
  }

  const parts: Doc[] = [];
  segs.forEach(([a, b], idx) => {
    let segDoc: Doc;
    const ci = align ? findTopLevelColon(items, a, b) : null;
    if (ci !== null) {
      const pad = Math.max(0, maxKey - tokenWidth(items, a, ci));
      // key (no colon) + padding + ": " + value
      segDoc = concat([emitItems(items, cfg, a, ci, true), text(" ".repeat(pad)), text(": "), emitItems(items, cfg, ci + 1, b, true)]);
    } else {
      segDoc = emitItems(items, cfg, a, b, true);
    }
    if (idx < segs.length - 1) {
      parts.push(concat([segDoc, text(","), line()]));
    } else {
      parts.push(concat([segDoc, trailing ? ifBreak(text(","), nil()) : nil()]));
    }
  });

  // Break decision:
  //   "always"  -> always break; blocks always break (K&R).
  //   "fit"     -> preserve the author's layout: break only if the source was
  //                already multiline. (FC's call grammar rejects many reflowed
  //                breaks, so we do not break purely on width.)
  //   "never"   -> handled earlier (emitted flat), never reaches here.
  const isBlock = block;
  const forceBreak = mode === "always" || isBlock || multiline;
  // Blocks (K&R) and struct/map composite literals always start their body on
  // a new line (opener line is empty, members each on their own line). Calls
  // (`(`) and positional data-type literals (kept on one line via "never") do
  // not get a leading break, so their first member hugs the opener.
  const leadingBreak = isBlock || openKind === TokenKind.L_CURLY ? softline() : nil();
  return group(
    concat([text(openChar), indent(concat([leadingBreak, concat(parts)])), softline(), text(closeChar)]),
    forceBreak,
  );
}

function decideTrailing(
  policy: "always" | "never" | "preserve",
  items: Item[],
  open: number,
  close: number,
): boolean {
  if (policy === "always") return true;
  if (policy === "never") return false;
  return sourceHasTrailingComma(items, open, close); // "preserve"
}

/**
 * Emit items[lo, hi) as a Doc. `suppressFirstHardline` suppresses the leading
 * newline of the first item (used inside delimiter groups).
 */
function emitItems(
  items: Item[],
  cfg: FormatConfig,
  lo: number,
  hi: number,
  suppressFirstHardline: boolean,
): Doc {
  const parts: Doc[] = [];
  const matching = buildMatching(items);
  let prevItem: Item | null = null;
  let first = true;

  let i = lo;
  while (i < hi) {
    const item = items[i];
    const atLineStart = first || item.lineBreaks >= 1;

    if (first) {
      if (!suppressFirstHardline && item.lineBreaks >= 1) parts.push(hardline());
    } else if (item.lineBreaks >= 1) {
      const n = cfg.blankLines.collapse
        ? Math.min(item.lineBreaks, cfg.blankLines.maxConsecutive)
        : item.lineBreaks;
      for (let k = 0; k < n; k++) parts.push(hardline());
    }

    const res = emitOne(items, i, cfg, matching);
    const nextItem = res.next < hi ? items[res.next] : null;
    if (shouldSpaceBefore(prevItem, item, nextItem, atLineStart, items, i, matching)) {
      parts.push(space());
    }
    parts.push(res.doc);

    prevItem = items[res.next - 1] ?? null;
    i = res.next;
    first = false;
  }
  return concat(parts);
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export function format(source: string, partial?: Partial<FormatConfig>): string {
  const cfg = resolveConfig(partial);
  const tokens = tokenize(source);
  const items = itemize(tokens);
  const { imports, importItemIndices } = collectImports(items);
  const bodyItems = items.filter((_, idx) => !importItemIndices.has(idx));

  const importDoc = renderImports(imports, cfg);
  const bodyDoc = emitItems(bodyItems, cfg, 0, bodyItems.length, false);

  let root: Doc;
  if (imports.length > 0 && bodyItems.length > 0) {
    root = concat([importDoc, hardline(), bodyDoc]);
  } else {
    root = concat([importDoc, bodyDoc]);
  }

  let out = printDoc(root, {
    maxLineLength: cfg.maxLineLength,
    indentWidth: cfg.indentWidth,
    useTabs: cfg.useTabs,
  });

  // End-of-line + final newline normalization (config-driven).
  if (cfg.endOfLine === "crlf") {
    out = out.replace(/\n/g, "\r\n");
  }
  const lines = out.split(/\r?\n/);
  if (cfg.trimTrailingWhitespace) {
    for (let i = 0; i < lines.length; i++) lines[i] = lines[i].replace(/[ \t]+$/, "");
  }
  let result = lines.join("\n");
  if (cfg.trimFinalNewlines) result = result.replace(/\n+$/, "");
  if (cfg.insertFinalNewline) result += "\n";
  return result;
}
