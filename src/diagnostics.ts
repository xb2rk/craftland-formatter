import type { LexDiagnostic, LexDiagnosticCode } from "./lex/diagnostic.js";
import type { SourceRange } from "./lex/position.js";
import type { LintDiagnostic, LintSeverity } from "./lint/contracts.js";
import type { ParseDiagnostic, ParseDiagnosticCode } from "./parser/diagnostic.js";

/**
 * The single interchange shape for every pipeline layer. Lex and parse
 * diagnostics already share `{ code, message, range }`; lint diagnostics
 * carry `ruleId`/`severity`/`source` instead. Adapters below convert each
 * layer to this shape so the CLI renderer (A1) is the only consumer that
 * formats diagnostics for humans.
 */

/** Which pipeline layer produced the diagnostic. */
export type DiagnosticLayer = "lex" | "parse" | "lint";

export type DiagnosticSeverity = LintSeverity;

export type FcDiagnosticCode = LexDiagnosticCode | ParseDiagnosticCode;

export interface FcDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly range: SourceRange;
  readonly severity: DiagnosticSeverity;
  readonly layer: DiagnosticLayer;
  /** Lint rule ID; present only when layer is "lint". */
  readonly ruleId?: string;
}

export function fromLexDiagnostic(diagnostic: LexDiagnostic): FcDiagnostic {
  return {
    code: diagnostic.code,
    layer: "lex",
    message: diagnostic.message,
    range: diagnostic.range,
    severity: "error",
  };
}

export function fromParseDiagnostic(diagnostic: ParseDiagnostic): FcDiagnostic {
  return {
    code: diagnostic.code,
    layer: "parse",
    message: diagnostic.message,
    range: diagnostic.range,
    severity: "error",
  };
}

export function fromLintDiagnostic(diagnostic: LintDiagnostic): FcDiagnostic {
  return {
    code: diagnostic.code ?? diagnostic.ruleId,
    layer: "lint",
    message: diagnostic.message,
    range: diagnostic.range,
    ruleId: diagnostic.ruleId,
    severity: diagnostic.severity,
  };
}

/**
 * The single lex/parse → lint adaptation. Malformed input is reported as
 * `fc/parse` with `fc-parser` provenance; every previous per-layer copy of
 * this mapping delegated here.
 */
export function toLintDiagnostic(diagnostic: LexDiagnostic | ParseDiagnostic): LintDiagnostic {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    range: diagnostic.range,
    ruleId: "fc/parse",
    severity: "error",
    source: "fc-parser",
  };
}
