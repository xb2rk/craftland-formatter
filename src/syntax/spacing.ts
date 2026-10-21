/**
 * @module syntax/spacing - the single, auditable spacing policy used by the emitter.
 */

import { TokenId } from "../lex/grammar.generated.js";
import { isUnary } from "./query.js";
import type { Item } from "../lex/items.js";
import type { Config } from "../format/config.js";

export type Enclosure = "block" | "paren" | "brace" | "bracket";

export interface SpacingContext {
  /** Enclosing delimiter kind (affects `spaceInside*` knobs). */
  enclosure?: Enclosure;
  /** True while `<...>` is known to be a generic type expression. */
  inGeneric?: boolean;
  /** Token before the previous item; needed to classify a preceding +/- as unary. */
  previous?: Item;
}

/**
 * All binary operators that obey `spaceAroundOperators`.
 * Why a set: spacing.ts is the single spacing policy; enumerating here keeps the rule auditable vs scattering `if (kind === PLUS || kind === MINUS ...)` throughout emit.
 */
const BINARY_OPERATORS: ReadonlySet<TokenId> = new Set<TokenId>([
  TokenId.DECLARE_ASSIGN,
  TokenId.EQUALS,
  TokenId.NOT_EQUALS,
  TokenId.LESS,
  TokenId.LESS_OR_EQUALS,
  TokenId.GREATER,
  TokenId.GREATER_OR_EQUALS,
  TokenId.ASSIGN,
  TokenId.PLUS_ASSIGN,
  TokenId.MINUS_ASSIGN,
  TokenId.STAR_ASSIGN,
  TokenId.DIV_ASSIGN,
  TokenId.MOD_ASSIGN,
  TokenId.AND_ASSIGN,
  TokenId.XOR_ASSIGN,
  TokenId.OR_ASSIGN,
  TokenId.RSHIFT_ASSIGN,
  TokenId.LSHIFT_ASSIGN,
  TokenId.LOGICAL_OR,
  TokenId.LOGICAL_AND,
  TokenId.OR,
  TokenId.DIV,
  TokenId.MOD,
  TokenId.AND,
  TokenId.XOR,
  TokenId.PLUS,
  TokenId.MINUS,
  TokenId.STAR,
]);

/** Boundary tokens - tokens that close an enclosure (`)` `]` `}`). */
const CLOSERS: ReadonlySet<TokenId> = new Set<TokenId>([
  TokenId.R_PAREN,
  TokenId.R_BRACKET,
  TokenId.R_CURLY,
]);

/** Tokens that open an enclosure. */
const OPENERS: ReadonlySet<TokenId> = new Set<TokenId>([
  TokenId.L_PAREN,
  TokenId.L_BRACKET,
  TokenId.L_CURLY,
]);

/**
 * Check if a token kind is an operator (binary or prefix).
 *
 * @param id - token kind.
 * @returns true for operators.
 */
function isOperator(id: TokenId): boolean {
  return BINARY_OPERATORS.has(id) || id === TokenId.EXCLAMATION || id === TokenId.BIT_NOT;
}

/**
 * Decide whether a single normalized space belongs before `current`.
 * Newlines and comments are handled by the emitter; this function only owns
 * same-line spacing.
 */
