import { TokenId } from "../grammar/token-vocabulary.generated.js";
import { lex } from "../lex/lexer.js";
import type { LexDiagnostic } from "../lex/diagnostic.js";
import type { SourceRange } from "../lex/position.js";
import { parseGraphFile, parseHeaderFile } from "../parser/file-parser.js";
import type { ParseDiagnostic } from "../parser/diagnostic.js";
import type {
  BlockNode, EventDeclarationNode, FunctionDeclarationNode, GraphFileNode, HeaderFileNode,
  IfStatementNode, ImportNode, StatementNode,
} from "../syntax/nodes.js";
import { bindFile, type BindingResult, type BoundSymbol } from "./binder.js";
import { analyzeControlFlow } from "./data-flow.js";
import { toLintDiagnostic } from "../diagnostics.js";
import {
  DEFAULT_LINT_RULES, LINT_RULE_IDS, type LintDiagnostic, type LintOptions,
  type LintResult, type LintRuleId, type LintSeverity, type RuleLevel,
} from "./contracts.js";

const COMMENT_KINDS = new Set<number>([TokenId.COMMENT, TokenId.LINE_COMMENT, TokenId.COMMENT_NLSEMI, TokenId.LINE_COMMENT_NLSEMI]);

/** Lint one complete FC document. Syntax errors are blocking and suppress rule execution. */
export function lintSource(source: string, options: LintOptions = {}): LintResult {
  const fileKind = resolveFileKind(options.fileName, options.fileKind);
  const lexed = lex(source);
  const diagnostics: LintDiagnostic[] = [];
  const suppression = options.suppressions === false
    ? new Map<number, ReadonlySet<string>>()
    : collectSuppressions(lexed.tokens, diagnostics);
  for (const diagnostic of lexed.diagnostics) diagnostics.push(fromLexDiagnostic(diagnostic));
  if (lexed.diagnostics.length > 0) return finish(diagnostics, fileKind);

  const parsed = fileKind === "fcc" ? parseHeaderFile(lexed) : parseGraphFile(lexed);
  for (const diagnostic of parsed.diagnostics) diagnostics.push(fromParseDiagnostic(diagnostic));
  if (parsed.diagnostics.length > 0 || !parsed.node || !parsed.consumedThroughEof) return finish(diagnostics, fileKind);

  const invalidRules = Object.entries(options.rules ?? {}).filter(([id, level]) =>
    !(LINT_RULE_IDS as readonly string[]).includes(id) || !isRuleLevel(level));
  for (const [id, level] of invalidRules) {
    const message = !(LINT_RULE_IDS as readonly string[]).includes(id)
      ? `Unknown FC lint rule ${JSON.stringify(id)}.`
      : `Invalid severity ${JSON.stringify(level)} for FC lint rule ${JSON.stringify(id)}.`;
    diagnostics.push(configDiagnostic(message, parsed.node.range));
  }
  const validOverrides: Partial<Record<LintRuleId, RuleLevel>> = {};
  for (const [id, level] of Object.entries(options.rules ?? {})) {
    if ((LINT_RULE_IDS as readonly string[]).includes(id) && isRuleLevel(level)) validOverrides[id as LintRuleId] = level;
  }
  const rules = resolveRules(validOverrides);
  const binding = needsBinding(rules) ? bindFile(parsed.node) : undefined;
  if (binding) diagnostics.push(...runBindingRules(binding, rules, options));
  diagnostics.push(...runStructuralRules(parsed.node, rules));
  diagnostics.push(...runControlFlowRules(parsed.node, rules, binding, lexed.tokens));
  return finish(applySuppressions(diagnostics, suppression), fileKind);
}

function resolveFileKind(fileName: string | undefined, explicit: "fcc" | "fcg" | undefined): "fcc" | "fcg" {
  if (explicit) return explicit;
  return fileName?.toLowerCase().endsWith(".fcc") ? "fcc" : "fcg";
}

function resolveRules(overrides: Partial<Record<LintRuleId, RuleLevel>> | undefined): Readonly<Record<LintRuleId, RuleLevel>> {
  return { ...DEFAULT_LINT_RULES, ...(overrides ?? {}) };
}

function isRuleLevel(value: unknown): value is RuleLevel {
  return value === "off" || value === "error" || value === "warning" || value === "information" || value === "hint";
}

