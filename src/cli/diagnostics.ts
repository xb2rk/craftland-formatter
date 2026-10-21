import type { FcDiagnostic } from "../diagnostics.js";
import type { LexDiagnostic } from "../lex/diagnostic.js";
import type { LintDiagnostic } from "../lint/contracts.js";
import type { ParseDiagnostic } from "../parser/diagnostic.js";

/**
 * Anything with a code (or lint ruleId), a message, and a range renders
 * through this module — the single human-facing diagnostic consumer (A1).
 * Lex, parse, lint, and unified Fc diagnostics are all assignable.
 */
export type RenderableDiagnostic = {
  readonly code?: string;
  readonly message: string;
  readonly range: FcDiagnostic["range"];
  readonly ruleId?: string;
};

/** How many diagnostics are printed before the remainder is summarized. */
export const MAX_REPORTED_DIAGNOSTICS = 10;

/**
 * Renders one diagnostic as `file:line:column code message`. Source positions
 * are zero-based UTF-16 LSP coordinates; humans get one-based coordinates.
 */
export function formatDiagnostic(file: string, diagnostic: RenderableDiagnostic): string {
  const { line, column } = diagnostic.range.start;
  return `${file}:${line + 1}:${column + 1} ${diagnostic.code ?? diagnostic.ruleId ?? "unknown"} ${diagnostic.message}`;
}

/** Renders the parenthesized diagnostic list for "cannot format source" errors. */
export function formatDiagnosticList(file: string, diagnostics: readonly RenderableDiagnostic[]): string {
  const shown = diagnostics.slice(0, MAX_REPORTED_DIAGNOSTICS).map((diagnostic) => formatDiagnostic(file, diagnostic));
  const hidden = diagnostics.length - shown.length;
  if (hidden > 0) shown.push(`...and ${hidden} more`);
  return shown.join("; ");
}
