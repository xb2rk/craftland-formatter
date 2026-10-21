/**
 * @module lint/index - structural linter orchestrator for Craftland `.fcc`/`.fcg` source.
 *
 * Each rule lives in `rules/*`; this module only wires them together and sorts
 * diagnostics. The linter consumes the same lossless token stream and delimiter
 * tree as the formatter. Rules inspect ranges but never mutate source.
 */

import type { Config } from "../format/config.js";
import type { LexedDocument } from "../lex/items.js";
import { buildAnalysis, type Analysis, type Diagnostic } from "./analysis.js";
import { DEFAULT_LINT_OPTIONS, normalizeOptions, type LintOptions } from "./options.js";
import { pushDeclarationRules } from "./rules/declaration.js";
import { pushEnumRules } from "./rules/enum.js";
import { pushImportRules } from "./rules/imports.js";
import { pushNameRules } from "./rules/naming.js";
import { pushPlatformRules } from "./rules/platform.js";
import { pushShapeRules } from "./rules/shape.js";
import { pushLineLengthRules, pushStyleRules } from "./rules/style.js";
import { pushTrailingCommaRules } from "./rules/trailing-comma.js";

export type { Diagnostic, Edit, Severity } from "./analysis.js";
export type { Analysis } from "./analysis.js";
export type { LintOptions } from "./options.js";
export { DEFAULT_LINT_OPTIONS, normalizeOptions } from "./options.js";

/**
 * Lint analysis helper (internal).
 *
 * @param analysis - analysis.
 * @param config - normalized lint options.
 * @returns diagnostics.
 */
function lintAnalysis(analysis: Analysis, config: Required<LintOptions>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  // Keep rule order deterministic for snapshot tests: imports → naming → decl → platform → enum → shape → style → length.
  pushImportRules(analysis, diagnostics);
  pushNameRules(analysis, diagnostics);
  pushDeclarationRules(analysis, diagnostics);
  pushPlatformRules(analysis, diagnostics);
  pushEnumRules(analysis, diagnostics);
  pushShapeRules(analysis, diagnostics);
  pushTrailingCommaRules(analysis, diagnostics, config);
  pushStyleRules(analysis, diagnostics, config);
  pushLineLengthRules(analysis, diagnostics, config.printWidth);
  return diagnostics.sort(
    (left, right) => left.line - right.line || left.column - right.column || left.ruleId.localeCompare(right.ruleId),
  );
}

/**
 * Lint one source document and return deterministic, source-ordered diagnostics.
 *
 * @param source - source text.
 * @param options - lint options.
 * @returns diagnostics sorted by position.
 */
export function lintSource(source: string, options: Partial<LintOptions> | Pick<Config, "printWidth"> = {}): Diagnostic[] {
  return lintAnalysis(buildAnalysis(source), normalizeOptions(options));
}

/**
 * Lint an already-tokenized document when a host wants to share its pipeline.
 *
 * @param document - lexed document.
 * @param source - source text.
 * @param options - lint options.
 * @returns diagnostics.
 */
export function lintDocument(document: LexedDocument, source: string, options: Partial<LintOptions> | Pick<Config, "printWidth"> = {}): Diagnostic[] {
  return lintAnalysis(buildAnalysis(source, document), normalizeOptions(options));
}

export type { Config } from "../format/config.js";

// Re-export helpers for tests that import from lint/index.
export { buildAnalysis } from "./analysis.js";
