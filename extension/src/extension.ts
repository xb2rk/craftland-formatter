/**
 * @module extension - VS Code glue for fc-format-v2 (format + lint + code actions).
 *
 * Settings/config and range/diagnostic converters live in `./config.js` and
 * `./convert.js` so `activate` stays focused on registrations and debounce.
 */

import * as vscode from "vscode";
import { formatSource, lintSource, type Diagnostic } from "../../dist/index.js";
import { DEBOUNCE_MS, LANGUAGE, STATUS_BAR_PRIORITY, getConfig, isLintEnabled, toLintOptions } from "./config.js";
import { formatEdit, fullRange, toDiagnostic, toRange } from "./convert.js";

/**
 * VS Code extension activation.
 *
 * @param context - extension context.
 */
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("FC Format v2");
  context.subscriptions.push(output);
  const diagnostics = vscode.languages.createDiagnosticCollection("fc-format-v2");
  context.subscriptions.push(diagnostics);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, STATUS_BAR_PRIORITY);
  status.command = "fcFormatV2.formatDocument";
  status.tooltip = "FC Format v2 - click to format";
  context.subscriptions.push(status);

  /**
   * Update the status bar for a document (or the active editor if no doc given).
   *
   * @param doc - optional target document.
   */
  const updateStatus = (doc?: vscode.TextDocument): void => {
    const editor = doc ? undefined : vscode.window.activeTextEditor;
    const target = doc ?? editor?.document;
    if (!target || target.languageId !== LANGUAGE) {
      status.hide();
      return;
    }
    const count = diagnostics.get(target.uri)?.length ?? 0;
    status.text = count ? `$(warning) FC ${count}` : `$(check) FC`;
    status.show();
  };

  /**
   * Run the linter on a document and publish diagnostics.
   *
   * @param document - text document.
   * @param force - whether to ignore the enableLint gate.
   */
  const lint = (document: vscode.TextDocument, force = false): void => {
    if (document.languageId !== LANGUAGE || document.isClosed) {
      if (document.languageId === LANGUAGE) {
        diagnostics.delete(document.uri);
      }
      updateStatus(document);
      return;
    }
    if (!force && !isLintEnabled()) {
      diagnostics.delete(document.uri);
      updateStatus(document);
      return;
    }
    try {
      const cfg = getConfig();
      const diags = lintSource(document.getText(), toLintOptions(cfg));
      diagnostics.set(
        document.uri,
        diags.map((d) => toDiagnostic(document, d)),
      );
    } catch (error) {
      output.appendLine(`[lint] ${String(error)}`);
      diagnostics.set(document.uri, []);
    }
    updateStatus(document);
  };

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  /**
   * Debounce-schedule a lint pass for a document.
   *
   * @param document - text document.
   */
  const schedule = (document: vscode.TextDocument): void => {
    if (document.languageId !== LANGUAGE) {
      return;
    }
    if (!isLintEnabled()) {
      const key = document.uri.toString();
      const prev = timers.get(key);
      if (prev) {
        clearTimeout(prev);
        timers.delete(key);
      }
      diagnostics.delete(document.uri);
      updateStatus(document);
      return;
    }
    const key = document.uri.toString();
    const prev = timers.get(key);
    if (prev) {
      clearTimeout(prev);
    }
    const t = setTimeout(() => {
      timers.delete(key);
      lint(document);
    }, DEBOUNCE_MS);
    timers.set(key, t);
  };
  /**
   * Cancel any pending lint and clear diagnostics for a document.
   *
   * @param document - text document.
   */
  const cancel = (document: vscode.TextDocument): void => {
    const key = document.uri.toString();
    const prev = timers.get(key);
    if (prev) {
      clearTimeout(prev);
      timers.delete(key);
    }
    diagnostics.delete(document.uri);
    updateStatus(document);
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(LANGUAGE, {
      provideDocumentFormattingEdits(document) {
        try {
          return [formatEdit(document)];
        } catch (error) {
          output.appendLine(`[format] ${String(error)}`);
          return [];
        }
      },
    }),
    vscode.languages.registerDocumentRangeFormattingEditProvider(LANGUAGE, {
      provideDocumentRangeFormattingEdits(document, range) {
        // FC is statement-oriented - range is best-effort full-document too (keeps idempotency).
        // If user selects a small range, still format whole file to avoid broken delimiter trees.
        if (range.isEmpty) return [];
        try {
          return [formatEdit(document)];
        } catch (error) {
          output.appendLine(`[format-range] ${String(error)}`);
          return [];
        }
      },
    }),
    vscode.workspace.onDidOpenTextDocument(schedule),
    vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document)),
    vscode.workspace.onDidCloseTextDocument(cancel),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) schedule(editor.document);
      updateStatus(editor?.document);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("fcFormatV2") && !event.affectsConfiguration("editor.defaultFormatter")) {
        return;
      }
      output.appendLine("[config] fcFormatV2 changed - re-linting open documents");
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.languageId === LANGUAGE) {
          schedule(doc);
        }
      }
    }),
    vscode.commands.registerCommand("fcFormatV2.formatDocument", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.languageId !== LANGUAGE) {
        void vscode.window.showInformationMessage("FC Format v2: active editor is not .fcg/.fcc");
        return;
      }
      try {
        void editor.edit((builder) => builder.replace(fullRange(editor.document), formatSource(editor.document.getText(), getConfig())));
      } catch (error) {
        output.appendLine(`[command:format] ${String(error)}`);
        void vscode.window.showErrorMessage(`FC Format v2: format failed - ${String(error)}`);
      }
    }),
    vscode.commands.registerCommand("fcFormatV2.lintDocument", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        lint(editor.document, true);
      }
    }),
    vscode.commands.registerCommand("fcFormatV2.fixAll", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.languageId !== LANGUAGE) {
        return;
      }
      const doc = editor.document;
      try {
        const cfg = getConfig();
        const fixes = lintSource(doc.getText(), toLintOptions(cfg)).filter((d) => d.fix);
        if (!fixes.length) {
          // Fall back to full format (covers whitespace/blank-line rules the linter does not fix).
          await editor.edit((b) => b.replace(fullRange(doc), formatSource(doc.getText(), cfg)));
          return;
        }
        // Apply lint fixes bottom-up to keep offsets stable, then format for whitespace convergence.
        const edit = new vscode.WorkspaceEdit();
        const sorted = [...fixes].sort((a, b) => (b.fix!.start - a.fix!.start));
        for (const item of sorted) {
          const f = item.fix!;
          edit.replace(doc.uri, new vscode.Range(doc.positionAt(f.start), doc.positionAt(f.end)), f.replacement);
        }
        await vscode.workspace.applyEdit(edit);
        // Second pass: formatter converges style (e.g. trailingComma, wrap) that lint only reports.
        const after = doc.getText();
        const formatted = formatSource(after, cfg);
        if (formatted !== after) {
          await editor.edit((b) => b.replace(fullRange(doc), formatted));
        }
      } catch (error) {
        output.appendLine(`[command:fixAll] ${String(error)}`);
        void vscode.window.showErrorMessage(`FC Format v2: fixAll failed - ${String(error)}`);
      }
    }),
    vscode.languages.registerCodeActionsProvider(
      LANGUAGE,
      {
        provideCodeActions(document, _range, context) {
          const actions: vscode.CodeAction[] = [];
          // Reuse one lint pass for all diagnostics in this invocation (was N lintSource calls before).
          let lintOnce: Diagnostic[] | undefined;
          const getLint = (): Diagnostic[] => (lintOnce ??= lintSource(document.getText(), toLintOptions(getConfig())));
          for (const diagnostic of context.diagnostics) {
            if (diagnostic.source !== "fc-format-v2") {
              continue;
            }
            const source = getLint().find((item) => item.ruleId === diagnostic.code && item.fix);
            if (!source?.fix) {
              continue;
            }
            const action = new vscode.CodeAction(`FC: fix ${source.ruleId}`, vscode.CodeActionKind.QuickFix);
            action.diagnostics = [diagnostic];
            action.isPreferred = true;
            action.edit = new vscode.WorkspaceEdit();
            action.edit.replace(document.uri, new vscode.Range(document.positionAt(source.fix.start), document.positionAt(source.fix.end)), source.fix.replacement);
            actions.push(action);
          }
          const all = new vscode.CodeAction("FC: fix all auto-fixable", vscode.CodeActionKind.SourceFixAll);
          all.command = { command: "fcFormatV2.fixAll", title: "FC: fix all auto-fixable" };
          actions.push(all);
          const fmt = new vscode.CodeAction("FC: format document", vscode.CodeActionKind.SourceFixAll);
          fmt.edit = new vscode.WorkspaceEdit();
          try {
            fmt.edit.replace(document.uri, fullRange(document), formatSource(document.getText(), getConfig()));
          } catch { /* ignore - no edit if format fails */ }
          actions.push(fmt);
          return actions;
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.SourceFixAll] },
    ),
  );
  vscode.workspace.textDocuments.forEach(schedule);
  updateStatus();
}

/**
 * VS Code extension deactivation (no-op; disposables are owned by the context).
 */
export function deactivate(): void {}
