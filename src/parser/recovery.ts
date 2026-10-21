/**
 * Parser recovery synchronization sets (E2).
 *
 * B2's error fences cap duplicate diagnostics *within* one broken
 * construct. This module owns the complementary *between*-construct
 * discipline: when a declaration/member/statement fails to parse, the
 * owning loop reports once and then skips forward to a token that can
 * plausibly start the next construct, instead of reporting once per
 * stray token.
 *
 * Invariants honored by `recover` in `file-parser.ts`:
 *
 * - `R_CURLY` at brace-depth zero and `EOF` always terminate a skip
 *   unconsumed, so a broken construct cannot eat its owning block's
 *   closing brace (the pre-sync `recover` advanced past `R_CURLY`,
 *   corrupting nesting for the rest of the file).
 * - Braces define construct nesting, so only brace depth gates the
 *   `R_CURLY`/sync decision; parens and brackets share a second counter
 *   for their own closes. Unbalanced `(`/`[` can therefore never poison
 *   resumption the way a single depth counter would. Accepted noise: an
 *   unbalanced `{` inside skipped garbage shifts one close attribution;
 *   the resulting diagnostics stay local and bounded.
 * - Every `recover` call advances the cursor by at least one token
 *   unless already at `EOF`, so all owning `while (!R_CURLY && !EOF)`
 *   loops still terminate.
 * - A failure positioned exactly at `R_CURLY` leaves the cursor
 *   unconsumed by design; the owning loops' `checkpoint === before`
 *   backstops advance past those two rests (`EOF` needs no advance
 *   because the loop condition already exits). `recover` therefore never
 *   terminates a loop on its own — the backstop is load-bearing, not
 *   belt-and-braces.
 *
 * The sets deliberately contain only tokens that are unambiguous at the
 * recovery site. Identifier-started constructs (fields, expression
 * statements) cannot be sync members: nearly every token can start an
 * expression, so such a set would stop the very first skipped token and
 * the sync would be a no-op. The cost is documented: valid
 * identifier-started constructs *between* the failure point and the next
 * sync token are skipped silently. One diagnostic still points at the
 * original failure, which bounds the damage of that trade.
 *
 * NOTE: `statement-boundary.ts` is EOS/Newline analysis for the lexer,
 * not recovery infrastructure; sync sets live here instead.
 */

import { TokenId } from "../grammar/token-vocabulary.generated.js";

/** Tokens that can start a `.fcc` header declaration or decorator. */
export const HEADER_DECL_SYNC: ReadonlySet<number> = new Set<number>([
  TokenId.DEFINE,
  TokenId.ALIAS,
  TokenId.ENUM,
  TokenId.TUPLE,
  TokenId.COMPONENT,
  TokenId.FUNC,
  TokenId.ASYNC,
  TokenId.EVENT,
  TokenId.DECLARE,
  TokenId.L_BRACKET,
]);

/** Tokens that can start a graph member or decorator. */
export const GRAPH_MEMBER_SYNC: ReadonlySet<number> = new Set<number>([
  TokenId.FUNC,
  TokenId.ASYNC,
  TokenId.EVENT,
  TokenId.SEMI,
  TokenId.L_BRACKET,
]);

/** Tokens that can start a `declare graph` member. No decorators are parsed there. */
export const DECLARE_GRAPH_MEMBER_SYNC: ReadonlySet<number> = new Set<number>([
  TokenId.FUNC,
  TokenId.SEMI,
]);

/** Field bodies start with identifiers, so only separators resync here. */
export const AGGREGATE_FIELD_SYNC: ReadonlySet<number> = new Set<number>([
  TokenId.SEMI,
  TokenId.L_BRACKET,
]);

/** Enum members are newline-separated, so only separators resync here. */
export const ENUM_MEMBER_SYNC: ReadonlySet<number> = new Set<number>([
  TokenId.SEMI,
  TokenId.L_BRACKET,
]);

/** Keyword-started statements plus block boundaries. Expression statements
 *  start with operands and cannot resync (see module note). */
export const BLOCK_STATEMENT_SYNC: ReadonlySet<number> = new Set<number>([
  TokenId.VAR,
  TokenId.IF,
  TokenId.WHILE,
  TokenId.FOR,
  TokenId.RETURN,
  TokenId.BREAK,
  TokenId.CONTINUE,
  TokenId.L_CURLY,
  TokenId.SEMI,
]);
