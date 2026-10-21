import { DEFAULT_LINT_RULES, LINT_RULE_IDS, resolveFormatOptions, type FormatOptions, type LintOptions, type LintRuleId, type RuleLevel } from "../../dist/index.js";

export interface SettingsReader {
  get<T>(section: string): T | undefined;
}

/** Maps the extension configuration namespace to the core's validated public contract. */
export function readFormatOptions(settings: SettingsReader): FormatOptions {
  const raw: FormatOptions = {
    printWidth: settings.get<number>("printWidth"),
    tabWidth: settings.get<number>("tabWidth"),
    useTabs: settings.get<boolean>("useTabs"),
    spaceAroundOperators: settings.get<boolean>("spaceAroundOperators"),
    spaceAfterComma: settings.get<boolean>("spaceAfterComma"),
    wrapCalls: settings.get<FormatOptions["wrapCalls"]>("wrapCalls"),
    wrapCollections: settings.get<FormatOptions["wrapCollections"]>("wrapCollections"),
    collapseBlankLines: settings.get<boolean>("collapseBlankLines"),
    insertFinalNewline: settings.get<boolean>("insertFinalNewline"),
  };
  return resolveFormatOptions(raw);
}

/** Maps optional lint settings without allowing arbitrary rule identifiers into the core. */
export function readLintOptions(settings: SettingsReader): LintOptions {
  const rawRules = settings.get<Record<string, unknown>>("lint.rules") ?? {};
  const rules: Partial<Record<LintRuleId, RuleLevel>> = {};
  for (const ruleId of LINT_RULE_IDS) {
    const level = rawRules[ruleId];
    if (level === "off" || level === "error" || level === "warning" || level === "information" || level === "hint") rules[ruleId] = level;
  }
  return {
    ignoredOutVariables: settings.get<boolean>("lint.ignoredOutVariables") ?? true,
    rules: { ...DEFAULT_LINT_RULES, ...rules },
    suppressions: settings.get<boolean>("lint.suppressions") ?? true,
  };
}
