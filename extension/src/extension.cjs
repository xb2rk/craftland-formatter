"use strict";

const { extname } = require("node:path");

const PREVIEW_SCHEME = "fcfmt-preview";
const DIAGNOSTIC_DELAY_MS = 200;

const OPTION_PATHS = [
  "printWidth",
  "indent.style", "indent.size", "indent.continuation",
  "alignment.collections",
  "endOfLine", "finalNewline", "lineBreaks",
  "wrap.calls", "wrap.parameters", "wrap.collections", "wrap.conditions",
  "spacing.operators", "spacing.assignment", "spacing.comma", "spacing.brackets",
  "imports.sort",
  "blankLines.maxConsecutive", "blankLines.afterImports", "blankLines.betweenMembers"
];

function extractVsCodeSettings(vscode, document) {
  if (!vscode?.workspace?.getConfiguration) return {};
  const vsConfig = vscode.workspace.getConfiguration("fc-format", document?.uri);
  const settings = {};

  for (const path of OPTION_PATHS) {
    const inspect = vsConfig.inspect(path);
    if (inspect && (inspect.globalValue !== undefined || inspect.workspaceValue !== undefined || inspect.workspaceFolderValue !== undefined)) {
      const value = vsConfig.get(path);
      if (value !== undefined && value !== null) {
        settings[path] = value;
      }
    }
  }

  return settings;
}

function extractFallbackIndent(formattingOptions) {
  if (!formattingOptions) return null;
  return {
    style: formattingOptions.insertSpaces ? "space" : "tab",
    size: formattingOptions.tabSize ?? 2,
  };
}

function isFcDocument(document) {
  return document?.uri?.scheme === "file" && /\.(fcg|fcc)$/i.test(document.uri.fsPath);
}