function needsBinding(rules: Readonly<Record<LintRuleId, RuleLevel>>): boolean {
  return rules["fc/no-unused-local"] !== "off"
    || rules["fc/no-unused-parameter"] !== "off"
    || rules["fc/no-duplicate-declaration"] !== "off"
    || rules["fc/no-self-assignment"] !== "off"
    || rules["fc/no-dead-store"] !== "off";
}

function runBindingRules(binding: BindingResult, rules: Readonly<Record<LintRuleId, RuleLevel>>, options: LintOptions): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const unusedLocalLevel = severity(rules["fc/no-unused-local"]);
  const unusedParameterLevel = severity(rules["fc/no-unused-parameter"]);
  const duplicateLevel = severity(rules["fc/no-duplicate-declaration"]);
  for (const symbol of binding.symbols) {
    if (unusedLocalLevel && (symbol.kind === "local" || symbol.kind === "loop") && symbol.reads.length === 0
      && !symbol.name.startsWith("_") && !(symbol.fromOutVar && options.ignoredOutVariables !== false)) {
      diagnostics.push(report("fc/no-unused-local", unusedLocalLevel, `Local '${symbol.name}' is never read.`, symbol.declaration.range));
    }
    if (unusedParameterLevel && symbol.kind === "parameter" && symbol.reads.length === 0
      && !symbol.name.startsWith("_") && symbol.owner?.kind === "function-declaration") {
      diagnostics.push(report("fc/no-unused-parameter", unusedParameterLevel, `Parameter '${symbol.name}' is never read.`, symbol.declaration.range));
    }
  }
  if (duplicateLevel) {
    for (const duplicate of binding.duplicates) {
      if (duplicate.duplicate.kind === "field" || duplicate.duplicate.kind === "local" || duplicate.duplicate.kind === "loop" || duplicate.duplicate.kind === "parameter" || duplicate.duplicate.kind === "callable") {
        diagnostics.push(report("fc/no-duplicate-declaration", duplicateLevel, `Duplicate declaration '${duplicate.duplicate.name}'.`, duplicate.duplicate.declaration.range));
      }
    }
  }
  return diagnostics;
}

function runStructuralRules(file: HeaderFileNode | GraphFileNode, rules: Readonly<Record<LintRuleId, RuleLevel>>): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const emptyLevel = severity(rules["fc/no-empty-block"]);
  const selfLevel = severity(rules["fc/no-self-assignment"]);
  const importLevel = severity(rules["fc/no-duplicate-import-alias"]);
  if (importLevel) collectDuplicateImports(file, importLevel, diagnostics);
  const visitFunction = (fn: FunctionDeclarationNode): void => { if (fn.body) visitBlock(fn.body, emptyLevel, diagnostics); };
  const visitEvent = (event: EventDeclarationNode): void => { if (event.body) visitBlock(event.body, emptyLevel, diagnostics); };

  if (file.kind === "graph-file") {
    for (const member of file.graph?.members ?? []) {
      if (member.kind === "function-declaration") visitFunction(member);
      if (member.kind === "event-declaration") visitEvent(member);
    }
  }
  if (selfLevel && file.kind === "graph-file") {
    for (const member of file.graph?.members ?? []) if (member.kind === "function-declaration" && member.body) collectSelfAssignments(member.body, selfLevel, diagnostics);
    for (const member of file.graph?.members ?? []) if (member.kind === "event-declaration" && member.body) collectSelfAssignments(member.body, selfLevel, diagnostics);
  }
  if (file.kind === "header-file") {
    for (const declaration of file.declarations) {
      if (declaration.kind === "function-declaration" && declaration.body) visitFunction(declaration);
      if (declaration.kind === "event-declaration" && declaration.body) visitEvent(declaration);
    }
  }
  return diagnostics;
}