export function shouldSpaceBefore(
  prev: Item | undefined,
  current: Item,
  config: Config,
  context: SpacingContext = {},
): boolean {
  if (!prev) return false;
  const before = prev.token.kind;
  const after = current.token.kind;

  // `>>` and `<<` are lexed as two `>`/`<` tokens (see grammar.ts). They must
  // stay together whether they are a shift (`>> 16`) or two generic closes
  // (`List<List<int>>`). The surrounding spaces are handled by the outer
  // operator check; only the inner gap is suppressed here.
  if ((before === TokenId.GREATER && after === TokenId.GREATER) ||
      (before === TokenId.LESS && after === TokenId.LESS)) {
    return false;
  }

  // Multi-char operators split by whitespace in source (e.g. `! =`, `= =`)
  // must be re-joined without space so `!=`/`==` are not emitted as `! =`.
  // `>=`/`<=` are handled in `state.ts` with generic-awareness so `List<int> =`
  // keeps its space while `d > = BlockBase` becomes `d >= BlockBase`.
  // Covers `!=`, `==` and the `*=` family (`+=`, `-=`, etc.) when they
  // appear as two single-char tokens due to stray whitespace.
  if ((before === TokenId.EXCLAMATION && after === TokenId.ASSIGN) ||
      (before === TokenId.ASSIGN && after === TokenId.ASSIGN) ||
      (before === TokenId.PLUS && after === TokenId.ASSIGN) ||
      (before === TokenId.MINUS && after === TokenId.ASSIGN) ||
      (before === TokenId.STAR && after === TokenId.ASSIGN) ||
      (before === TokenId.DIV && after === TokenId.ASSIGN) ||
      (before === TokenId.MOD && after === TokenId.ASSIGN) ||
      (before === TokenId.AND && after === TokenId.ASSIGN) ||
      (before === TokenId.OR && after === TokenId.ASSIGN) ||
      (before === TokenId.XOR && after === TokenId.ASSIGN) ||
      (before === TokenId.PLUS && after === TokenId.PLUS) ||
      (before === TokenId.MINUS && after === TokenId.MINUS) ||
      (before === TokenId.COLON && after === TokenId.ASSIGN)) {
    return false;
  }

  // `) * 23` / `] + 1` - closer before binary operator keeps operator spacing.
  if (CLOSERS.has(before) && isOperator(after)) return config.spaceAroundOperators;
  // `a + (b)` / `x = [1]` - operator before opener keeps operator spacing.
  if (isOperator(before) && (after === TokenId.L_PAREN || after === TokenId.L_BRACKET)) {
    return config.spaceAroundOperators;
  }

  if (CLOSERS.has(after) || after === TokenId.COMMA || after === TokenId.SEMI || after === TokenId.DOT) {
    if (after === TokenId.R_CURLY && context.enclosure === "brace" && before !== TokenId.L_CURLY) {
      return config.spaceInsideBraces;
    }
    if (after === TokenId.R_PAREN && context.enclosure === "paren" && before !== TokenId.L_PAREN) {
      return config.spaceInsideParens;
    }
    if (after === TokenId.R_BRACKET && context.enclosure === "bracket" && before !== TokenId.L_BRACKET) {
      return config.spaceInsideBrackets;
    }
    return false;
  }

  if (after === TokenId.L_PAREN || after === TokenId.L_BRACKET) {
    // Only cling when it is a call/index: `Call(` / `arr[0]`. After `=` / `,` / `:` a
    // collection literal should keep its normal space (`x = [1,2]`).
    if (
      after === TokenId.L_PAREN &&
      (before === TokenId.IDENTIFIER || before === TokenId.R_PAREN || before === TokenId.R_BRACKET || before === TokenId.R_CURLY)
    ) {
      return false;
    }
    if (
      after === TokenId.L_BRACKET &&
      (before === TokenId.IDENTIFIER || before === TokenId.R_PAREN || before === TokenId.R_BRACKET || before === TokenId.R_CURLY || before === TokenId.DOT)
    ) {
      return false;
    }
    // Operators before `(` / `[` keep their spacing (`a + (b)`, `x = [1,2]`).
    if (isOperator(before)) return config.spaceAroundOperators;
    // Otherwise fall through to the normal operator/word spacing below.
  }
  if (after === TokenId.L_CURLY) {
    // Keep `x = {1,2}` spaced even when `Type{` clings - assignment spacing wins over brace attachment.
    // Do NOT apply to generic close `>`: `List<int>{` must cling.
    if (
      before === TokenId.ASSIGN ||
      before === TokenId.DECLARE_ASSIGN ||
      before === TokenId.COLON ||
      before === TokenId.COMMA
    ) {
      return true;
    }
    return context.enclosure === "block" || config.bracketSpacing === "space";
  }

  // Prefix operators cling to their operand but still need a separator from
  // the preceding word/operator (`if !ready`, `x = -1`).
  if (after === TokenId.EXCLAMATION || after === TokenId.BIT_NOT ||
      ((after === TokenId.PLUS || after === TokenId.MINUS) && isUnary(prev, current))) {
    if (OPENERS.has(before) || before === TokenId.DOT) return false;
    return BINARY_OPERATORS.has(before) ? config.spaceAroundOperators : true;
  }
  if (before === TokenId.EXCLAMATION || before === TokenId.BIT_NOT ||
      ((before === TokenId.PLUS || before === TokenId.MINUS) && isUnary(context.previous, prev))) {
    return false;
  }

  if (before === TokenId.COMMA) return !CLOSERS.has(after) && config.spaceAfterComma;
  if (before === TokenId.COLON) return true;
  if (before === TokenId.DOT) return false;
  if (OPENERS.has(before)) {
    if (before === TokenId.L_PAREN && context.enclosure === "paren") return config.spaceInsideParens;
    if (before === TokenId.L_BRACKET && context.enclosure === "bracket") return config.spaceInsideBrackets;
    if (before === TokenId.L_CURLY && context.enclosure === "brace") return config.spaceInsideBraces;
    return false;
  }

  if (after === TokenId.COLON) return false;

  if (after === TokenId.LESS || after === TokenId.GREATER || before === TokenId.LESS || before === TokenId.GREATER) {
    return !context.inGeneric && config.spaceAroundOperators;
  }

  if (after === TokenId.PLUS || after === TokenId.MINUS) return config.spaceAroundOperators;
  if (isOperator(after)) return config.spaceAroundOperators;
  if (isOperator(before)) return config.spaceAroundOperators;

  // Adjacent words/literals need a separator; punctuation handled above does not.
  return true;
}
