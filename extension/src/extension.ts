import * as vscode from "vscode";
import {
  canonicalWorkspacePath,
  createWorkspaceIndex,
  formatSource,
  lintSource,
  lintWorkspace,
  updateWorkspaceIndex,
  type LintSeverity,
  type WorkspaceIndex,
} from "../../dist/index.js";
import { readFormatOptions, readLintOptions } from "./settings.js";

const LANGUAGE_ID = "ffugclanguage";
const EXTENSION_ID = "fc-format.fc-format-v3-vscode";
const SELECTOR: vscode.DocumentSelector = [{ language: LANGUAGE_ID }, { pattern: "**/*.{fcg,fcc}" }];

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("FC Format");
  const lintDiagnostics = vscode.languages.createDiagnosticCollection("fc-lint");
  const pendingLint = new Map<string, ReturnType<typeof setTimeout>>();
  const localDiagnostics = new Map<string, readonly vscode.Diagnostic[]>();
  const workspaceDiagnostics = new Map<string, readonly vscode.Diagnostic[]>();
  const diagnosticUris = new Map<string, vscode.Uri>();
  const renderedPaths = new Set<string>();
  const renderedUris = new Map<string, vscode.Uri>();
  let workspaceIndex: WorkspaceIndex | undefined;
  let workspaceRoot: string | undefined;
  let pendingWorkspaceRefresh: ReturnType<typeof setTimeout> | undefined;
  const workspacePath = (path: string): string => {
    if (workspaceRoot) {
      try { return canonicalWorkspacePath(workspaceRoot, path); } catch { /* keep a stable key for open documents outside the root */ }
    }
    const normalized = path.replaceAll("\\", "/");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  const renderDiagnostics = (): void => {
    const paths = new Set([...localDiagnostics.keys(), ...workspaceDiagnostics.keys()]);
    for (const path of renderedPaths) {
      if (!paths.has(path)) lintDiagnostics.delete(renderedUris.get(path) ?? vscode.Uri.file(path));
    }
    for (const path of paths) {
      const uri = diagnosticUris.get(path) ?? vscode.Uri.file(path);
      lintDiagnostics.set(uri, [...(localDiagnostics.get(path) ?? []), ...(workspaceDiagnostics.get(path) ?? [])]);
    }
    renderedPaths.clear();
    renderedUris.clear();
    for (const path of paths) {
      renderedPaths.add(path);
      renderedUris.set(path, diagnosticUris.get(path) ?? vscode.Uri.file(path));
    }
  };
  const format = (document: vscode.TextDocument): vscode.TextEdit[] => {
    const result = formatSource(document.getText(), { ...readFormatOptions(vscode.workspace.getConfiguration("fcFormat")), fileName: document.fileName });
    if (result.code === undefined) {
      output.appendLine(`${document.uri.toString()}: ${result.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`);
      return [];
    }
    if (result.code === document.getText()) return [];
    return [vscode.TextEdit.replace(fullRange(document), result.code)];
  };
  const formatActiveDocument = async (): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isFcDocument(editor.document)) {
      await vscode.window.showInformationMessage("FC Format: open an .fcg or .fcc document first.");
      return;
    }
    const edits = format(editor.document);
    if (!edits.length) return;
    await editor.edit((builder) => builder.replace(fullRange(editor.document), edits[0]!.newText));
  };
  const lintDocument = (document: vscode.TextDocument): void => {
    if (!isFcDocument(document)) return;
    const settings = vscode.workspace.getConfiguration("fcFormat");
    if (settings.get<boolean>("lint.enabled") === false) {
      localDiagnostics.delete(workspacePath(document.fileName));
      workspaceDiagnostics.clear();
      renderDiagnostics();
      return;
    }
    const result = lintSource(document.getText(), {
      ...readLintOptions(settings),
      fileName: document.fileName,
    });
    const diagnostics = result.diagnostics.map((diagnostic) => {
      const range = new vscode.Range(document.positionAt(diagnostic.range.start.offset), document.positionAt(diagnostic.range.end.offset));
      const item = new vscode.Diagnostic(range, diagnostic.message, diagnosticSeverity(diagnostic.severity));
      item.code = diagnostic.ruleId;
      item.source = "FC Lint";
      return item;
    });
    const key = workspacePath(document.fileName);
    diagnosticUris.set(key, document.uri);
    localDiagnostics.set(key, diagnostics);
    renderDiagnostics();
  };
  const publishWorkspaceDiagnostics = (): void => {
    workspaceDiagnostics.clear();
    const settings = vscode.workspace.getConfiguration("fcFormat");
    if (settings.get<boolean>("lint.enabled") === false || !workspaceIndex) {
      renderDiagnostics();
      return;
    }
    const lintOptions = readLintOptions(settings);
    const result = lintWorkspace(workspaceIndex, {
      rules: lintOptions.rules,
      suppressions: lintOptions.suppressions,
    });
    for (const diagnostic of result.diagnostics) {
      const item = new vscode.Diagnostic(
        new vscode.Range(diagnostic.range.start.line, diagnostic.range.start.column, diagnostic.range.end.line, diagnostic.range.end.column),
        diagnostic.message,
        diagnosticSeverity(diagnostic.severity),
      );
      item.code = diagnostic.ruleId;
      item.source = "FC Lint";
      const key = workspacePath(diagnostic.file);
      const existing = workspaceDiagnostics.get(key) ?? [];
      workspaceDiagnostics.set(key, [...existing, item]);
    }
    renderDiagnostics();
  };
  const rebuildWorkspace = async (): Promise<void> => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      workspaceIndex = undefined;
      workspaceRoot = undefined;
      workspaceDiagnostics.clear();
      diagnosticUris.clear();
      renderDiagnostics();
      return;
    }
    workspaceRoot = folder.uri.fsPath;
    const uris = await vscode.workspace.findFiles("**/*.{fcc,fcg}", "**/{.git,node_modules,dist,coverage}/**");
    const openSources = new Map<string, string>();
    for (const document of vscode.workspace.textDocuments) {
      if (!isFcDocument(document)) continue;
      try { canonicalWorkspacePath(workspaceRoot, document.fileName); } catch { continue; }
      openSources.set(workspacePath(document.fileName), document.getText());
    }
    const sources = [];
    for (const uri of uris) {
      try { canonicalWorkspacePath(workspaceRoot, uri.fsPath); } catch { continue; }
      const key = workspacePath(uri.fsPath);
      diagnosticUris.set(key, uri);
      const text = openSources.get(key) ?? Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
      sources.push({ path: uri.fsPath, source: text });
    }
    for (const [path, source] of openSources) {
      if (!sources.some((candidate) => workspacePath(candidate.path) === path)) sources.push({ path, source });
    }
    workspaceIndex = createWorkspaceIndex(sources, { root: workspaceRoot });
    publishWorkspaceDiagnostics();
  };
  const updateWorkspaceDocument = (document: vscode.TextDocument): void => {
    if (!workspaceIndex || !workspaceRoot) {
      scheduleWorkspaceRefresh();
      return;
    }
    try {
      workspaceIndex = updateWorkspaceIndex(workspaceIndex, [{ path: document.fileName, source: document.getText() }]);
      publishWorkspaceDiagnostics();
    } catch {
      scheduleWorkspaceRefresh();
    }
  };
  const scheduleWorkspaceRefresh = (): void => {
    if (pendingWorkspaceRefresh) clearTimeout(pendingWorkspaceRefresh);
    pendingWorkspaceRefresh = setTimeout(() => {
      pendingWorkspaceRefresh = undefined;
      void rebuildWorkspace();
    }, 200);
  };
  const scheduleLint = (document: vscode.TextDocument): void => {
    const key = document.uri.toString();
    const previous = pendingLint.get(key);
    if (previous) clearTimeout(previous);
    pendingLint.set(key, setTimeout(() => {
      pendingLint.delete(key);
      lintDocument(document);
      updateWorkspaceDocument(document);
    }, 200));
  };

  context.subscriptions.push(
    output,
    lintDiagnostics,
    vscode.languages.registerDocumentFormattingEditProvider(SELECTOR, { provideDocumentFormattingEdits: format }),
    vscode.commands.registerCommand("fcFormat.formatDocument", formatActiveDocument),
    vscode.commands.registerCommand("fcFormat.lintDocument", () => {
      const document = vscode.window.activeTextEditor?.document;
      if (document) lintDocument(document);
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      lintDocument(document);
      scheduleWorkspaceRefresh();
    }),
    vscode.workspace.onDidChangeTextDocument((event) => scheduleLint(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      const pending = pendingLint.get(key);
      if (pending) clearTimeout(pending);
      pendingLint.delete(key);
      localDiagnostics.delete(workspacePath(document.fileName));
      scheduleWorkspaceRefresh();
      renderDiagnostics();
    }),
    vscode.workspace.onDidCreateFiles(() => scheduleWorkspaceRefresh()),
    vscode.workspace.onDidDeleteFiles(() => scheduleWorkspaceRefresh()),
    vscode.workspace.onDidRenameFiles(() => scheduleWorkspaceRefresh()),
  );
  for (const document of vscode.workspace.textDocuments) lintDocument(document);
  void rebuildWorkspace();
  output.appendLine(`FC Format ${EXTENSION_ID} activated.`);
}

export function deactivate(): void {}

function isFcDocument(document: vscode.TextDocument): boolean {
  return document.languageId === LANGUAGE_ID || /\.(?:fcc|fcg)$/iu.test(document.fileName);
}

function fullRange(document: vscode.TextDocument): vscode.Range {
  return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
}

function diagnosticSeverity(severity: LintSeverity): vscode.DiagnosticSeverity {
  if (severity === "error") return vscode.DiagnosticSeverity.Error;
  if (severity === "warning") return vscode.DiagnosticSeverity.Warning;
  if (severity === "information") return vscode.DiagnosticSeverity.Information;
  return vscode.DiagnosticSeverity.Hint;
}
