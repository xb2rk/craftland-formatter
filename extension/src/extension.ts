// VS Code extension wrapper for the `fc-format` formatter + linter.
//
// It registers standard VS Code providers for the existing `ffugclanguage`
// language (owned by the official Craftland Studio extension) and never
// touches Assets/. All real logic lives in the sibling core package
// (`../../dist/{format,lint,config}.js`), which is grammar-grounded and
// shared with the standalone CLI.

import * as vscode from "vscode";
import { format } from "../../dist/format.js";
import { lint, Diagnostic } from "../../dist/lint.js";
import { FormatConfig } from "../../dist/config.js";

const LANG = "ffugclanguage";

// Read the `fcFormat.*` settings and hand them to the core as a partial
// config; the core merges them over its documented defaults.
function readConfig(): Partial<FormatConfig> {
  const cfg = vscode.workspace.getConfiguration("fcFormat");
  return (cfg.get<Partial<FormatConfig>>("") ?? {}) as Partial<FormatConfig>;
}

function toVscodeSeverity(sev: Diagnostic["severity"]): vscode.DiagnosticSeverity {
  return sev === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
}

// Map a lint Diagnostic (1-based line/column) to a VS Code Range.
function diagnosticToRange(doc: vscode.TextDocument, d: Diagnostic): vscode.Range {
  const start = doc.positionAt(doc.offsetAt(new vscode.Position(d.line - 1, Math.max(0, d.column - 1))));
  const end = doc.positionAt(doc.offsetAt(start) + Math.max(0, d.length));
  return new vscode.Range(start, end);
}

function toVscodeDiagnostic(doc: vscode.TextDocument, d: Diagnostic): vscode.Diagnostic {
  const diag = new vscode.Diagnostic(diagnosticToRange(doc, d), d.message, toVscodeSeverity(d.severity));
  diag.source = "fc-format";
  diag.code = d.ruleId;
  return diag;
}

function wholeDocRange(doc: vscode.TextDocument): vscode.Range {
  const last = doc.lineAt(doc.lineCount - 1);
  return new vscode.Range(new vscode.Position(0, 0), last.range.end);
}

function formatDocument(doc: vscode.TextDocument): string {
  return format(doc.getText(), readConfig());
}

export function activate(context: vscode.ExtensionContext): void {
  // --- Formatter: Format Document / Format on Save -------------------------
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(LANG, {
      provideDocumentFormattingEdits(doc) {
        return [vscode.TextEdit.replace(wholeDocRange(doc), formatDocument(doc))];
      },
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentRangeFormattingEditProvider(LANG, {
      provideDocumentRangeFormattingEdits(doc, range) {
        // FC formatting is whole-document (imports/blank-lines are global), so
        // a range format still reformats the entire file.
        return [vscode.TextEdit.replace(wholeDocRange(doc), formatDocument(doc))];
      },
    }),
  );

  // --- Linter: live diagnostics -------------------------------------------
  const collection = vscode.languages.createDiagnosticCollection("fcFormat");
  context.subscriptions.push(collection);

  let timer: NodeJS.Timeout | undefined;
  function scheduleLint(doc: vscode.TextDocument): void {
    if (doc.languageId !== LANG) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => lintNow(doc), 250);
  }
  function lintNow(doc: vscode.TextDocument): void {
    if (doc.languageId !== LANG || doc.isClosed) {
      collection.delete(doc.uri);
      return;
    }
    const diags = lint(doc.getText()).map((d) => toVscodeDiagnostic(doc, d));
    collection.set(doc.uri, diags);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => scheduleLint(d)),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleLint(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => collection.delete(d.uri)),
  );
  // Lint anything already open at activation time.
  vscode.workspace.textDocuments.forEach((d) => scheduleLint(d));

  // --- Quick fixes + Source Fix All ---------------------------------------
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      LANG,
      {
        provideCodeActions(doc, _range, ctx) {
          const actions: vscode.CodeAction[] = [];
          const formatted = formatDocument(doc);

          // Per-diagnostic quick fix (runs the whole-doc formatter, which
          // resolves import order/alias/style issues reported by the lint).
          for (const d of ctx.diagnostics) {
            if (d.source !== "fc-format") continue;
            const fix = new vscode.CodeAction(
              `fc-format: fix (${String(d.code)})`,
              vscode.CodeActionKind.QuickFix,
            );
            fix.diagnostics = [d];
            fix.edit = new vscode.WorkspaceEdit();
            fix.edit.replace(doc.uri, wholeDocRange(doc), formatted);
            actions.push(fix);
          }

          // "Fix all" source action (also triggered by editor.codeActionsOnSave).
          const all = new vscode.CodeAction("fc-format: fix all", vscode.CodeActionKind.SourceFixAll);
          all.edit = new vscode.WorkspaceEdit();
          all.edit.replace(doc.uri, wholeDocRange(doc), formatted);
          actions.push(all);

          return actions;
        },
      },
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.SourceFixAll],
      },
    ),
  );

  // --- Commands ------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand("fcFormat.fixAll", () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed || ed.document.languageId !== LANG) return;
      void ed.edit((b) => b.replace(wholeDocRange(ed.document), formatDocument(ed.document)));
    }),
    vscode.commands.registerCommand("fcFormat.lint", () => {
      const ed = vscode.window.activeTextEditor;
      if (ed) lintNow(ed.document);
    }),
  );
}

export function deactivate(): void {
  // Subscriptions are disposed automatically; nothing else to clean up.
}
