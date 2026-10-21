/** A zero-based UTF-16 source position, compatible with LSP coordinates. */
export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

/** A half-open source range: `[start, end)`. */
export interface SourceRange {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}
