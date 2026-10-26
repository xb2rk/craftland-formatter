"use strict";

const { extname } = require("node:path");

const PREVIEW_SCHEME = "fcfmt-preview";
const DIAGNOSTIC_DELAY_MS = 200;

const OPTION_PATHS = [
  "printWidth",
  "indent.style", "indent.size", "indent.continuation",
  "alignment.collections", "alignment.enums", "alignment.fields",
  "endOfLine", "finalNewline", "lineBreaks",
  "wrap.calls", "wrap.parameters", "wrap.collections", "wrap.conditions",
  "spacing.operators", "spacing.assignment", "spacing.comma", "spacing.brackets",
  "imports.sort",
  "blankLines.maxConsecutive", "blankLines.afterImports", "blankLines.betweenMembers", "blankLines.betweenFunctions",
  "syntax.canonicalHeaders"
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

/** Convert a core SymbolNode to a VS Code DocumentSymbol with hierarchy. */
function toVsCodeSymbol(symbol, vscode) {
  const kindMap = {
    Graph: vscode.SymbolKind?.Class ?? 4,
    Function: vscode.SymbolKind?.Function ?? 11,
    EventListener: vscode.SymbolKind?.Event ?? 23,
    Property: vscode.SymbolKind?.Field ?? 7,
    Enum: vscode.SymbolKind?.Enum ?? 9,
    EnumMember: vscode.SymbolKind?.EnumMember ?? 21,
    Tuple: vscode.SymbolKind?.Struct ?? 22,
    Component: vscode.SymbolKind?.Interface ?? 10,
    Define: vscode.SymbolKind?.Constant ?? 13,
    Alias: vscode.SymbolKind?.TypeParameter ?? 25,
    Import: vscode.SymbolKind?.Module ?? 1,
  };

  const range = new vscode.Range(
    new vscode.Position(Math.max(0, (symbol.range?.line ?? 1) - 1), Math.max(0, symbol.range?.column ?? 0)),
    new vscode.Position(Math.max(0, (symbol.range?.endLine ?? 1) - 1), Math.max(0, symbol.range?.endColumn ?? 0))
  );

  const selectionRange = new vscode.Range(
    new vscode.Position(Math.max(0, (symbol.selectionRange?.line ?? 1) - 1), Math.max(0, symbol.selectionRange?.column ?? 0)),
    new vscode.Position(Math.max(0, (symbol.selectionRange?.endLine ?? 1) - 1), Math.max(0, symbol.selectionRange?.endColumn ?? 0))
  );

  const vsSymbol = new vscode.DocumentSymbol(
    symbol.name,
    symbol.detail ?? "",
    kindMap[symbol.kind] ?? (vscode.SymbolKind?.Variable ?? 12),
    range,
    selectionRange
  );

  if (symbol.children && symbol.children.length > 0) {
    vsSymbol.children = symbol.children.map((child) => toVsCodeSymbol(child, vscode));
  }

  return vsSymbol;
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

  function prepareOrganizeImports(document) {
    if (!isFcDocument(document)) {
      return { edits: [] };
    }

    const source = document.getText();
    const kind = extname(document.uri.fsPath).slice(1).toLowerCase();
    const parsed = core.parseSource(source, kind);

    if (!parsed?.tree || parsed.diagnostics?.length) {
      return { edits: [], error: "Cannot organize imports: document has syntax errors." };
    }

    const eol = document.eol === (vscode.EndOfLine?.CRLF ?? 2) ? "\r\n" : "\n";
    const organized = core.organizeImports ? core.organizeImports(source, parsed.tree, [], eol) : source;

    if (organized === source) {
      return { edits: [] };
    }

    const edits = minimalEdit(document, organized, vscode);
    return { edits };
  }

  async function organizeImportsCommand() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isFcDocument(editor.document)) {
      void vscode.window.showInformationMessage("Open a .fcg or .fcc file first.");
      return;
    }

    const prepared = prepareOrganizeImports(editor.document);
    if (prepared.error) {
      void vscode.window.showErrorMessage("FC Format v5: " + prepared.error);
      return;
    }

    if (prepared.edits.length === 0) {
      return;
    }

    await editor.edit((builder) => {
      for (const edit of prepared.edits) {
        builder.replace(edit.range, edit.newText);
      }
    });
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
    vscode.languages.registerCodeActionsProvider(selector, {
      provideCodeActions(document, range, codeActionContext) {
        const hasOrganizeRequest = !codeActionContext.only ||
          (codeActionContext.only.contains && codeActionContext.only.contains(vscode.CodeActionKind.SourceOrganizeImports));

        if (!hasOrganizeRequest) {
          return [];
        }

        const prepared = prepareOrganizeImports(document);
        if (prepared.edits.length === 0) {
          return [];
        }

        const action = new vscode.CodeAction("Organize FC Imports", vscode.CodeActionKind.SourceOrganizeImports);
        action.edit = new vscode.WorkspaceEdit();
        for (const edit of prepared.edits) {
          action.edit.replace(document.uri, edit.range, edit.newText);
        }

        return [action];
      },
    }, {
      providedCodeActionKinds: [vscode.CodeActionKind.SourceOrganizeImports],
    }),
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols(document) {
        if (!isFcDocument(document) || !core?.getFileIndex) return [];
        const index = core.getFileIndex(document.uri.fsPath, document.getText());
        if (!index || !index.symbols) return [];
        return index.symbols.map((sym) => toVsCodeSymbol(sym, vscode));
      },
    }),
    vscode.languages.registerCompletionItemProvider(selector, {
      provideCompletionItems(document, position) {
        if (!isFcDocument(document)) return [];

        const lineText = document.lineAt(position).text;
        const linePrefix = lineText.slice(0, position.character);

        // Pattern 1: Dot-access: <Target>.<Prefix> (e.g. "GridMath.Get" or "GridMath.")
        const dotMatch = linePrefix.match(/([A-Za-z0-9_]+)\.([A-Za-z0-9_]*)$/);
        let items = [];

        if (dotMatch && core?.getMemberCompletions) {
          const target = dotMatch[1];
          const prefix = dotMatch[2] ?? "";
          items = core.getMemberCompletions(document.uri.fsPath, document.getText(), target, prefix);
        } else if (core?.getLocalCompletions) {
          // Pattern 2: Identifier word mid-way: e.g. "FooB" or "Get"
          const wordMatch = linePrefix.match(/([A-Za-z0-9_]+)$/);
          if (wordMatch) {
            const prefix = wordMatch[1];
            items = core.getLocalCompletions(document.uri.fsPath, document.getText(), prefix);
          }
        }

        if (!items || items.length === 0) {
          return [];
        }

        const kindMap = {
          Function: vscode.CompletionItemKind?.Method ?? 1,
          EventListener: vscode.CompletionItemKind?.Event ?? 24,
          Property: vscode.CompletionItemKind?.Field ?? 4,
          Enum: vscode.CompletionItemKind?.Enum ?? 12,
          EnumMember: vscode.CompletionItemKind?.EnumMember ?? 19,
          Tuple: vscode.CompletionItemKind?.Struct ?? 21,
          Component: vscode.CompletionItemKind?.Interface ?? 7,
          Define: vscode.CompletionItemKind?.Constant ?? 20,
          Alias: vscode.CompletionItemKind?.TypeParameter ?? 24,
          Import: vscode.CompletionItemKind?.Module ?? 8,
        };

        return items.map((desc, idx) => {
          const item = new vscode.CompletionItem(
            desc.label,
            kindMap[desc.kind] ?? (vscode.CompletionItemKind?.Variable ?? 5)
          );
          item.detail = desc.detail;
          if (desc.docComment && vscode.MarkdownString) {
            item.documentation = new vscode.MarkdownString(desc.docComment);
          }
          if (desc.insertSnippet && vscode.SnippetString) {
            item.insertText = new vscode.SnippetString(desc.insertSnippet);
          } else if (desc.insertSnippet) {
            item.insertText = desc.insertSnippet.replace(/\$\d+/g, "");
          }
          // Automatically trigger parameter hints when function completion is accepted
          if (desc.kind === "Function") {
            item.command = {
              command: "editor.action.triggerParameterHints",
              title: "Trigger Parameter Hints",
            };
          }
          // Prioritize above extension goc keywords with sortText
          item.sortText = "00_" + idx.toString().padStart(4, "0");
          return item;
        });
      },
    }, "."),
    vscode.languages.registerDocumentLinkProvider(selector, {
      provideDocumentLinks(document) {
        if (!isFcDocument(document) || !core?.getDocumentLinks) return [];
        const links = core.getDocumentLinks(document.uri.fsPath, document.getText());
        return links.map((l) => {
          const range = new vscode.Range(
            new vscode.Position(Math.max(0, (l.range?.line ?? 1) - 1), Math.max(0, (l.range?.column ?? 0) + 1)),
            new vscode.Position(Math.max(0, (l.range?.endLine ?? 1) - 1), Math.max(0, (l.range?.endColumn ?? 0) - 1))
          );
          const targetUri = vscode.Uri?.file ? vscode.Uri.file(l.targetFilePath) : { fsPath: l.targetFilePath };
          const docLink = new vscode.DocumentLink(range, targetUri);
          docLink.tooltip = "Follow link (Ctrl + Click)";
          return docLink;
        });
      },
    }),
    vscode.languages.registerFoldingRangeProvider(selector, {
      provideFoldingRanges(document) {
        if (!isFcDocument(document) || !core?.getFoldingRanges) return [];
        const ranges = core.getFoldingRanges(document.uri.fsPath, document.getText());
        return ranges.map((r) => {
          const kind = r.kind === "imports"
            ? (vscode.FoldingRangeKind?.Imports ?? 1)
            : r.kind === "comment"
            ? (vscode.FoldingRangeKind?.Comment ?? 2)
            : undefined;
          return new vscode.FoldingRange(r.startLine, r.endLine, kind);
        });
      },
    }),
    vscode.languages.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols(query) {
        if (!core?.searchWorkspaceSymbols || !query || query.trim().length === 0) return [];
        const workspaceRoot = vscode.workspace?.workspaceFolders?.[0]?.uri?.fsPath ?? "";
        if (!workspaceRoot) return [];

        const results = core.searchWorkspaceSymbols(workspaceRoot, query);
        const kindMap = {
          Graph: vscode.SymbolKind?.Class ?? 4,
          Function: vscode.SymbolKind?.Function ?? 11,
          EventListener: vscode.SymbolKind?.Event ?? 23,
          Property: vscode.SymbolKind?.Field ?? 7,
          Enum: vscode.SymbolKind?.Enum ?? 9,
          EnumMember: vscode.SymbolKind?.EnumMember ?? 21,
          Tuple: vscode.SymbolKind?.Struct ?? 22,
          Component: vscode.SymbolKind?.Interface ?? 10,
          Define: vscode.SymbolKind?.Constant ?? 13,
          Alias: vscode.SymbolKind?.TypeParameter ?? 25,
          Import: vscode.SymbolKind?.Module ?? 1,
        };

        return results.map((r) => {
          const range = new vscode.Range(
            new vscode.Position(Math.max(0, (r.range?.line ?? 1) - 1), Math.max(0, r.range?.column ?? 0)),
            new vscode.Position(Math.max(0, (r.range?.endLine ?? 1) - 1), Math.max(0, r.range?.endColumn ?? 0))
          );
          const targetUri = vscode.Uri?.file ? vscode.Uri.file(r.filePath) : { fsPath: r.filePath };
          const location = new vscode.Location(targetUri, range);
          return new vscode.SymbolInformation(
            r.name,
            kindMap[r.kind] ?? (vscode.SymbolKind?.Variable ?? 12),
            r.containerName,
            location
          );
        });
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
    vscode.commands.registerCommand("fcfmt.organizeImports", organizeImportsCommand),
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
      core?.clearIndexCache?.();
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
  const [service, config, syntax, diff, lint, imports, symbols, indexer] = await Promise.all([
    import("./core/service.mjs"),
    import("./core/config.mjs"),
    import("./core/syntax/parser.mjs"),
    import("./core/diff.mjs"),
    import("./core/lint/engine.mjs"),
    import("./core/imports.mjs"),
    import("./core/symbols/extractor.mjs"),
    import("./core/symbols/indexer.mjs"),
  ]);

  createExtension(vscode, {
    formatConfiguredSource: service.formatConfiguredSource,
    resolveConfig: config.resolveConfig,
    parseSource: syntax.parseSource,
    computeLineHunks: diff.computeLineHunks,
    lintSource: lint.lintSource,
    organizeImports: imports.organizeImports,
    extractSymbols: symbols.extractSymbols,
    getFileIndex: indexer.getFileIndex,
    getMemberCompletions: indexer.getMemberCompletions,
    getLocalCompletions: indexer.getLocalCompletions,
    findDefinition: indexer.findDefinition,
    clearIndexCache: indexer.clearIndexCache,
    getFoldingRanges: indexer.getFoldingRanges,
    getDocumentLinks: indexer.getDocumentLinks,
    getSignatureHelp: indexer.getSignatureHelp,
    searchWorkspaceSymbols: indexer.searchWorkspaceSymbols,
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