function runControlFlowRules(
  file: HeaderFileNode | GraphFileNode,
  rules: Readonly<Record<LintRuleId, RuleLevel>>,
  binding: BindingResult | undefined,
  tokens: readonly import("../lex/token.js").Token[],
): LintDiagnostic[] {
  const unreachableLevel = severity(rules["fc/no-unreachable"]);
  const constantLevel = severity(rules["fc/no-constant-condition"]);
  const deadStoreLevel = severity(rules["fc/no-dead-store"]);
  if (!unreachableLevel && !constantLevel && !deadStoreLevel) return [];
  const diagnostics: LintDiagnostic[] = [];
  const symbols = new Map((binding?.symbols ?? []).map((symbol) => [symbol.id, symbol]));
  const visitBody = (body: BlockNode): void => {
    const analysis = analyzeControlFlow(body, binding, tokens);
    if (unreachableLevel) {
      for (const node of analysis.unreachable) {
        if (node.statement) diagnostics.push(report("fc/no-unreachable", unreachableLevel, "Unreachable statement.", node.statement.range));
      }
    }
    if (constantLevel) {
      for (const condition of analysis.constantConditions) {
        diagnostics.push(report(
          "fc/no-constant-condition",
          constantLevel,
          `Condition is always ${condition.value ? "true" : "false"}.`,
          condition.range,
        ));
      }
    }
    if (deadStoreLevel) {
      for (const deadStore of analysis.deadStores) {
        const symbol = symbols.get(deadStore.symbolId);
        if (symbol) diagnostics.push(report("fc/no-dead-store", deadStoreLevel, `Assignment to '${symbol.name}' is never read.`, deadStore.range));
      }
    }
  };
  if (file.kind === "graph-file") {
    for (const member of file.graph?.members ?? []) {
      if (member.kind === "function-declaration" && member.body) visitBody(member.body);
      if (member.kind === "event-declaration" && member.body) visitBody(member.body);
    }
  } else {
    for (const declaration of file.declarations) {
      if (declaration.kind === "function-declaration" && declaration.body) visitBody(declaration.body);
      if (declaration.kind === "event-declaration" && declaration.body) visitBody(declaration.body);
    }
  }
  return diagnostics;
}

function collectDuplicateImports(file: HeaderFileNode | GraphFileNode, level: LintSeverity, diagnostics: LintDiagnostic[]): void {
  const seen = new Map<string, ImportNode>();
  for (const current of file.imports) {
    const name = current.kind === "library-import" ? current.alias?.text : current.alias?.text ?? current.imported?.text;
    if (!name) continue;
    const previous = seen.get(name);
    if (previous) {
      const declaration = current.kind === "library-import" ? current.alias : current.alias ?? current.imported;
      if (declaration) diagnostics.push(report("fc/no-duplicate-import-alias", level, `Duplicate import alias '${name}'.`, declaration.range));
    } else seen.set(name, current);
  }
}

function visitBlock(block: BlockNode, emptyLevel: LintSeverity | undefined, diagnostics: LintDiagnostic[]): void {
  if (emptyLevel && block.statements.length === 0) diagnostics.push(report("fc/no-empty-block", emptyLevel, "Empty block.", block.range));
  for (const statement of block.statements) {
    visitNestedBlocks(statement, emptyLevel, diagnostics);
  }
}

function visitNestedBlocks(statement: StatementNode, emptyLevel: LintSeverity | undefined, diagnostics: LintDiagnostic[]): void {
  if (statement.kind === "block") visitBlock(statement, emptyLevel, diagnostics);
  if (statement.kind === "if-statement") {
    if (statement.consequent) visitBlock(statement.consequent, emptyLevel, diagnostics);
    if (statement.alternate?.kind === "if-statement") visitNestedBlocks(statement.alternate, emptyLevel, diagnostics);
    else if (statement.alternate) visitBlock(statement.alternate, emptyLevel, diagnostics);
  }
  if (statement.kind === "while-statement" && statement.body) visitBlock(statement.body, emptyLevel, diagnostics);
  if ((statement.kind === "for-index-statement" || statement.kind === "for-range-statement" || statement.kind === "for-expression-statement") && statement.body) visitBlock(statement.body, emptyLevel, diagnostics);
}

