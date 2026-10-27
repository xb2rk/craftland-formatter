"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, join, resolve, sep } = require("node:path");
const vscode = require("vscode");

const compact = [
  'import "EditorGenLib.fcc" as EditorGen', 'import "StdLibrary.fcc" as StdLibrary',
  'graph Demo{func Noop(firstVeryLongParameter int, secondVeryLongParameter List<int>){',
  'var count int=1', 'count ++', 'count += - 1', 'var negative int=- -count',
  'count += (1)', 'var comparison bool=count >= (0)',
  'var colors = Map<int, int>{1:2,123:4}',
  'var commented = Map<int, int>{', '// row note', '1:2,', '', '// section', '123:4,', '}',
  'var callback func(', 'first int,', 'out var second int) bool = nil',
  'LogInfo("Client_EntityPool: " + reportKey + " active=" + ToString(GetActiveCount(reportKey)))',
  '        // fc-format-ignore', '      var untouched=1+2',
  'var valid bool = first && (second || third)',
  'if first || second {}', '}', 'event OnReady(first int,', 'second int) {}', '}',
].join("\n");

async function run() {
  const extension = vscode.extensions.getExtension("craftland-community.fc-format-v5-vscode") ??
    vscode.extensions.getExtension("fc-format.fc-format-v5-vscode");
  assert.ok(extension, "FC Format v5 extension was not loaded");
  await extension.activate();

  const temporaryRoot = process.env.FCFMT_HOST_ROOT ?? tmpdir();
  const directory = fs.mkdtempSync(join(temporaryRoot, "fcfmt-v5-host-"));
  const file = join(directory, "Demo.fcg");
  const diskText = 'import "StdLibrary.fcc" as StdLibrary\ngraph Disk{}';

  try {
    fs.mkdirSync(join(directory, ".git"));
    fs.writeFileSync(join(directory, ".fcfmt.json"),
      JSON.stringify({ printWidth: 80, indent: { size: 4, continuation: 1 }, endOfLine: "crlf",
        imports: { sort: true }, wrap: { collections: "always", conditions: "always" } }));
    fs.writeFileSync(file, diskText);

    const uri = vscode.Uri.file(file);
    const document = await vscode.workspace.openTextDocument(uri);
    const unsaved = new vscode.WorkspaceEdit();
    unsaved.replace(uri, new vscode.Range(document.positionAt(0),
      document.positionAt(document.getText().length)), compact);
    assert.equal(await vscode.workspace.applyEdit(unsaved), true);
    assert.equal(document.isDirty, true);

    const blocked = await vscode.commands.executeCommand(
      "vscode.executeFormatDocumentProvider", uri, { tabSize: 2, insertSpaces: true });
    assert.ok(!blocked || blocked.length === 0,
      "provider must not change mismatched EOL bytes");

    const editor = await vscode.window.showTextDocument(document);
    assert.equal(await editor.edit((builder) => builder.setEndOfLine(vscode.EndOfLine.CRLF)), true);
    assert.equal(document.eol, vscode.EndOfLine.CRLF);
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    const alignedInput = document.getText();

    const edits = await vscode.commands.executeCommand(
      "vscode.executeFormatDocumentProvider", uri, { tabSize: 2, insertSpaces: true });
    assert.ok(Array.isArray(edits), "format provider did not return edits");

    const formatting = new vscode.WorkspaceEdit();
    formatting.set(uri, edits);
    assert.equal(await vscode.workspace.applyEdit(formatting), true);

    const { formatConfiguredSource } = await import("../../src/service.mjs");
    const expected = formatConfiguredSource(alignedInput, file).output;
    assert.ok(expected.includes("count++"));
    assert.ok(expected.includes("count += -1"));
    assert.ok(expected.includes("var negative int = - -count"));
    assert.ok(expected.includes("count += (1)"));
    assert.ok(expected.includes("count >= (0)"));
    assert.ok(expected.includes("            1  : 2,\r\n            123: 4,"));
    assert.ok(expected.startsWith('import "StdLibrary.fcc" as StdLibrary\r\nimport "EditorGenLib.fcc" as EditorGen'));
    assert.ok(expected.includes('            // row note\r\n            1  : 2,'));
    assert.ok(expected.includes('func(\r\n            first int,\r\n            out var second int) bool'));
    assert.ok(expected.includes('func Noop(firstVeryLongParameter int, secondVeryLongParameter List<int>)'));
    assert.ok(expected.includes('event OnReady(first int,\r\n        second int) {}'));
    assert.ok(expected.includes('1  : 2,\r\n\r\n            // section'));
    assert.ok(expected.includes('"Client_EntityPool: " +\r\n                reportKey +'));
    assert.ok(expected.includes('ToString(GetActiveCount(reportKey))'));
    assert.ok(expected.includes('        // fc-format-ignore\r\n      var untouched=1+2'));
    assert.ok(expected.includes("        var valid bool = first &&\r\n" +
      "            (second ||\r\n                third)"));
    assert.ok(expected.includes("        if first ||\r\n            second {}"));
    assert.equal(document.getText(), expected);
    assert.equal(editor.selection.active.line, 0);
    assert.equal(editor.selection.active.character, 0);

    // Preserved CRLF pragma bytes intentionally survive layout EOL changes;
    // use the pragma-free buffer for the manual conversion contract.
    const withoutPragma = expected.replace('        // fc-format-ignore\r\n      var untouched=1+2\r\n', '');
    assert.equal(await editor.edit((builder) => builder.replace(
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), withoutPragma)), true);
    assert.equal(await editor.edit((builder) => builder.setEndOfLine(vscode.EndOfLine.LF)), true);
    await vscode.commands.executeCommand("fcfmt.formatDocument");
    assert.equal(document.getText(), withoutPragma);
    assert.equal(fs.readFileSync(file, "utf8"), diskText);

    const unformatted = compact.replace(/\n/g, "\r\n");
    assert.equal(await editor.edit((builder) => builder.replace(
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      unformatted)), true);
    await vscode.commands.executeCommand("workbench.action.files.save");
    assert.equal(fs.readFileSync(file, "utf8"),
      formatConfiguredSource(unformatted, file).output);

    const saved = fs.readFileSync(file, "utf8");
    const invalidSources = [
      unformatted.replace("count ++", "count + = 1"),
      unformatted.replace("count ++", "var invalid = [1,2]"),
      unformatted.replace("count ++", "var invalid Foo<Bar> = nil"),
    ];
    for (const invalid of invalidSources) {
      assert.equal(await editor.edit((builder) => builder.replace(
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), invalid)), true);
      const invalidEdits = await vscode.commands.executeCommand(
        "vscode.executeFormatDocumentProvider", uri, { tabSize: 2, insertSpaces: true });
      assert.ok(!invalidEdits || invalidEdits.length === 0);
      assert.equal(document.getText(), invalid);
      assert.equal(fs.readFileSync(file, "utf8"), saved);
    }

    if (process.env.FCFMT_HOST_RESULT) {
      fs.writeFileSync(process.env.FCFMT_HOST_RESULT, "passed\n");
    }

    process.stdout.write("Extension Host provider matches shared core on unsaved text\n");
  } finally {
    const absolute = resolve(directory);
    assert.ok(absolute.startsWith(resolve(tmpdir()) + sep));
    assert.ok(basename(absolute).startsWith("fcfmt-v5-host-"));
    // NOTE: the VS Code file watcher may hold this directory until the host
    // exits. The launcher removes its isolated parent after process exit.
    if (!process.env.FCFMT_HOST_ROOT) {
      fs.rmSync(absolute, { recursive: true, force: true });
    }
  }
}

module.exports = { run };
