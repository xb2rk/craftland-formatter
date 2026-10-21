import { TokenId } from "../grammar/token-vocabulary.generated.js";
import { lex } from "../lex/lexer.js";
import type { SourceRange } from "../lex/position.js";
import { bindFile } from "../lint/binder.js";
import {
  DEFAULT_LINT_RULES, type LintDiagnostic, type LintRuleId, type LintSeverity, type RuleLevel,
} from "../lint/contracts.js";
import type { WorkspaceFileRecord, WorkspaceIndex } from "./index.js";

/** Options for cross-file rules. Document-local linting remains in lintSource. */
export interface WorkspaceLintOptions {
  readonly rules?: Partial<Record<LintRuleId, RuleLevel>>;
  readonly suppressions?: boolean;
}

/** A workspace diagnostic carries the canonical source file alongside its range. */
export interface WorkspaceDiagnostic extends LintDiagnostic {
  readonly file: string;
}

export interface WorkspaceLintResult {
  readonly diagnostics: readonly WorkspaceDiagnostic[];
}

const COMMENT_KINDS = new Set<number>([
  TokenId.COMMENT, TokenId.LINE_COMMENT, TokenId.COMMENT_NLSEMI, TokenId.LINE_COMMENT_NLSEMI,
]);

/**
 * Run workspace-only rules over a complete in-memory index.
 *
 * The function deliberately does not call the compiler, touch the filesystem,
 * or change lintSource's document-only contract. Incomplete records are skipped
 * because their imports and declarations are not authoritative.
 */
export function lintWorkspace(index: WorkspaceIndex, options: WorkspaceLintOptions = {}): WorkspaceLintResult {
  const unresolvedLevel = ruleSeverity(options.rules, "fc/no-unresolved-project-import");
  const unresolvedImportedSymbolLevel = ruleSeverity(options.rules, "fc/no-unresolved-imported-symbol");
  const platformLevel = ruleSeverity(options.rules, "fc/no-platform-import-isolation");
  const unusedImportLevel = ruleSeverity(options.rules, "fc/no-unused-import");
  if (!unresolvedLevel && !unresolvedImportedSymbolLevel && !platformLevel && !unusedImportLevel) {
    return { diagnostics: [] };
  }

  const diagnostics: WorkspaceDiagnostic[] = [];
  const filePaths = [...index.files.keys()].sort(comparePaths);
  for (const path of filePaths) {
    const record = index.files.get(path);
    if (!record?.parsed || !record.syntax) continue;
    const suppressions = options.suppressions === false ? undefined : collectSuppressions(record.source);
    if (unresolvedLevel) {
      for (const current of record.imports) {
        if (current.classification !== "unresolved-project") continue;
        pushIfVisible(diagnostics, suppressions, report(
          record.path,
          "fc/no-unresolved-project-import",
          unresolvedLevel,
          `Cannot resolve project import ${JSON.stringify(current.specifier)}.`,
          current.range,
        ));
      }
    }
    if (unresolvedImportedSymbolLevel) {
      for (const [importIndex, current] of record.imports.entries()) {
        if (current.classification !== "project" || current.imported === undefined || current.resolvedPath === undefined) continue;
        const target = index.files.get(current.resolvedPath);
        if (!target?.parsed) continue;
        if (target.declarations.some((declaration) => declaration.name === current.imported)) continue;
        const importedSyntax = record.syntax.imports[importIndex];
        const range = importedSyntax?.kind === "named-import" && importedSyntax.imported
          ? importedSyntax.imported.range
          : current.range;
        pushIfVisible(diagnostics, suppressions, report(
          record.path,
          "fc/no-unresolved-imported-symbol",
          unresolvedImportedSymbolLevel,
          `Imported name '${current.imported}' is not declared by project target ${JSON.stringify(target.relativePath)}.`,
          range,
        ));
      }
    }
    if (platformLevel && (record.platform === "server" || record.platform === "client")) {
      for (const current of record.imports) {
        const target = current.resolvedPath === undefined ? undefined : index.files.get(current.resolvedPath);
        if (!target || target.fileKind !== "fcg" || target.platform === "unknown" || target.platform === "contract") continue;
        if (target.platform === record.platform) continue;
        pushIfVisible(diagnostics, suppressions, report(
          record.path,
          "fc/no-platform-import-isolation",
          platformLevel,
          `${capitalize(record.platform)} graph must not import ${target.platform} graph ${JSON.stringify(target.relativePath)}.`,
          current.range,
        ));
      }
    }
    if (unusedImportLevel) {
      const binding = bindFile(record.syntax);
      const namespaceImportUsage = resolveNamespaceImportUsage(record, binding, index);
      for (const symbol of binding.symbols) {
        if (symbol.kind !== "import" || symbol.importIndex === undefined || symbol.reads.length > 0) continue;
        if (namespaceImportUsage.used.has(symbol.importIndex) || namespaceImportUsage.uncertain.has(symbol.importIndex)) continue;
        const current = record.imports[symbol.importIndex];
        const importedSyntax = record.syntax.imports[symbol.importIndex];
        if (!current) continue;
        if (importedSyntax?.kind === "library-import") {
          const target = current.resolvedPath === undefined ? undefined : index.files.get(current.resolvedPath);
          if (current.classification !== "project" || !target?.parsed) continue;
        }
        if (current.classification === "external-library" || current.classification === "generated-library") continue;
        pushIfVisible(diagnostics, suppressions, report(
          record.path,
          "fc/no-unused-import",
          unusedImportLevel,
          `Imported name '${symbol.name}' is never used.`,
          symbol.declaration.range,
        ));
      }
    }
  }
  diagnostics.sort(compareDiagnostics);
  return { diagnostics };
}

