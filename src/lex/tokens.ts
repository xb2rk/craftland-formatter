/**
 * @module lex/tokens - shared lossless lexical data types.
 */

import { TokenId } from "./grammar.generated.js";

/** A source position measured in JavaScript UTF-16 code units. */
export interface SourcePosition {
  /** Offset from the start of the source in UTF-16 code units. */
  offset: number;
  /** 1-indexed line number. */
  line: number;
  /** 1-indexed column number. */
  column: number;
}

/** Half-open source span: `start` is included and `end` is excluded. */
export interface SourceSpan {
  /** Included start position. */
  start: SourcePosition;
  /** Excluded end position. */
  end: SourcePosition;
}

/** One raw lexical unit. Its text is always an exact source slice. */
export interface Token {
  /** Numeric token id (mirrors `FCGLexer` id). */
  kind: TokenId;
  /** Exact source slice for this token. */
  text: string;
  /** Half-open span in the original source. */
  span: SourceSpan;
}

export type TokenKind = TokenId;

/**
 * Rebuild source exactly from raw tokens, ignoring only the EOF sentinel.
 *
 * @param tokens - raw tokens from `tokenize` (includes EOF).
 * @returns exact source text with EOF removed.
 */
export function reconstructTokens(tokens: readonly Token[]): string {
  return tokens
    .filter((token) => token.kind !== TokenId.EOF)
    .map((token) => token.text)
    .join("");
}
