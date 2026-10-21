/**
 * FC automatic-semicolon boundary analysis.
 *
 * The source lexer deliberately preserves raw trivia rather than emulating
 * ANTLR's NLSEMI mode. This module recreates its observable EOS behavior over
 * that lossless token stream. It knows nothing about parser nesting: FCGLexer
 * itself can emit EOS inside parentheses, and grammar productions decide
 * whether such a boundary is valid in context.
 */

import { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { SourcePosition, SourceRange } from "../lex/position.js";
import type { Token } from "../lex/token.js";
import { containsLineBreak, isTrivia, triviaKindOf } from "../lex/trivia.js";

export interface ExplicitStatementBoundary {
  readonly kind: "explicit";
  readonly range: SourceRange;
  readonly separatorTokenIndex: number;
}

export interface VirtualStatementBoundary {
  readonly kind: "virtual";
  readonly precedingTokenIndex: number;
  readonly range: SourceRange;
  readonly triviaTokenIndex: number;
}

export type StatementBoundary = ExplicitStatementBoundary | VirtualStatementBoundary;

/**
 * Token kinds that switch FCGLexer into its NLSEMI mode. This set is pinned by
 * `npm run verify:eos` against the installed extension; do not broaden it
 * based on a statement-level guess.
 */
const EOS_CAPABLE_TOKEN_IDS = new Set<number>([
  TokenId.IDENTIFIER,
  TokenId.BREAK,
  TokenId.CONTINUE,
  TokenId.RETURN,
  TokenId.THISENTITY,
  TokenId.GLOBALENTITY,
  TokenId.OBJECT,
  TokenId.TYPE,
  TokenId.BOOL,
  TokenId.INT,
  TokenId.INT64,
  TokenId.FLOAT,
  TokenId.STRING,
  TokenId.COLOR,
  TokenId.VECTOR2,
  TokenId.VECTOR3,
  TokenId.QUATERNION,
  TokenId.LIST,
  TokenId.MAP,
  TokenId.LOC_STRING,
  TokenId.ENTITY,
  TokenId.TRUE,
  TokenId.FALSE,
  TokenId.NIL_LIT,
  TokenId.R_PAREN,
  TokenId.R_CURLY,
  TokenId.R_BRACKET,
  TokenId.PLUS_PLUS,
  TokenId.MINUS_MINUS,
  TokenId.GREATER,
  TokenId.DECIMAL_LIT,
  TokenId.BINARY_LIT,
  TokenId.OCTAL_LIT,
  TokenId.HEX_LIT,
  TokenId.COLOR_HEX_LIT,
  TokenId.FLOAT_LIT,
  TokenId.DECIMAL_FLOAT_LIT,
  TokenId.HEX_FLOAT_LIT,
  TokenId.IMAGINARY_LIT,
  TokenId.RUNE_LIT,
  TokenId.BYTE_VALUE,
  TokenId.OCTAL_BYTE_VALUE,
  TokenId.HEX_BYTE_VALUE,
  TokenId.LITTLE_U_VALUE,
  TokenId.BIG_U_VALUE,
  TokenId.RAW_STRING_LIT,
  TokenId.INTERPRETED_STRING_LIT,
]);

/** Returns whether an FCGLexer token enables NLSEMI after itself. */
export function canTriggerVirtualEos(token: Token): boolean {
  return EOS_CAPABLE_TOKEN_IDS.has(token.kind);
}

/**
 * Finds lexical separators in source order. Explicit semicolons are reported
 * as candidates even in grammar contexts (such as a future `for` header)
 * where a parser rule gives them a different meaning.
 */
export function deriveStatementBoundaries(tokens: readonly Token[]): readonly StatementBoundary[] {
  const boundaries: StatementBoundary[] = [];
  let eosArmedByTokenIndex: number | undefined;

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    if (!token || token.kind === TokenId.EOF) break;

    if (isTrivia(token)) {
      if (eosArmedByTokenIndex !== undefined && containsLineBreak(token)) {
        boundaries.push({
          kind: "virtual",
          precedingTokenIndex: eosArmedByTokenIndex,
          range: eosRangeWithinTrivia(token),
          triviaTokenIndex: tokenIndex,
        });
        eosArmedByTokenIndex = undefined;
      }
      continue;
    }

    if (token.kind === TokenId.SEMI) {
      boundaries.push({ kind: "explicit", range: token.range, separatorTokenIndex: tokenIndex });
    }
    eosArmedByTokenIndex = canTriggerVirtualEos(token) ? tokenIndex : undefined;
  }

  return boundaries;
}

function eosRangeWithinTrivia(token: Token): SourceRange {
  const kind = triviaKindOf(token);
  if (kind === "block-comment" || kind === "jsdoc") {
    // FCGLexer emits the complete comment as EOS when an armed multiline block
    // comment carries the first line terminator.
    return token.range;
  }

  const firstLineBreak = firstLineBreakOffset(token.text);
  if (firstLineBreak === undefined) return token.range;
  const start = advancePosition(token.range.start, token.text.slice(0, firstLineBreak));
  const endOffset = consecutiveLineBreakEnd(token.text, firstLineBreak);
  const end = advancePosition(start, token.text.slice(firstLineBreak, endOffset));
  return { start, end };
}

function firstLineBreakOffset(text: string): number | undefined {
  const carriageReturn = text.indexOf("\r");
  const lineFeed = text.indexOf("\n");
  if (carriageReturn === -1) return lineFeed === -1 ? undefined : lineFeed;
  if (lineFeed === -1) return carriageReturn;
  return Math.min(carriageReturn, lineFeed);
}

function consecutiveLineBreakEnd(text: string, start: number): number {
  let offset = start;
  while (offset < text.length) {
    if (text[offset] === "\r") {
      offset += text[offset + 1] === "\n" ? 2 : 1;
    } else if (text[offset] === "\n") {
      offset += 1;
    } else {
      break;
    }
  }
  return offset;
}

function advancePosition(start: SourcePosition, text: string): SourcePosition {
  let column = start.column;
  let line = start.line;
  let offset = start.offset;
  let previousWasCarriageReturn = false;

  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    index += character.length;
    offset += character.length;
    if (character === "\r") {
      line += 1;
      column = 0;
      previousWasCarriageReturn = true;
    } else if (character === "\n") {
      if (!previousWasCarriageReturn) line += 1;
      column = 0;
      previousWasCarriageReturn = false;
    } else {
      column += character.length;
      previousWasCarriageReturn = false;
    }
  }

  return { offset, line, column };
}