interface NamespaceImportUsage {
  readonly uncertain: ReadonlySet<number>;
  readonly used: ReadonlySet<number>;
}

/**
 * Resolve unqualified names against complete project namespace imports.
 *
 * FC's namespace-style import can make target declarations available without
 * the namespace alias. A lexical binder cannot associate those names on its
 * own, so this pass uses only complete project declaration facts from the
 * workspace index. Ambiguous or missing matches are deliberately left
 * unknown to preserve the linter's no-false-positive boundary.
 */
function resolveNamespaceImportUsage(
  record: WorkspaceFileRecord,
  binding: ReturnType<typeof bindFile>,
  index: WorkspaceIndex,
): NamespaceImportUsage {
  const used = new Set<number>();
  const uncertain = new Set<number>();
  const surfaces = new Map<number, ReadonlySet<string>>();
  for (const [importIndex, importedSyntax] of record.syntax?.imports.entries() ?? []) {
    if (importedSyntax.kind !== "library-import") continue;
    const current = record.imports[importIndex];
    if (current?.classification !== "project" || current.resolvedPath === undefined) continue;
    const target = index.files.get(current.resolvedPath);
    if (!target?.parsed) continue;
    surfaces.set(importIndex, new Set(target.declarations.map((declaration) => declaration.name)));
  }
  if (surfaces.size === 0 || binding.unresolved.length === 0) return { uncertain, used };
  const localNames = new Set(record.declarations.map((declaration) => declaration.name));
  for (const reference of binding.unresolved) {
    if (localNames.has(reference.name.text)) continue;
    const matches = [...surfaces.entries()]
      .filter(([, names]) => names.has(reference.name.text))
      .map(([importIndex]) => importIndex);
    if (matches.length === 1) used.add(matches[0]!);
    else if (matches.length > 1) for (const importIndex of matches) uncertain.add(importIndex);
  }
  return { uncertain, used };
}

function ruleSeverity(
  overrides: Partial<Record<LintRuleId, RuleLevel>> | undefined,
  ruleId: LintRuleId,
): LintSeverity | undefined {
  const level = overrides?.[ruleId] ?? DEFAULT_LINT_RULES[ruleId];
  return level === "off" ? undefined : level;
}

function report(
  file: string,
  ruleId: LintRuleId,
  severity: LintSeverity,
  message: string,
  range: SourceRange,
): WorkspaceDiagnostic {
  return { file, message, range, ruleId, severity, source: "fc-lint" };
}

function pushIfVisible(
  diagnostics: WorkspaceDiagnostic[],
  suppressions: ReadonlyMap<number, ReadonlySet<string>> | undefined,
  diagnostic: WorkspaceDiagnostic,
): void {
  if (!suppressions || !suppressionMatches(diagnostic, suppressions)) diagnostics.push(diagnostic);
}

function collectSuppressions(source: string): ReadonlyMap<number, ReadonlySet<string>> {
  const result = new Map<number, ReadonlySet<string>>();
  for (const token of lex(source).tokens) {
    if (!COMMENT_KINDS.has(token.kind)) continue;
    const body = token.text.replace(/^\/\//u, "").replace(/^\/\*/u, "").replace(/\*\/$/u, "").trim();
    const match = body.match(/^fc-lint-disable-next-line(?:\s+(.+?))?$/u);
    if (!match) continue;
    const ids = (match[1] ?? "").split(/[\s,]+/u).filter(Boolean);
    if (ids.length > 0) result.set(token.range.start.line + 1, new Set(ids));
  }
  return result;
}

function suppressionMatches(
  diagnostic: WorkspaceDiagnostic,
  suppressions: ReadonlyMap<number, ReadonlySet<string>>,
): boolean {
  const ids = suppressions.get(diagnostic.range.start.line);
  return Boolean(ids?.has(diagnostic.ruleId) || ids?.has("*") || ids?.has("all"));
}

function compareDiagnostics(left: WorkspaceDiagnostic, right: WorkspaceDiagnostic): number {
  return left.file.localeCompare(right.file, "en")
    || left.range.start.offset - right.range.start.offset
    || left.ruleId.localeCompare(right.ruleId, "en");
}

function comparePaths(left: string, right: string): number { return left.localeCompare(right, "en"); }

function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