function isSurrogatePair(source, boundary) {
  const before = source.charCodeAt(boundary - 1);
  const after = source.charCodeAt(boundary);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

/** Keep the edit away from unchanged prefixes and suffixes when possible. */
function minimalEdit(document, output, vscode) {
  const original = document.getText();

  if (original === output) {
    return [];
  }

  let start = 0;

  while (start < original.length && start < output.length && original[start] === output[start]) {
    start += 1;
  }

  let oldEnd = original.length;
  let newEnd = output.length;

  while (oldEnd > start && newEnd > start && original[oldEnd - 1] === output[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  // NOTE: VS Code offsets use UTF-16. Never split a CRLF or surrogate pair
  // when a matching prefix or suffix meets only half of that unit.
  if (start > 0 && (original.slice(start - 1, start + 1) === "\r\n" ||
      isSurrogatePair(original, start))) {
    start -= 1;
  }

  if (oldEnd < original.length && (original.slice(oldEnd - 1, oldEnd + 1) === "\r\n" ||
      isSurrogatePair(original, oldEnd))) {
    oldEnd += 1;
    newEnd += 1;
  }

  const range = new vscode.Range(document.positionAt(start), document.positionAt(oldEnd));
  return [vscode.TextEdit.replace(range, output.slice(start, newEnd))];
}

/** VS Code has one EOL mode per document, while the core can preserve mixed bytes. */
function editorEdits(document, output, vscode, { allowEolChange = false } = {}) {
  const replacements = minimalEdit(document, output, vscode);

  if (replacements.length === 0) {
    return { edits: [], error: null, targetEol: null };
  }

  const endings = output.match(/\r\n|\r|\n/g) ?? [];
  const first = endings[0];

  if (first === "\r" || endings.some((ending) => ending !== first)) {
    return {
      edits: [],
      error: "VS Code cannot preserve mixed or CR-only line endings in this file. Use the CLI.",
      targetEol: null,
    };
  }

  const targetEol = first === "\r\n" ? vscode.EndOfLine.CRLF : vscode.EndOfLine.LF;
  const needsEolChange = first && document.eol !== targetEol;

  if (needsEolChange && !allowEolChange) {
    return {
      edits: [],
      error: "Set the document line ending to match project config, then format. The manual FC Format v5 command can convert it.",
      targetEol: null,
    };
  }

  return {
    edits: replacements,
    error: null,
    targetEol: needsEolChange ? targetEol : null,
  };
}

/**
 * Compute range-isolated text edits between document and formatted output.
 *
 * @param {vscode.TextDocument} document
 * @param {string} output - Full-context formatted source.
 * @param {vscode.Range} range - User selected range in editor.
 * @param {typeof import("vscode")} vscode
 * @param {object} core - Formatter core containing computeLineHunks.
 * @returns {vscode.TextEdit[]}
 */
function rangeEdits(document, output, range, vscode, core) {
  const original = document.getText();

  if (original === output || !core?.computeLineHunks) {
    return [];
  }

  const hunks = core.computeLineHunks(original, output);

  if (hunks.length === 0) {
    return [];
  }

  // Expand user selection to whole line bounds
  const selStartLine = range.start.line;
  let selEndLine = range.end.line;

  if (range.end.character === 0 && range.end.line > range.start.line) {
    selEndLine = range.end.line - 1;
  }

  const totalLines = document.lineCount ?? original.split(/\r\n|\r|\n/).length;
  const edits = [];

  for (const hunk of hunks) {
    const hunkOldStart = hunk.oldStartLine;
    const hunkOldEnd = hunk.oldLineCount === 0
      ? hunkOldStart
      : hunkOldStart + hunk.oldLineCount - 1;

    // Check if hunk intersects with user's selected line range
    const intersects = hunk.oldLineCount === 0
      ? (hunkOldStart >= selStartLine && hunkOldStart <= selEndLine + 1)
      : (hunkOldStart <= selEndLine && hunkOldEnd >= selStartLine);

    if (!intersects) {
      continue;
    }

    // Determine the VS Code Range to replace
    let editStart;
    let editEnd;

    if (hunk.oldLineCount === 0) {
      // Pure insertion
      if (hunkOldStart >= totalLines) {
        editStart = document.positionAt(original.length);
        editEnd = editStart;
      } else {
        editStart = new vscode.Position(hunkOldStart, 0);
        editEnd = editStart;
      }
    } else {
      // Replacement or deletion
      editStart = new vscode.Position(hunkOldStart, 0);

      if (hunkOldStart + hunk.oldLineCount >= totalLines) {
        editEnd = document.positionAt(original.length);
      } else {
        editEnd = new vscode.Position(hunkOldStart + hunk.oldLineCount, 0);
      }
    }

    edits.push(vscode.TextEdit.replace(new vscode.Range(editStart, editEnd), hunk.newText));
  }

  return edits;
}

/** Register VS Code UI against the shared core. Exported for host-free tests. */
function createExtension(vscode, core, context, { diagnosticDelayMs = DIAGNOSTIC_DELAY_MS } = {}) {
  const diagnostics = vscode.languages.createDiagnosticCollection("fcfmt-v5");
  const virtualDocuments = new Map();
  const timers = new Map();
  const configCache = new Map();
  let virtualSerial = 0;

  context.subscriptions.push(diagnostics);

  function getResolvedConfig(fsPath, document = null, formattingOptions = null) {
    const fallbackIndent = extractFallbackIndent(formattingOptions);
    const editorSettings = extractVsCodeSettings(vscode, document);
    const cacheKey = fsPath + ":" + (fallbackIndent?.style ?? "") + ":" + (fallbackIndent?.size ?? "") + ":" + Object.keys(editorSettings).length;
    let cached = configCache.get(cacheKey);

    if (!cached) {
      cached = core.resolveConfig(fsPath, { editorSettings, fallbackIndent });
      configCache.set(cacheKey, cached);
    }

    return cached;
  }

  function clearConfigCache() {
    configCache.clear();
  }

  function toDiagnostic(document, issue) {
    const length = document.getText().length;
    const start = Math.max(0, Math.min(issue.start ?? 0, length));
    const end = Math.max(start, Math.min(issue.end ?? start + 1, length));
    const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
    const severity = issue.severity === "warning"
      ? (vscode.DiagnosticSeverity?.Warning ?? 1)
      : issue.severity === "information"
      ? (vscode.DiagnosticSeverity?.Information ?? 2)
      : (vscode.DiagnosticSeverity?.Error ?? 0);
    const diagnostic = new vscode.Diagnostic(range, issue.message, severity);
    diagnostic.source = "FC Format v5";
    diagnostic.code = issue.code ?? "config-error";
    return diagnostic;
  }

  function publish(document, issues) {
    diagnostics.set(document.uri, issues.map((issue) => toDiagnostic(document, issue)));
  }

  function refreshDiagnostics(document) {
    if (!isFcDocument(document) || document.isClosed) {
      diagnostics.delete(document.uri);
      return;
    }

    try {
      const config = getResolvedConfig(document.uri.fsPath, document);

      if (config.ignored) {
        diagnostics.delete(document.uri);
        return;
      }

      const kind = extname(document.uri.fsPath).slice(1).toLowerCase();
      const parseResult = core.parseSource(document.getText(), kind);
      const allIssues = [...parseResult.diagnostics];

      const vsConfig = vscode?.workspace?.getConfiguration ? vscode.workspace.getConfiguration("fc-format", document.uri) : null;
      const linterEnabled = vsConfig?.get("linter.enabled") === true;

      if (linterEnabled && core.lintSource) {
        const lintResult = core.lintSource(document.getText(), {}, document.uri.fsPath);
        if (lintResult?.diagnostics) {
          allIssues.push(...lintResult.diagnostics);
        }
      }

      publish(document, allIssues);
    } catch (error) {
      publish(document, [{ code: "config-error", message: String(error.message ?? error), start: 0 }]);
    }
  }

  function refreshOpenDocuments() {
    clearConfigCache();

    for (const document of vscode.workspace.textDocuments) {
      refreshDiagnostics(document);
    }
  }

  function cancelDiagnostics(document) {
    const key = document.uri.toString();
    const timer = timers.get(key);

    if (timer) {
      clearTimeout(timer);
      timers.delete(key);
    }

    diagnostics.delete(document.uri);
  }

  function scheduleDiagnostics(document) {
    if (!isFcDocument(document)) {
      return;
    }

    const key = document.uri.toString();
    const earlier = timers.get(key);

    if (earlier) {
      clearTimeout(earlier);
    }

    timers.set(key, setTimeout(() => {
      timers.delete(key);
      refreshDiagnostics(document);
    }, diagnosticDelayMs));
  }

  function prepareFormat(document, allowEolChange = false, formattingOptions = null) {
    if (!isFcDocument(document)) {
      return { edits: [], error: null };
    }

    try {
      const config = getResolvedConfig(document.uri.fsPath, document, formattingOptions);
      const activeEol = document.eol === (vscode.EndOfLine?.CRLF ?? 2) ? "crlf" : "lf";
      const effectiveConfig = config.endOfLine === "preserve"
        ? { ...config, endOfLine: activeEol }
        : config;

      const result = core.formatConfiguredSource(document.getText(), document.uri.fsPath, {
        resolvedConfig: effectiveConfig,
      });

      if (result.ignored) {
        diagnostics.delete(document.uri);
        return { edits: [], error: null };
      }

      if (result.output === null) {
        publish(document, result.diagnostics);
        return { edits: [], error: result.diagnostics[0]?.message ?? "Unable to format FC source" };
      }

      const prepared = editorEdits(document, result.output, vscode, { allowEolChange });

      if (prepared.error) {
        publish(document, [{ code: "editor-eol", message: prepared.error, start: 0 }]);
        return prepared;
      }

      diagnostics.delete(document.uri);
      return prepared;
    } catch (error) {
      const message = String(error.message ?? error);
      publish(document, [{ code: "config-error", message, start: 0 }]);
      return { edits: [], error: message };
    }
  }

  function prepareRangeFormat(document, range, formattingOptions = null) {
    if (!isFcDocument(document)) {
      return { edits: [], error: null };
    }

    try {
      const config = getResolvedConfig(document.uri.fsPath, document, formattingOptions);
      const activeEol = document.eol === (vscode.EndOfLine?.CRLF ?? 2) ? "crlf" : "lf";
      const effectiveConfig = config.endOfLine === "preserve"
        ? { ...config, endOfLine: activeEol }
        : config;

      const result = core.formatConfiguredSource(document.getText(), document.uri.fsPath, {
        resolvedConfig: effectiveConfig,
      });

      if (result.ignored) {
        diagnostics.delete(document.uri);
        return { edits: [], error: null };
      }

      if (result.output === null) {
        publish(document, result.diagnostics);
        return { edits: [], error: result.diagnostics[0]?.message ?? "Unable to format FC source" };
      }

      const edits = rangeEdits(document, result.output, range, vscode, core);
      diagnostics.delete(document.uri);
      return { edits, error: null };
    } catch (error) {
      const message = String(error.message ?? error);
      publish(document, [{ code: "config-error", message, start: 0 }]);
      return { edits: [], error: message };
    }
  }

  function activeDocument() {
    const document = vscode.window.activeTextEditor?.document;

    if (!isFcDocument(document)) {
      void vscode.window.showInformationMessage("Open a .fcg or .fcc file first.");
      return null;
    }

    return document;
  }

  function virtualDocument(content, extension) {
    virtualSerial += 1;
    const uri = vscode.Uri.from({
      scheme: PREVIEW_SCHEME,
      path: "/result-" + virtualSerial + "." + extension,
    });
    virtualDocuments.set(uri.toString(), content);
    return uri;
  }

  async function preview() {
    const document = activeDocument();

    if (!document) {
      return;
    }

    try {
      const config = getResolvedConfig(document.uri.fsPath, document);
      const result = core.formatConfiguredSource(document.getText(), document.uri.fsPath, {
        resolvedConfig: config,
      });

      if (result.ignored) {
        void vscode.window.showInformationMessage("FC Format v5: this file is ignored by project config.");
        return;
      }

      if (result.output === null) {
        publish(document, result.diagnostics);
        void vscode.window.showErrorMessage("FC Format v5: " +
          (result.diagnostics[0]?.message ?? "Cannot format file"));
        return;
      }

      const uri = virtualDocument(result.output, extname(document.uri.fsPath).slice(1).toLowerCase());
      await vscode.commands.executeCommand("vscode.diff", document.uri, uri,
        "FC Format v5 Preview", { preview: true });
    } catch (error) {
      void vscode.window.showErrorMessage("FC Format v5: " + String(error.message ?? error));
    }
  }

  async function explainConfig() {
    const document = activeDocument();

    if (!document) {
      return;
    }

    try {
      const config = getResolvedConfig(document.uri.fsPath, document);
      const uri = virtualDocument(JSON.stringify(config, null, 2) + "\n", "json");
      const explanation = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(explanation, { preview: true });
    } catch (error) {
      void vscode.window.showErrorMessage("FC Format v5: " + String(error.message ?? error));
    }
  }

  async function formatCommand() {
    const document = activeDocument();

    if (!document) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    const formattingOptions = editor?.options ? {
      tabSize: typeof editor.options.tabSize === "number" ? editor.options.tabSize : 2,
      insertSpaces: typeof editor.options.insertSpaces === "boolean" ? editor.options.insertSpaces : true,
    } : null;

    const prepared = prepareFormat(document, true, formattingOptions);

    if (prepared.error) {
      void vscode.window.showErrorMessage("FC Format v5: " + prepared.error);
      return;
    }

    const applied = await editor.edit((builder) => {
      if (prepared.targetEol) {
        builder.setEndOfLine(prepared.targetEol);
      }

      for (const edit of prepared.edits) {
        builder.replace(edit.range, edit.newText);
      }
    });

    if (!applied) {
      void vscode.window.showErrorMessage("FC Format v5: VS Code could not apply the formatting edit.");
    }
  }

  async function formatSelectionCommand() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isFcDocument(editor.document)) {
      void vscode.window.showInformationMessage("Open a .fcg or .fcc file with an active selection first.");
      return;
    }

    const document = editor.document;
    const selection = editor.selection;

    if (!selection || selection.isEmpty) {
      await formatCommand();
      return;
    }

    const formattingOptions = editor?.options ? {
      tabSize: typeof editor.options.tabSize === "number" ? editor.options.tabSize : 2,
      insertSpaces: typeof editor.options.insertSpaces === "boolean" ? editor.options.insertSpaces : true,
    } : null;

    const prepared = prepareRangeFormat(document, selection, formattingOptions);

    if (prepared.error) {
      void vscode.window.showErrorMessage("FC Format v5: " + prepared.error);
      return;
    }

    if (prepared.edits.length === 0) {
      return;
    }

    const applied = await editor.edit((builder) => {
      for (const edit of prepared.edits) {
        builder.replace(edit.range, edit.newText);
      }
    });

    if (!applied) {
      void vscode.window.showErrorMessage("FC Format v5: VS Code could not apply range formatting edits.");
    }
  }

  const selector = [
    { scheme: "file", language: "ffugclanguage" },
    { scheme: "file", pattern: "**/*.fcg" },
    { scheme: "file", pattern: "**/*.fcc" },
  ];

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(selector, {
      provideDocumentFormattingEdits(document, options) {
        const prepared = prepareFormat(document, true, options);

        if (prepared.error) {
          return [];
        }

        const edits = [...prepared.edits];

        if (prepared.targetEol && vscode.TextEdit?.setEndOfLine) {
          edits.push(vscode.TextEdit.setEndOfLine(prepared.targetEol));
        }

        return edits;
      },
    }),
    vscode.languages.registerDocumentRangeFormattingEditProvider(selector, {
      provideDocumentRangeFormattingEdits(document, range, options) {
        return prepareRangeFormat(document, range, options).edits;
      },
    }),
    vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, {
      provideTextDocumentContent(uri) {
        return virtualDocuments.get(uri.toString()) ?? "";
      },
    }),
    vscode.commands.registerCommand("fcfmt.preview", preview),
    vscode.commands.registerCommand("fcfmt.explainConfig", explainConfig),
    vscode.commands.registerCommand("fcfmt.formatDocument", formatCommand),
    vscode.commands.registerCommand("fcfmt.formatSelection", formatSelectionCommand),
    vscode.workspace.onDidOpenTextDocument(scheduleDiagnostics),
    vscode.workspace.onDidChangeTextDocument((event) => scheduleDiagnostics(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      cancelDiagnostics(document);

      if (document.uri.scheme === PREVIEW_SCHEME) {
        virtualDocuments.delete(document.uri.toString());
      }
    }),
    { dispose() {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }

      timers.clear();
      virtualDocuments.clear();
      clearConfigCache();
    } },
  );

  const configWatcher = vscode.workspace.createFileSystemWatcher(
    "**/{.fcfmt.json,.fcfmtignore,.editorconfig}");
  context.subscriptions.push(
    configWatcher,
    configWatcher.onDidChange(refreshOpenDocuments),
    configWatcher.onDidCreate(refreshOpenDocuments),
    configWatcher.onDidDelete(refreshOpenDocuments),
  );

  if (vscode.workspace.onDidChangeConfiguration) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("fc-format")) {
          refreshOpenDocuments();
        }
      })
    );
  }

  for (const document of vscode.workspace.textDocuments) {
    scheduleDiagnostics(document);
  }

  return { refreshDiagnostics, clearConfigCache, getResolvedConfig };
}

async function activate(context) {
  const vscode = require("vscode");
  const [service, config, syntax, diff, lint] = await Promise.all([
    import("./core/service.mjs"),
    import("./core/config.mjs"),
    import("./core/syntax/parser.mjs"),
    import("./core/diff.mjs"),
    import("./core/lint/engine.mjs"),
  ]);

  createExtension(vscode, {
    formatConfiguredSource: service.formatConfiguredSource,
    resolveConfig: config.resolveConfig,
    parseSource: syntax.parseSource,
    computeLineHunks: diff.computeLineHunks,
    lintSource: lint.lintSource,
  }, context);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  createExtension,
  minimalEdit,
  editorEdits,
  rangeEdits,
  isFcDocument,
};