function collectSelfAssignments(block: BlockNode, level: LintSeverity, diagnostics: LintDiagnostic[]): void {
  for (const statement of block.statements) {
    if (statement.kind === "assignment-statement" && statement.operator === TokenId.ASSIGN
      && statement.left?.kind === "name-expression" && statement.right?.kind === "name-expression"
      && statement.left.name.text === statement.right.name.text) {
      diagnostics.push(report("fc/no-self-assignment", level, `Self-assignment of '${statement.left.name.text}'.`, statement.left.name.range));
    }
    if (statement.kind === "block") collectSelfAssignments(statement, level, diagnostics);
    if (statement.kind === "if-statement") {
      if (statement.consequent) collectSelfAssignments(statement.consequent, level, diagnostics);
      if (statement.alternate?.kind === "if-statement") collectSelfAssignmentsFromIf(statement.alternate, level, diagnostics);
      else if (statement.alternate) collectSelfAssignments(statement.alternate, level, diagnostics);
    }
    if (statement.kind === "while-statement" && statement.body) collectSelfAssignments(statement.body, level, diagnostics);
    if ((statement.kind === "for-index-statement" || statement.kind === "for-range-statement" || statement.kind === "for-expression-statement") && statement.body) collectSelfAssignments(statement.body, level, diagnostics);
  }
}

function collectSelfAssignmentsFromIf(statement: IfStatementNode, level: LintSeverity, diagnostics: LintDiagnostic[]): void {
  if (statement.consequent) collectSelfAssignments(statement.consequent, level, diagnostics);
  if (statement.alternate?.kind === "if-statement") collectSelfAssignmentsFromIf(statement.alternate, level, diagnostics);
  else if (statement.alternate) collectSelfAssignments(statement.alternate, level, diagnostics);
}

function severity(level: RuleLevel): LintSeverity | undefined { return level === "off" ? undefined : level; }

function report(ruleId: LintRuleId, level: LintSeverity, message: string, range: SourceRange): LintDiagnostic {
  return { message, range, ruleId, severity: level, source: "fc-lint" };
}

function configDiagnostic(message: string, range: SourceRange): LintDiagnostic {
  return { code: "invalid-config", message, range, ruleId: "fc/config", severity: "error", source: "fc-lint" };
}

function fromLexDiagnostic(diagnostic: LexDiagnostic): LintDiagnostic {
  return toLintDiagnostic(diagnostic);
}

function fromParseDiagnostic(diagnostic: ParseDiagnostic): LintDiagnostic {
  return toLintDiagnostic(diagnostic);
}

function collectSuppressions(
  tokens: readonly { readonly kind: number; readonly text: string; readonly range: SourceRange }[],
  diagnostics: LintDiagnostic[],
): Map<number, ReadonlySet<string>> {
  const result = new Map<number, ReadonlySet<string>>();
  for (const token of tokens) {
    if (!COMMENT_KINDS.has(token.kind)) continue;
    const body = token.text.replace(/^\/\//u, "").replace(/^\/\*/u, "").replace(/\*\/$/u, "").trim();
    const match = body.match(/^fc-lint-disable-next-line(?:\s+(.+?))?$/u);
    if (!match) continue;
    const ids = (match[1] ?? "").split(/[\s,]+/u).filter(Boolean);
    if (ids.length === 0) {
      diagnostics.push(configDiagnostic("fc-lint-disable-next-line requires at least one rule ID.", token.range));
    } else {
      for (const id of ids) {
        if (id !== "*" && id !== "all" && !(LINT_RULE_IDS as readonly string[]).includes(id)) {
          diagnostics.push(configDiagnostic(`Unknown FC lint suppression rule ${JSON.stringify(id)}.`, token.range));
        }
      }
    }
    result.set(token.range.start.line + 1, new Set(ids));
  }
  return result;
}

function applySuppressions(diagnostics: readonly LintDiagnostic[], suppressions: ReadonlyMap<number, ReadonlySet<string>>): LintDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.source === "fc-parser" || !suppressionMatches(diagnostic, suppressions));
}

function suppressionMatches(diagnostic: LintDiagnostic, suppressions: ReadonlyMap<number, ReadonlySet<string>>): boolean {
  const ids = suppressions.get(diagnostic.range.start.line);
  return Boolean(ids?.has(diagnostic.ruleId) || ids?.has("*") || ids?.has("all"));
}

function finish(diagnostics: readonly LintDiagnostic[], fileKind: "fcc" | "fcg"): LintResult {
  return {
    diagnostics: [...diagnostics].sort((a, b) => a.range.start.offset - b.range.start.offset || a.ruleId.localeCompare(b.ruleId)),
    fileKind,
    parsed: !diagnostics.some((diagnostic) => diagnostic.source === "fc-parser"),
  };
}
