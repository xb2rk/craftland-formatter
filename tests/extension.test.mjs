import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { copyExtensionRuntime } from "../scripts/build-extension.mjs";
import { resolveConfig } from "../src/config.mjs";
import { computeLineHunks } from "../src/diff.mjs";
import { formatConfiguredSource } from "../src/service.mjs";
import { parseSource } from "../src/syntax/parser.mjs";

const require = createRequire(import.meta.url);
const { createExtension, editorEdits, minimalEdit, rangeEdits } = require("../extension/src/extension.cjs");
const cliScript = fileURLToPath(new URL("../scripts/fcfmt.mjs", import.meta.url));
const extensionPackage = JSON.parse(fs.readFileSync(
  fileURLToPath(new URL("../extension/package.json", import.meta.url)), "utf8"));
const compact = 'import "StdLibrary.fcc" as StdLibrary\ngraph Demo{func Noop(){}}';

async function fixture(callback) {
  const directory = fs.mkdtempSync(join(tmpdir(), "fcfmt-v5-editor-"));

  try {
    fs.mkdirSync(join(directory, ".git"));
    return await callback(directory);
  } finally {
    const absolute = resolve(directory);
    assert.ok(absolute.startsWith(resolve(tmpdir()) + sep));
    assert.ok(basename(absolute).startsWith("fcfmt-v5-editor-"));
    fs.rmSync(absolute, { recursive: true, force: true });
  }
}

function documentAt(path, source = compact) {
  const uri = {
    scheme: "file",
    fsPath: path,
    toString() { return "file:" + path; },
  };

  const getLineOffsets = (text) => {
    const offsets = [0];
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === "\n") {
        offsets.push(index + 1);
      }
    }
    return offsets;
  };

  return {
    uri,
    text: source,
    isClosed: false,
    eol: source.includes("\r\n") ? 2 : 1,
    getText() { return this.text; },
    get lineCount() {
      return this.getText().split(/\r\n|\r|\n/).length;
    },
    positionAt(offset) {
      const offsets = getLineOffsets(this.getText());
      let line = 0;
      while (line + 1 < offsets.length && offsets[line + 1] <= offset) {
        line += 1;
      }
      return { line, character: offset - offsets[line], offset };
    },
    offsetAt(position) {
      if (typeof position.offset === "number") {
        return position.offset;
      }
      const offsets = getLineOffsets(this.getText());
      const line = Math.min(position.line ?? 0, offsets.length - 1);
      return Math.min(this.getText().length, offsets[line] + (position.character ?? 0));
    },
  };
}

function applyEdits(source, edits, document = null) {
  let result = source;
  const sorted = [...edits].filter((item) => item.range).sort((a, b) => {
    const offsetA = document?.offsetAt?.(a.range.start) ?? a.range.start.offset ?? 0;
    const offsetB = document?.offsetAt?.(b.range.start) ?? b.range.start.offset ?? 0;
    return offsetB - offsetA;
  });

  for (const edit of sorted) {
    const start = document?.offsetAt?.(edit.range.start) ?? edit.range.start.offset ?? 0;
    const end = document?.offsetAt?.(edit.range.end) ?? edit.range.end.offset ?? start;
    result = result.slice(0, start) + edit.newText + result.slice(end);
  }

  const eol = edits.find((item) => item.newEol)?.newEol;

  if (eol) {
    result = result.replace(/\r\n|\r|\n/g, eol === 2 ? "\r\n" : "\n");
  }

  return result;
}

