import type { SourceRange } from "../lex/position.js";

export type LintSeverity = "error" | "warning" | "information" | "hint";
export type RuleLevel = LintSeverity | "off";

export const LINT_RULE_IDS = [
  "fc/no-unused-local",
  "fc/no-unused-parameter",
  "fc/no-duplicate-declaration",
  "fc/no-duplicate-import-alias",
  "fc/no-self-assignment",
  "fc/no-empty-block",
  "fc/no-constant-condition",
  "fc/no-dead-store",
  "fc/no-unreachable",
  "fc/no-unresolved-project-import",
  "fc/no-unresolved-imported-symbol",
  "fc/no-platform-import-isolation",
  "fc/no-unused-import",
] as const;

export type LintRuleId = (typeof LINT_RULE_IDS)[number];

export interface LintFix {
  readonly description: string;
  readonly edits: readonly LintTextEdit[];
}

export interface LintTextEdit {
  readonly newText: string;
  readonly range: SourceRange;
}

export interface LintDiagnostic {
  readonly code?: string;
  readonly fix?: LintFix;
  readonly message: string;
  readonly range: SourceRange;
  readonly ruleId: string;
  readonly severity: LintSeverity;
  readonly source: "fc-lint" | "fc-parser";
}

export interface LintOptions {
  readonly fileKind?: "fcc" | "fcg";
  readonly fileName?: string;
  readonly ignoredOutVariables?: boolean;
  readonly rules?: Partial<Record<LintRuleId, RuleLevel>>;
  readonly suppressions?: boolean;
}

export interface LintResult {
  readonly diagnostics: readonly LintDiagnostic[];
  readonly fileKind: "fcc" | "fcg";
  readonly parsed: boolean;
}

export const DEFAULT_LINT_RULES: Readonly<Record<LintRuleId, RuleLevel>> = {
  "fc/no-duplicate-declaration": "warning",
  "fc/no-duplicate-import-alias": "error",
  "fc/no-empty-block": "warning",
  "fc/no-constant-condition": "warning",
  "fc/no-dead-store": "warning",
  "fc/no-self-assignment": "warning",
  "fc/no-unreachable": "warning",
  "fc/no-unresolved-project-import": "warning",
  "fc/no-unresolved-imported-symbol": "warning",
  "fc/no-platform-import-isolation": "warning",
  "fc/no-unused-import": "warning",
  "fc/no-unused-local": "warning",
  "fc/no-unused-parameter": "off",
};
