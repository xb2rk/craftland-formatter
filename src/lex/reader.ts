/**
 * @module lex/reader - minimal UTF-16 cursor over source text.
 */

import type { SourcePosition, SourceSpan } from "./tokens.js";

export class StringReader {
  /** Current offset in UTF-16 code units. */
  private offset = 0;
  /** 1-indexed line. */
  private line = 1;
  /** 1-indexed column. */
  private column = 1;

  constructor(private readonly source: string) {}

  /** True when the cursor is at or past EOF. */
  get atEnd(): boolean {
    return this.offset >= this.source.length;
  }

  /** Current source position (line/column are 1-indexed). */
  get position(): SourcePosition {
    return { offset: this.offset, line: this.line, column: this.column };
  }

  /**
   * Look ahead without consuming.
   *
   * @param lookahead - UTF-16 offset from the current position.
   * @returns single character or `undefined` at EOF.
   */
  peek(lookahead = 0): string | undefined {
    return this.source[this.offset + lookahead];
  }

  /**
   * Peek a slice without consuming.
   *
   * @param length - number of UTF-16 units to peek.
   * @returns source slice (may be shorter at EOF).
   */
  peekText(length: number): string {
    return this.source.slice(this.offset, this.offset + length);
  }

  /**
   * Advance the cursor, updating line/column for each `\n`.
   *
   * @param count - number of UTF-16 units to advance (default 1).
   */
  advance(count = 1): void {
    for (let index = 0; index < count && !this.atEnd; index += 1) {
      if (this.source[this.offset] === "\n") {
        this.line += 1;
        this.column = 1;
      } else {
        this.column += 1;
      }
      this.offset += 1;
    }
  }

  /**
   * Slice source from `start` to the current offset.
   *
   * @param start - UTF-16 offset where the slice starts.
   * @param end - UTF-16 offset where the slice ends (default: current offset).
   * @returns source slice.
   */
  slice(start: number, end = this.offset): string {
    return this.source.slice(start, end);
  }

  /**
   * Build a span from `start` to the current position.
   *
   * @param start - start position.
   * @returns half-open span.
   */
  span(start: SourcePosition): SourceSpan {
    return { start, end: this.position };
  }
}