function fakeVscode(document, customCore = null) {
  const state = {
    commands: new Map(),
    diagnostics: new Map(),
    contentProvider: null,
    formattingProvider: null,
    rangeFormattingProvider: null,
    diff: null,
    shown: null,
    errors: [],
  };
  const disposable = () => ({ dispose() {} });
  const uriKey = (uri) => uri.toString();
  const vscode = {
    Position: class {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    Range: class {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    Diagnostic: class {
      constructor(range, message, severity) {
        Object.assign(this, { range, message, severity });
      }
    },
    DiagnosticSeverity: { Error: 0 },
    EndOfLine: { LF: 1, CRLF: 2 },
    TextEdit: {
      replace(range, newText) { return { range, newText }; },
      setEndOfLine(newEol) { return { newEol }; },
    },
    Uri: {
      from(parts) {
        return {
          ...parts,
          toString() { return parts.scheme + ":" + parts.path; },
        };
      },
    },
    languages: {
      createDiagnosticCollection() {
        return {
          set(uri, entries) { state.diagnostics.set(uriKey(uri), entries); },
          delete(uri) { state.diagnostics.delete(uriKey(uri)); },
          dispose() { state.diagnostics.clear(); },
        };
      },
      registerDocumentFormattingEditProvider(selector, provider) {
        state.selector = selector;
        state.formattingProvider = provider;
        return disposable();
      },
      registerDocumentRangeFormattingEditProvider(selector, provider) {
        state.rangeSelector = selector;
        state.rangeFormattingProvider = provider;
        return disposable();
      },
    },
    workspace: {
      textDocuments: [document],
      registerTextDocumentContentProvider(scheme, provider) {
        state.contentScheme = scheme;
        state.contentProvider = provider;
        return disposable();
      },
      onDidOpenTextDocument(callback) { state.onOpen = callback; return disposable(); },
      onDidChangeTextDocument(callback) { state.onChange = callback; return disposable(); },
      onDidCloseTextDocument(callback) { state.onClose = callback; return disposable(); },
      onDidChangeConfiguration(callback) { state.onConfigurationChange = callback; return disposable(); },
      getConfiguration(section) {
        return {
          get(key) { return state.configuration?.[key]; },
          inspect(key) {
            const val = state.configuration?.[key];
            return val !== undefined ? { globalValue: val } : undefined;
          },
        };
      },
      createFileSystemWatcher() {
        return {
          onDidChange(callback) { state.onConfigChange = callback; return disposable(); },
          onDidCreate(callback) { state.onConfigCreate = callback; return disposable(); },
          onDidDelete(callback) { state.onConfigDelete = callback; return disposable(); },
          dispose() {},
        };
      },
      async openTextDocument(uri) {
        return { uri, getText: () => state.contentProvider.provideTextDocumentContent(uri) };
      },
    },
    commands: {
      registerCommand(name, callback) {
        state.commands.set(name, callback);
        return disposable();
      },
      async executeCommand(...args) { state.diff = args; },
    },
    window: {
      activeTextEditor: {
        document,
        async edit(callback) {
          const edits = [];
          callback({
            replace(range, newText) { edits.push({ range, newText }); },
            setEndOfLine(newEol) { edits.push({ newEol }); },
          });
          document.text = applyEdits(document.text, edits, document);
          const eol = edits.find((item) => item.newEol)?.newEol;

          if (eol) {
            document.eol = eol;
          }

          return true;
        },
      },
      showInformationMessage() {},
      showErrorMessage(message) { state.errors.push(message); },
      async showTextDocument(shown) { state.shown = shown; },
    },
  };
  const context = { subscriptions: [] };
  const core = customCore ?? { formatConfiguredSource, resolveConfig, parseSource, computeLineHunks };
  const instance = createExtension(vscode, core, context, { diagnosticDelayMs: 10 });

  return {
    state,
    vscode,
    instance,
    dispose() {
      for (const entry of context.subscriptions) {
        entry.dispose?.();
      }
    },
  };
}

test("extension build copies runtime, schema and user docs without the development grammar", () => fixture(async (directory) => {
  const target = join(directory, "dist");
  const files = copyExtensionRuntime(target);

  assert.equal(files.length, 31);
  assert.equal(fs.existsSync(join(target, "core", "diff.mjs")), true);
  assert.equal(fs.existsSync(join(target, "core", "cache.mjs")), true);
  assert.equal(fs.existsSync(join(target, "core", "layout", "collection-alignment.mjs")), true);
  assert.equal(fs.existsSync(join(target, "core", "layout", "logical-chain.mjs")), true);
  assert.equal(fs.readFileSync(join(target, "fcfmt.schema.json"), "utf8"),
    fs.readFileSync(new URL("../schema.json", import.meta.url), "utf8"));
  assert.deepEqual(extensionPackage.contributes.jsonValidation,
    [{ fileMatch: ".fcfmt.json", url: "./dist/fcfmt.schema.json" }]);
  assert.equal(fs.existsSync(join(target, "docs", "STYLE_GUIDE.md")), true);
  assert.equal(fs.existsSync(join(target, "docs", "TROUBLESHOOTING.md")), true);
  assert.equal(fs.existsSync(join(target, "docs", "CHANGELOG.md")), true);
  assert.equal(files.some((file) => file.includes("grammar") || file.includes("oracle")), false);
  assert.equal(fs.existsSync(join(target, "core", "grammar")), false);
  assert.equal(fs.existsSync(join(target, "core", "cli.mjs")), false);

  const packed = await import(pathToFileURL(join(target, "core", "service.mjs")).href);
  const file = join(directory, "Demo.fcg");
  assert.equal(packed.formatConfiguredSource(compact, file).output,
    formatConfiguredSource(compact, file).output);

  const builtAdapter = require(join(target, "extension.cjs"));
  assert.equal(typeof builtAdapter.activate, "function");
  assert.equal(extensionPackage.main, "./dist/extension.cjs");
}));

test("editor provider and CLI use identical config and output for unsaved text", () => fixture(async (directory) => {
  const file = join(directory, "Demo.fcg");
  fs.writeFileSync(file, "older disk contents");
  fs.writeFileSync(join(directory, ".editorconfig"),
    "root = true\n[*]\nindent_size = 3\nend_of_line = crlf\n");
  fs.writeFileSync(join(directory, ".fcfmt.json"), JSON.stringify({
    indent: { size: 4 },
    overrides: [{ files: "*.fcg", options: { printWidth: 80 } }],
  }));

  const document = documentAt(file);
  document.text = document.text.replace(/\n/g, "\r\n");
  document.eol = 2;
  const editor = fakeVscode(document);

  try {
    const edits = editor.state.formattingProvider.provideDocumentFormattingEdits(document);
    const fromEditor = applyEdits(document.getText(), edits);
    const fromCli = spawnSync(process.execPath, [cliScript, "--stdin-filepath", file], {
      input: document.getText(), encoding: "utf8",
    });
    const explained = spawnSync(process.execPath, [cliScript, "--explain-config", file], {
      encoding: "utf8",
    });

    assert.equal(fromCli.status, 0, fromCli.stderr);
    assert.equal(explained.status, 0, explained.stderr);
    assert.equal(fromEditor, fromCli.stdout);
    assert.equal(fromEditor, formatConfiguredSource(document.getText(), file).output);
    assert.deepEqual(JSON.parse(explained.stdout).provenance, resolveConfig(file).provenance);
    assert.equal(fs.readFileSync(file, "utf8"), "older disk contents");
    assert.equal(editor.state.selector.some((item) => item.language === "ffugclanguage"), true);
    assert.equal(extensionPackage.contributes.commands.length, 4);
  } finally {
    editor.dispose();
  }
}));

test("format command, preview and config explanation use the current buffer without disk writes", () => fixture(async (directory) => {
  const file = join(directory, "Demo.fcg");
  fs.writeFileSync(file, "older disk contents");
  const document = documentAt(file);
  const editor = fakeVscode(document);

  try {
    await editor.state.commands.get("fcfmt.preview")();
    const previewUri = editor.state.diff[2];
    const preview = editor.state.contentProvider.provideTextDocumentContent(previewUri);
    assert.equal(preview, formatConfiguredSource(compact, file).output);
    assert.equal(editor.state.diff[0], "vscode.diff");

    await editor.state.commands.get("fcfmt.explainConfig")();
    const explained = JSON.parse(editor.state.shown.getText());
    assert.deepEqual(explained.options, resolveConfig(file).options);
    assert.equal(explained.file, resolve(file));

    await editor.state.commands.get("fcfmt.formatDocument")();
    assert.equal(document.getText(), preview);
    assert.equal(fs.readFileSync(file, "utf8"), "older disk contents");
    assert.equal(editor.state.errors.length, 0);
  } finally {
    editor.dispose();
  }
}));

test("editor shares collection alignment and logical continuation settings with the CLI", () => fixture(async (directory) => {
  const file = join(directory, "Demo.fcg");
  const input = compact.replace("func Noop(){}", "func Noop(){\n" +
    "var values = Map<int, int>{1:2,123:4}\nvar valid = a && (b || c)\n}");
  const document = documentAt(file, input);
  const editor = fakeVscode(document);

  try {
    for (const alignment of [true, false]) {
      fs.writeFileSync(join(directory, ".fcfmt.json"), JSON.stringify({
        indent: { continuation: 2 }, alignment: { collections: alignment },
        wrap: { collections: "always", conditions: "always" },
      }));
      editor.state.onConfigChange();
      const edits = editor.state.formattingProvider.provideDocumentFormattingEdits(document);
      const output = applyEdits(input, edits);
      const fromCli = spawnSync(process.execPath, [cliScript, "--stdin-filepath", file], {
        input, encoding: "utf8",
      });
      assert.equal(fromCli.status, 0, fromCli.stderr);
      assert.equal(output, fromCli.stdout);
      assert.ok(output.includes(alignment ? "      1  : 2," : "      1: 2,"));
      assert.ok(output.includes("    var valid = a &&\n        (b ||\n            c)"));
      assert.equal(document.getText(), input);
    }
  } finally {
    editor.dispose();
  }
}));

test("editor P1 options, comments and pragmas agree with CLI output", () => fixture(async (directory) => {
  const file = join(directory, "Demo.fcg");
  const preserved = ' // fc-format-ignore\n  var untouched=1 + 2';
  const input = 'import "Z.fcc" as Z\nimport "A.fcc" as A\ngraph Demo{func Run(){\n' +
    preserved + '\nvar values=Map<int,int>{\n// note\n1:2,123:4,\n}\nvar vector=Vector3{1,2,3}\n}}';
  fs.writeFileSync(join(directory, ".fcfmt.json"), JSON.stringify({
    imports: { sort: true }, spacing: { operators: "compact", brackets: "spaced" },
  }));
  const document = documentAt(file, input);
  const editor = fakeVscode(document);
  try {
    const edits = editor.state.formattingProvider.provideDocumentFormattingEdits(document);
    const output = applyEdits(input, edits);
    const fromCli = spawnSync(process.execPath, [cliScript, "--stdin-filepath", file], { input, encoding: "utf8" });
    assert.equal(fromCli.status, 0, fromCli.stderr);
    assert.equal(output, fromCli.stdout);
    assert.ok(output.startsWith('import "A.fcc" as A'));
    assert.ok(output.includes(preserved));
    assert.ok(output.includes('var vector=Vector3{ 1, 2, 3 }'));
    assert.ok(output.includes('      // note\n      1  : 2,'));
    assert.equal(document.getText(), input);
    document.text = input.replace('var vector=Vector3{1,2,3}', 'var vector=[1,2]');
    editor.instance.refreshDiagnostics(document);
    assert.deepEqual(editor.state.formattingProvider.provideDocumentFormattingEdits(document), []);
    assert.ok(editor.state.diagnostics.get(document.uri.toString()).length);
  } finally { editor.dispose(); }
}));

test("editor preserves parameters and collection sections while wrapping long expressions like CLI", () => fixture(async (directory) => {
  const file = join(directory, 'Demo.fcg');
  const input = 'import "StdLibrary.fcc" as StdLibrary\ngraph Demo {\n' +
    'func Long(firstVeryLongParameter int, secondVeryLongParameter int) {}\n' +
    'func Run( first int,\nsecond int) {\n' +
    'var values=Map<int,int>{1:2,\n\n// section\n123:4,}\n' +
    'LogInfo("first lengthy message=" + firstValue + " second=" + ToString(GetActiveCount(key)))\n}\n}';
  fs.writeFileSync(file, 'older disk contents');
  fs.writeFileSync(join(directory, '.fcfmt.json'), JSON.stringify({ printWidth: 65 }));
  const document = documentAt(file, input);
  const editor = fakeVscode(document);
  try {
    const edits = editor.state.formattingProvider.provideDocumentFormattingEdits(document);
    const output = applyEdits(input, edits);
    const fromCli = spawnSync(process.execPath, [cliScript, '--stdin-filepath', file], { input, encoding: 'utf8' });
    assert.equal(fromCli.status, 0, fromCli.stderr);
    assert.equal(output, fromCli.stdout);
    assert.ok(output.includes('func Long(firstVeryLongParameter int, secondVeryLongParameter int) {}'));
    assert.ok(output.includes('func Run(first int,\n    second int)'));
    assert.ok(output.includes('1  : 2,\n\n      // section\n      123: 4,'));
    assert.ok(output.includes('"first lengthy message=" +\n        firstValue +'));
    assert.ok(output.includes('ToString(GetActiveCount(key))'));
    assert.equal(document.getText(), input);
    assert.equal(fs.readFileSync(file, 'utf8'), 'older disk contents');
  } finally { editor.dispose(); }
}));

test("syntax and config diagnostics suppress edits; ignored files are skipped", () => fixture(async (directory) => {
  const file = join(directory, "Demo.fcg");
  const document = documentAt(file,
    'import "StdLibrary.fcc" as StdLibrary\ngraph Demo{func Noop(){switch x{}}}');
  const editor = fakeVscode(document);

  try {
    editor.instance.refreshDiagnostics(document);
    assert.equal(editor.state.diagnostics.get(document.uri.toString()).length > 0, true);
    assert.deepEqual(editor.state.formattingProvider.provideDocumentFormattingEdits(document), []);

    fs.writeFileSync(join(directory, ".fcfmt.json"), '{"unknown":true}');
    editor.state.onConfigChange();
    assert.equal(editor.state.diagnostics.get(document.uri.toString())[0].code, "config-error");
    assert.deepEqual(editor.state.formattingProvider.provideDocumentFormattingEdits(document), []);

    fs.writeFileSync(join(directory, ".fcfmt.json"), '{"ignore":["*.fcg"]}');
    editor.state.onConfigChange();
    assert.equal(editor.state.diagnostics.has(document.uri.toString()), false);
    assert.deepEqual(editor.state.formattingProvider.provideDocumentFormattingEdits(document), []);
  } finally {
    editor.dispose();
  }
}));

test("invalid operator diagnostics refuse editor edits and preserve unsaved source", () => fixture(async (directory) => {
  const file = join(directory, "Demo.fcg");
  const document = documentAt(file);
  const editor = fakeVscode(document);
  try {
    for (const body of ["a + = b", "a + +", "++a", "Use(a++)"]) {
      const original = compact.replace("func Noop(){}", "func Noop(){" + body + "}");
      document.text = original;
      editor.instance.refreshDiagnostics(document);
      assert.equal(editor.state.diagnostics.get(document.uri.toString())[0].source, "FC Format v5");
      assert.deepEqual(editor.state.formattingProvider.provideDocumentFormattingEdits(document), []);
      await editor.state.commands.get("fcfmt.formatDocument")();
      assert.equal(document.getText(), original);
      assert.ok(editor.state.errors.length > 0);
    }
  } finally {
    editor.dispose();
  }
}));

test("minimal replacement keeps unchanged positions and complete UTF-16/CRLF units", () => {
  const document = documentAt("C:\\Workspace\\Demo.fcg", "AA😀x\r\nBB");
  const editor = fakeVscode(document);

  try {
    const output = "AA😀y\r\nBB";
    const edits = minimalEdit(document, output, editor.vscode);
    assert.equal(applyEdits(document.getText(), edits), output);
    assert.equal(edits[0].range.start.offset, 4);
    assert.equal(edits[0].range.end.offset, 5);

    const emojiEdit = minimalEdit(document, "AA😁x\r\nBB", editor.vscode);
    assert.equal(applyEdits(document.getText(), emojiEdit), "AA😁x\r\nBB");
    assert.equal(emojiEdit[0].range.start.offset, 2);
    assert.equal(emojiEdit[0].range.end.offset, 4);

    const lineEdit = minimalEdit(document, "AA😀x\nBB", editor.vscode);
    assert.equal(applyEdits(document.getText(), lineEdit), "AA😀x\nBB");
    assert.equal(lineEdit[0].range.end.offset, 7);

    assert.equal(minimalEdit(document, document.getText(), editor.vscode).length, 0);
  } finally {
    editor.dispose();
  }
});

test("editor EOL edit follows config and refuses protected mixed endings", () => {
  const document = documentAt("C:\\Workspace\\Demo.fcg", "A\nB");
  const editor = fakeVscode(document);

  try {
    const output = "A\r\nB\r\n";
    const blocked = editorEdits(document, output, editor.vscode);
    assert.equal(blocked.edits.length, 0);
    assert.match(blocked.error, /line ending/);

    const prepared = editorEdits(document, output, editor.vscode, { allowEolChange: true });
    assert.equal(prepared.error, null);
    assert.equal(prepared.targetEol, 2);
    assert.equal(applyEdits(document.getText(),
      [...prepared.edits, { newEol: prepared.targetEol }]), output);

    const mixed = editorEdits(document, "A\r\nB\n", editor.vscode);
    assert.equal(mixed.edits.length, 0);
    assert.match(mixed.error, /mixed/);
  } finally {
    editor.dispose();
  }
});

test("editor caches resolved config and invalidates on config file changes", () => fixture(async (directory) => {
  const filePath = join(directory, "Demo.fcg");
  fs.writeFileSync(filePath, compact);
  const document = documentAt(filePath, compact);
  let resolveCalls = 0;

  const mockCore = {
    resolveConfig(target) {
      resolveCalls += 1;
      return resolveConfig(target);
    },
    formatConfiguredSource(source, target, options) {
      return formatConfiguredSource(source, target, options);
    },
    parseSource(source, kind) {
      return parseSource(source, kind);
    },
  };

  const editor = fakeVscode(document, mockCore);

  try {
    const edits1 = editor.state.formattingProvider.provideDocumentFormattingEdits(document);
    assert.ok(edits1.length > 0);
    assert.equal(resolveCalls, 1);

    // Second format uses cached config without invoking resolveConfig again
    const edits2 = editor.state.formattingProvider.provideDocumentFormattingEdits(document);
    assert.ok(edits2.length > 0);
    assert.equal(resolveCalls, 1);

    // Trigger watcher on config change
    editor.state.onConfigChange();

    // Next format re-resolves config
    const edits3 = editor.state.formattingProvider.provideDocumentFormattingEdits(document);
    assert.ok(edits3.length > 0);
    assert.equal(resolveCalls, 2);
  } finally {
    editor.dispose();
  }
}));

test("editor range formatting isolates edits strictly to the selected line range", () => fixture(async (directory) => {
  const filePath = join(directory, "IsolatedRange.fcg");
  const sourceLines = [
    'import "StdLibrary.fcc" as StdLibrary',
    "",
    "graph MyService {",
    "  func FuncA(){",
    "  var a = 1",
    "  }",
    "",
    "  func FuncB(){",
    "  var b = 2",
    "  }",
    "",
    "  func FuncC(){",
    "  var c = 3",
    "  }",
    "}",
    "",
  ];
  const source = sourceLines.join("\n");
  fs.writeFileSync(filePath, source);

  const document = documentAt(filePath, source);
  const editor = fakeVscode(document);

  try {
    // Select lines 7 to 9 (FuncB only)
    const range = new editor.vscode.Range(
      new editor.vscode.Position(7, 0),
      new editor.vscode.Position(9, 3),
    );

    const edits = editor.state.rangeFormattingProvider.provideDocumentRangeFormattingEdits(document, range);
    assert.ok(edits.length > 0);

    const formatted = applyEdits(document.getText(), edits, document);

    // FuncB must be formatted
    assert.match(formatted, /func FuncB\(\) \{\n\s+var b = 2\n\s+\}/);

    // FuncA and FuncC must remain completely unformatted
    assert.match(formatted, /func FuncA\(\)\{\n\s+var a = 1\n\s+\}/);
    assert.match(formatted, /func FuncC\(\)\{\n\s+var c = 3\n\s+\}/);
  } finally {
    editor.dispose();
  }
}));

test("editor range formatting handles partial-line selection and expands to line boundaries", () => fixture(async (directory) => {
  const filePath = join(directory, "PartialSelection.fcg");
  const source = [
    'import "StdLibrary.fcc" as StdLibrary',
    "",
    "graph PartialService {",
    "  func Calculate(first int,second int){",
    "  var sum = first + second",
    "  }",
    "}",
    "",
  ].join("\n");
  fs.writeFileSync(filePath, source);

  const document = documentAt(filePath, source);
  const editor = fakeVscode(document);

  try {
    // Select from column 5 of line 3 to column 10 of line 4 (middle of lines)
    const range = new editor.vscode.Range(
      new editor.vscode.Position(3, 5),
      new editor.vscode.Position(4, 10),
    );

    const edits = editor.state.rangeFormattingProvider.provideDocumentRangeFormattingEdits(document, range);
    assert.ok(edits.length > 0);

    const formatted = applyEdits(document.getText(), edits, document);
    assert.match(formatted, /func Calculate\(first int, second int\) \{\n\s+var sum = first \+ second/);
  } finally {
    editor.dispose();
  }
}));

test("editor range formatting returns empty array when selection range has no differences", () => fixture(async (directory) => {
  const filePath = join(directory, "CleanSelection.fcg");
  const source = [
    'import "StdLibrary.fcc" as StdLibrary',
    "",
    "graph CleanService {",
    "  func UnformattedBefore(){",
    "  var x = 1",
    "  }",
    "",
    "  func CleanMethod() {",
    "    return",
    "  }",
    "}",
    "",
  ].join("\n");
  fs.writeFileSync(filePath, source);

  const document = documentAt(filePath, source);
  const editor = fakeVscode(document);

  try {
    // Select CleanMethod (lines 7 to 9)
    const range = new editor.vscode.Range(
      new editor.vscode.Position(7, 0),
      new editor.vscode.Position(9, 3),
    );

    const edits = editor.state.rangeFormattingProvider.provideDocumentRangeFormattingEdits(document, range);
    assert.equal(edits.length, 0);
  } finally {
    editor.dispose();
  }
}));

test("editor range formatting formats realistic battle manager graph selection", () => fixture(async (directory) => {
  const filePath = join(directory, "BattleManager.fcg");
  const source = [
    'import "StdLibrary.fcc" as StdLibrary',
    "",
    "[platform_server]",
    "static graph Server_BattleManager {",
    "  _MAX_UNITS int = 100",
    "",
    "  func InitBattle(seed int,mode int){",
    "  var isReady = seed > 0 && mode == 1",
    "  return",
    "  }",
    "",
    "  func Tick(delta float){",
    "  var elapsed = delta * 1.5",
    "  }",
    "}",
    "",
  ].join("\n");
  fs.writeFileSync(filePath, source);

  const document = documentAt(filePath, source);
  const editor = fakeVscode(document);

  try {
    // Select only InitBattle (lines 6 to 9)
    const range = new editor.vscode.Range(
      new editor.vscode.Position(6, 0),
      new editor.vscode.Position(9, 3),
    );

    const edits = editor.state.rangeFormattingProvider.provideDocumentRangeFormattingEdits(document, range);
    assert.ok(edits.length > 0);

    const formatted = applyEdits(document.getText(), edits, document);

    // InitBattle is formatted cleanly
    assert.match(formatted, /func InitBattle\(seed int, mode int\) \{\n\s+var isReady = seed > 0 && mode == 1\n\s+return\n\s+\}/);

    // Tick remains unformatted
    assert.match(formatted, /func Tick\(delta float\)\{\n\s+var elapsed = delta \* 1\.5\n\s+\}/);
  } finally {
    editor.dispose();
  }
}));

test("editor automatically inherits active editor tabSize and insertSpaces when not configured in .fcfmt.json", () => fixture(async (directory) => {
  const filePath = join(directory, "TabDemo.fcg");
  const source = 'import "StdLibrary.fcc" as StdLibrary\n\ngraph TabDemo {\nfunc Run() {\nvar x = 1\n}\n}\n';
  fs.writeFileSync(filePath, source);

  const document = documentAt(filePath, source);
  const editor = fakeVscode(document);

  try {
    // Case 1: Active editor has 4 spaces
    const formattingOptions4Spaces = { tabSize: 4, insertSpaces: true };
    const edits4 = editor.state.formattingProvider.provideDocumentFormattingEdits(document, formattingOptions4Spaces);
    const output4 = applyEdits(source, edits4, document);
    assert.match(output4, /func Run\(\) \{\n {8}var x = 1/);

    // Clear cache
    editor.instance.clearConfigCache();

    // Case 2: Active editor uses Tab indentation
    const formattingOptionsTabs = { tabSize: 4, insertSpaces: false };
    const editsTabs = editor.state.formattingProvider.provideDocumentFormattingEdits(document, formattingOptionsTabs);
    const outputTabs = applyEdits(source, editsTabs, document);
    assert.match(outputTabs, /func Run\(\) \{\n\t\tvar x = 1/);
  } finally {
    editor.dispose();
  }
}));

test("editor uses VS Code configuration settings when .fcfmt.json is absent, and .fcfmt.json overrides it when present", () => fixture(async (directory) => {
  const filePath = join(directory, "ConfigDemo.fcg");
  const source = 'import "StdLibrary.fcc" as StdLibrary\n\ngraph ConfigDemo {\nfunc Run() {\nvar x=1+2\n}\n}\n';
  fs.writeFileSync(filePath, source);

  const document = documentAt(filePath, source);
  const editor = fakeVscode(document);

  try {
    // 1. Configure compact operator spacing in VS Code settings
    editor.state.configuration = {
      "spacing.operators": "compact",
    };

    const edits = editor.state.formattingProvider.provideDocumentFormattingEdits(document);
    const output = applyEdits(source, edits, document);
    // Uses compact operator spacing from VS Code settings
    assert.match(output, /var x=1\+2/);

    // 2. Now add a project .fcfmt.json with spaced operators
    fs.writeFileSync(join(directory, ".fcfmt.json"), JSON.stringify({
      spacing: { operators: "spaced" },
    }));
    editor.state.onConfigCreate();

    const editsOverridden = editor.state.formattingProvider.provideDocumentFormattingEdits(document);
    const outputOverridden = applyEdits(source, editsOverridden, document);
    // .fcfmt.json overrides VS Code settings
    assert.match(outputOverridden, /var x = 1 \+ 2/);
  } finally {
    editor.dispose();
  }
}));

test("editor automatically converts EOL without error when buffer EOL differs from project config", () => fixture(async (directory) => {
  const filePath = join(directory, "EolAuto.fcg");
  // File is Windows CRLF
  const source = 'import "StdLibrary.fcc" as StdLibrary\r\n\r\ngraph EolAuto {\r\nfunc Run() {\r\nvar x = 1\r\n}\r\n}\r\n';
  fs.writeFileSync(filePath, source);

  // Project explicitly configures LF
  fs.writeFileSync(join(directory, ".fcfmt.json"), JSON.stringify({
    endOfLine: "lf",
  }));

  const document = documentAt(filePath, source);
  document.eol = 2; // 2 = CRLF in VS Code EndOfLine enum
  const editor = fakeVscode(document);

  try {
    const edits = editor.state.formattingProvider.provideDocumentFormattingEdits(document);
    // No error diagnostics emitted
    assert.equal(editor.state.diagnostics.has(document.uri.toString()), false);
    // Text edits applied + EndOfLine converted
    assert.ok(edits.length > 0);
    assert.ok(edits.some((e) => e.newEol === 1)); // 1 = LF in VS Code EndOfLine enum
  } finally {
    editor.dispose();
  }
}));

test("range formatting CRLF document isolates edits to selected lines and preserves CRLF", () => fixture(async (directory) => {
  const filePath = join(directory, "RangeCrlf.fcg");
  const source = [
    'import "StdLibrary.fcc" as StdLibrary',
    '',
    'graph WeatherModule {',
    '  WEATHER_EFFECT Map<WeatherType, EResPrefab> = Map<WeatherType, EResPrefab>{',
    '    WeatherType.Snowy: EResPrefab.SnowEffect,',
    '    WeatherType.Rainy: EResPrefab.RainEffect,',
    '    WeatherType.Windy: EResPrefab.WindyEffect,',
    '    WeatherType.HeavyRain: EResPrefab.RainEffect,',
    '  }',
    '  WEATHER_POSITION Map<WeatherType, Vector3> = Map<WeatherType, Vector3>{',
    '    WeatherType.Snowy: Vector3 {0, 20, 0},',
    '    WeatherType.Rainy: Vector3 {0, 20, 0},',
    '    WeatherType.Windy: Vector3 {0, 0, -2},',
    '    WeatherType.HeavyRain: Vector3 {0, 20, 0},',
    '  }',
    '}',
    '',
  ].join("\r\n");
  fs.writeFileSync(filePath, source);

  const document = documentAt(filePath, source);
  document.eol = 2; // CRLF
  const editor = fakeVscode(document);

  try {
    // Select only lines 4 to 7 (the first map entries)
    const range = new editor.vscode.Range(
      new editor.vscode.Position(4, 0),
      new editor.vscode.Position(7, 30),
    );

    const edits = editor.state.rangeFormattingProvider.provideDocumentRangeFormattingEdits(document, range);
    assert.ok(edits.length > 0);

    // Edits must NOT replace the whole file (start line must not be 0)
    for (const edit of edits) {
      assert.ok(edit.range.start.line >= 3);
      assert.ok(edit.range.end.line <= 9);
      // Replacement must use CRLF
      assert.ok(!/[^\r]\n/.test(edit.newText));
    }

    const formatted = applyEdits(source, edits, document);
    // Lines 4-7 are aligned
    assert.match(formatted, /WeatherType\.Snowy\s+: EResPrefab\.SnowEffect/);
    // WEATHER_POSITION (lines 9-14) must remain untouched
    assert.match(formatted, /WeatherType\.Snowy: Vector3 \{0, 20, 0\}/);
    // Preserves CRLF
    assert.ok(formatted.includes("\r\n"));
    assert.ok(!/[^\r]\n/.test(formatted));
  } finally {
    editor.dispose();
  }
}));

test("document formatting preserves document.eol dynamically without issuing setEndOfLine", () => fixture(async (directory) => {
  const filePath = join(directory, "DynamicEol.fcg");
  const crlfSource = 'import "StdLibrary.fcc" as StdLibrary\r\n\r\ngraph Test {\r\nfunc Foo() {\r\nvar x = 1\r\n}\r\n}\r\n';
  fs.writeFileSync(filePath, crlfSource);

  const document = documentAt(filePath, crlfSource);
  document.eol = 2; // CRLF
  const editor = fakeVscode(document);

  try {
    // 1. When document.eol is CRLF, format produces CRLF and issues NO setEndOfLine edit
    const crlfEdits = editor.state.formattingProvider.provideDocumentFormattingEdits(document);
    assert.ok(crlfEdits.every(e => e.newEol === undefined));
    const crlfResult = applyEdits(crlfSource, crlfEdits, document);
    assert.ok(crlfResult.includes("\r\n"));
    assert.ok(!/[^\r]\n/.test(crlfResult));

    // 2. When user switches document to LF (document.eol = 1)
    const lfSource = crlfSource.replace(/\r\n/g, "\n");
    document.text = lfSource;
    document.eol = 1; // LF

    const lfEdits = editor.state.formattingProvider.provideDocumentFormattingEdits(document);
    assert.ok(lfEdits.every(e => e.newEol === undefined));
    const lfResult = applyEdits(lfSource, lfEdits, document);
    assert.ok(!lfResult.includes("\r\n"));
    assert.ok(lfResult.includes("\n"));
  } finally {
    editor.dispose();
  }
}));

test("static linter is disabled by default and produces no diagnostic warnings", () => fixture(async (directory) => {
  const filePath = join(directory, "LintDefault.fcg");
  // Source contains an empty block and unreachable code
  const source = 'import "StdLibrary.fcc" as StdLibrary\n\ngraph LintTest {\nfunc Foo() {\nreturn\nvar x = 1\n}\n}\n';
  fs.writeFileSync(filePath, source);

  const document = documentAt(filePath, source);
  const editor = fakeVscode(document);

  try {
    editor.instance.refreshDiagnostics(document);
    // Since linter.enabled is false by default, no warnings are published
    const docDiags = editor.state.diagnostics.get(document.uri.toString()) ?? [];
    assert.equal(docDiags.length, 0);
  } finally {
    editor.dispose();
  }
}));
