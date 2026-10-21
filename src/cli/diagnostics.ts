/**
 * Diagnostics rendering subsystem for the CLI and user-facing reports.
 *
 * Formats errors and warnings into human-readable, IDE-navigable coordinate strings.
 */

import type { SourceRange } from "../lex/position.js";

/**
 * Diagnostic shape accepted for human-facing terminal rendering.
 */
export interface RenderableDiagnostic {
  readonly code?: string;
  readonly message: string;
  readonly range: SourceRange;
  readonly ruleId?: string;
}

/** Maximum number of diagnostics printed before summarizing remainder. */
export const MAX_REPORTED_DIAGNOSTICS = 10;

/**
 * Renders a single diagnostic into a standard 1-based `file:line:column code message` string.
 *
 * @param file - Relative or absolute path to the file.
 * @param diagnostic - Diagnostic object containing coordinates and message.
 */
export function formatDiagnostic(file: string, diagnostic: RenderableDiagnostic): string {
  const { line, column } = diagnostic.range.start;
  const tag = diagnostic.code ?? diagnostic.ruleId ?? "unknown";
  return `${file}:${line + 1}:${column + 1} ${tag} ${diagnostic.message}`;
}

/**
 * Renders a list of diagnostics, truncating after {@link MAX_REPORTED_DIAGNOSTICS}.
 *
 * @param file - File path associated with diagnostics.
 * @param diagnostics - Collection of diagnostics to render.
 */
export function formatDiagnosticList(file: string, diagnostics: readonly RenderableDiagnostic[]): string {
  const shown = diagnostics.slice(0, MAX_REPORTED_DIAGNOSTICS).map((d) => formatDiagnostic(file, d));
  const hidden = diagnostics.length - shown.length;
  if (hidden > 0) {
    shown.push(`...and ${hidden} more`);
  }
  return shown.join("; ");
}
