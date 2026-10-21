import type { SourceRange } from "../lex/position.js";

export type ParseDiagnosticCode =
  | "expected-expression"
  | "expected-name"
  | "expected-token"
  | "expected-type"
  | "unexpected-decorator"
  | "unexpected-token";

/** A recoverable parser diagnostic. Invalid input is never silently rewritten. */
export interface ParseDiagnostic {
  readonly code: ParseDiagnosticCode;
  readonly message: string;
  readonly range: SourceRange;
}
