import type { SourceRange } from "./position.js";

export type LexDiagnosticCode =
  | "unexpected-character"
  | "unterminated-block-comment"
  | "unterminated-interpreted-string"
  | "unterminated-raw-string"
  | "unterminated-rune";

/** A recoverable lexical issue. Tokens still cover the original bytes exactly. */
export interface LexDiagnostic {
  readonly code: LexDiagnosticCode;
  readonly message: string;
  readonly range: SourceRange;
}
