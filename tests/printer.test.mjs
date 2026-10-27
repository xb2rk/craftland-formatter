import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import test from "node:test";

import { concat, group, hardline, indent, line, text, verbatim } from "../src/document.mjs";
import { formatSource } from "../src/printer.mjs";
import { parseWithOracle } from "../src/grammar/extension-oracle.mjs";
import { render } from "../src/render.mjs";
import { targetCorpus } from "./corpus.mjs";

test("document renderer groups, indents and preserves protected bytes", () => {
  const doc = group(concat(text("Call("), indent(concat(line, text("漢字, "), verbatim("`a\r\nb`"))), hardline, text(")")));
  const result = render(doc, { printWidth: 8, indentUnit: "  ", eol: "\n" });

  assert.equal(result, "Call(\n  漢字, `a\r\nb`\n)");
});

test("blank document lines have no indentation whitespace", () => {
  const doc = concat(text("{"), indent(concat(hardline, text("first"), hardline, hardline,
    text("second"))), hardline, text("}"));
  assert.equal(render(doc, { printWidth: 120, indentUnit: "  ", eol: "\n" }),
    "{\n  first\n\n  second\n}");
});

test("an always-wrapped child survives a flat enclosing group", () => {
  const child = group(concat(text("("), indent(concat(line, text("value"))), text(")")), "always");
  const doc = group(concat(text("Call"), child));

  assert.equal(render(doc, { printWidth: 120, indentUnit: "  ", eol: "\n" }), "Call(\n  value)");
});

test("golden graph layout and empty blocks", () => {
  const source = 'import "StdLibrary.fcc" as StdLibrary\ngraph Demo{func Noop(){}}';
  const expected = 'import "StdLibrary.fcc" as StdLibrary\n\ngraph Demo {\n  func Noop() {}\n}\n';

  assert.equal(parseWithOracle(source, "fcg").accepted, true);
  const result = formatSource(source, "fcg");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.output, expected);
  assert.equal(parseWithOracle(result.output, "fcg").accepted, true);
  assert.equal(formatSource(result.output, "fcg").output, expected);
});

test("preserves multiline else blocks with statements", () => {
  const source = 'import "StdLibrary.fcc" as StdLibrary\n\ngraph Demo {\n  func Test() int {\n    if true {\n      return 1\n    } else {\n      return result\n    }\n  }\n}\n';
  const result = formatSource(source, "fcg");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.output, source);
});

test("width and call role choose grammar-safe closing layout", () => {
  const source = [
    'import "StdLibrary.fcc" as StdLibrary',
    "graph Demo {",
    "  func Run() {",
    "    var values = List<int>{1,2,3}",
    "    DoSomething(1,2,3)",
    "    var result = DoSomething(1,2,3)",
    "  }",
    "}",
  ].join("\n");

  assert.equal(parseWithOracle(source, "fcg").accepted, true);
  const result = formatSource(source, "fcg", { printWidth: 21, wrap: { calls: "auto" } });
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.output, /List<int>\{\n\s+1,\n\s+2,\n\s+3,\n\s+\}/);
  assert.match(result.output, /DoSomething\(\n\s+1,\n\s+2,\n\s+3,\n\s+\)/);
  assert.match(result.output, /var result = DoSomething\(\n\s+1,\n\s+2,\n\s+3\)/);
  assert.equal(parseWithOracle(result.output, "fcg").accepted, true);
});

test("style option pairs remain idempotent and preserve comments and literals", () => {
  const raw = "`first\r\nsecond`";
  const comment = "// exact comment  \t";
  const source = [
    'import "StdLibrary.fcc" as StdLibrary',
    "graph Demo {",
    "  func Run() {",
    `    var value = ${raw}`,
    `    ${comment}`,
    "    DoSomething(1,2,3)",
    "  }",
    "}",
  ].join("\n");

  assert.equal(parseWithOracle(source, "fcg").accepted, true);

  for (const printWidth of [32, 120]) {
    for (const indentUnit of ["  ", "    "]) {
      for (const endOfLine of ["lf", "crlf"]) {
        for (const lineBreaks of ["canonical", "preserve"]) {
          const options = { printWidth, indentUnit, endOfLine, lineBreaks };
          const result = formatSource(source, "fcg", options);

          assert.deepEqual(result.diagnostics, [], JSON.stringify(options));
          assert.ok(result.output.includes(raw), JSON.stringify(options));
          assert.ok(result.output.includes(comment), JSON.stringify(options));
          assert.equal(parseWithOracle(result.output, "fcg").accepted, true, JSON.stringify(options));
          assert.equal(formatSource(result.output, "fcg", options).output, result.output, JSON.stringify(options));
        }
      }
    }
  }
});

test("wrap modes and final newline compose without changing grammar", () => {
  const source = [
    'import "StdLibrary.fcc" as StdLibrary',
    "graph Demo {",
    "  func Run(a int, b int) {",
    "    if a > 0 && b > 0 {",
    "      var values = List<int>{1, 2, 3}",
    "      DoSomething(1, 2, 3)",
    "      var result = DoSomething(1, 2, 3)",
    "    }",
    "  }",
    "}",
  ].join("\n");

  assert.equal(parseWithOracle(source, "fcg").accepted, true);

  for (const wrapMode of ["always", "never"]) {
    const options = {
      printWidth: 40,
      finalNewline: false,
      wrap: {
        calls: wrapMode,
        parameters: wrapMode,
        collections: wrapMode,
        conditions: wrapMode,
      },
    };
    const first = formatSource(source, "fcg", options);

    assert.deepEqual(first.diagnostics, [], wrapMode);
    assert.ok(!first.output.endsWith("\n"), wrapMode);
    assert.equal(parseWithOracle(first.output, "fcg").accepted, true, wrapMode);
    assert.equal(formatSource(first.output, "fcg", options).output, first.output, wrapMode);
  }
});

test("spacing controls change flat punctuation without changing FC tokens", () => {
  const source = [
    'import "StdLibrary.fcc" as StdLibrary',
    "graph Demo {",
    "  func Run(a int, b int) {",
    "    var values = List<int>{1, 2, 3}",
    "    DoSomething(1, 2)",
    "  }",
    "}",
  ].join("\n");
  const options = { spacing: { assignment: "compact", comma: "compact" } };
  const result = formatSource(source, "fcg", options);

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.output, /Run\(a int,b int\)/);
  assert.match(result.output, /var values=List<int>\{1,2,3\}/);
  assert.match(result.output, /DoSomething\(1,2\)/);
  assert.equal(parseWithOracle(result.output, "fcg").accepted, true);
  assert.equal(formatSource(result.output, "fcg", options).output, result.output);
});

test("blank-line policies respect the cap and do not split empty blocks", () => {
  const source = [
    'import "StdLibrary.fcc" as StdLibrary',
    "",
    "",
    "graph Demo {",
    "  func First() {}",
    "",
    "",
    "",
    "  func Second() {}",
    "}",
  ].join("\n");
  const options = {
    blankLines: { maxConsecutive: 1, afterImports: "never", betweenMembers: "always" },
  };
  const result = formatSource(source, "fcg", options);

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.output, /StdLibrary\ngraph Demo \{/);
  assert.match(result.output, /First\(\) \{\}\n\n  func Second\(\) \{\}/);
  assert.equal(parseWithOracle(result.output, "fcg").accepted, true);
  assert.equal(formatSource(result.output, "fcg", options).output, result.output);

  const dense = formatSource(source, "fcg", { blankLines: { maxConsecutive: 0 } });
  assert.deepEqual(dense.diagnostics, []);
  assert.doesNotMatch(dense.output, /\n\n/);
  assert.equal(formatSource(dense.output, "fcg", { blankLines: { maxConsecutive: 0 } }).output, dense.output);
});

test("shift and prefix operators retain readable spacing", () => {
  const source = [
    'import "StdLibrary.fcc" as StdLibrary',
    "graph Demo {",
    "  func Bits(flag int, value int) int {",
    "    var shifted int = 1 << (flag as int)",
    "    var combined int = shifted | (1 << value)",
    "    var negative int = -value",
    "    return combined + negative",
    "  }",
    "}",
  ].join("\n");
  const result = formatSource(source, "fcg");

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.output, /1 << \(flag as int\)/);
  assert.match(result.output, /shifted \| \(1 << value\)/);
  assert.match(result.output, /int = -value/);
  assert.equal(parseWithOracle(result.output, "fcg").accepted, true);
  assert.equal(formatSource(result.output, "fcg").output, result.output);
});

test("malformed input never produces formatted output", () => {
  const result = formatSource("graph Demo {}", "fcg");

  assert.equal(result.output, null);
  assert.ok(result.diagnostics.length > 0);
});

test("a final multiline comment keeps its internal and terminal EOL bytes", () => {
  const source = 'import "StdLibrary.fcc" as StdLibrary\ngraph Demo {}\n/*keep\r\nline\r\n*/\r\n';

  assert.equal(parseWithOracle(source, "fcg").accepted, true);
  const result = formatSource(source, "fcg");

  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.output.includes("/*keep\r\nline\r\n*/"));
  assert.equal(parseWithOracle(result.output, "fcg").accepted, true);
});

test("compiler-positive fixtures retain oracle grammar after formatting", () => {
  const fixtures = JSON.parse(readFileSync(new URL("../grammar/compiler-fixtures.json", import.meta.url), "utf8"));
  const positives = fixtures.filter((fixture) =>
    (fixture.expectParserSuccess ?? true) && (fixture.expectCompilerSuccess ?? true));

  assert.equal(positives.length, 25);

  for (const fixture of positives) {
    const result = formatSource(fixture.source, fixture.kind);

    assert.deepEqual(result.diagnostics, [], fixture.name);
    assert.equal(parseWithOracle(result.output, fixture.kind).accepted, true, fixture.name);
  }
});

test("formatted target corpus reparses and is idempotent", () => {
  const paths = targetCorpus();
  assert.ok(paths.length >= 5, "The target corpus must contain test fixtures.");
  const failures = [];

  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    const kind = extname(path).slice(1).toLowerCase();
    const result = formatSource(source, kind);

    if (!result.output) {
      failures.push(path + ": " + result.diagnostics[0]?.code);
      continue;
    }

    const oracle = parseWithOracle(result.output, kind);

    if (!oracle.accepted) {
      const line = oracle.errors[0]?.line ?? 1;
      const context = result.output.split(/\r?\n/).slice(Math.max(0, line - 3), line + 2).join(" ⏎ ");
      failures.push(path + ": oracle rejected line " + line + " (" + oracle.errors[0]?.message + ") " + context);
      continue;
    }

    const second = formatSource(result.output, kind);

    if (second.output !== result.output) {
      failures.push(path + ": not idempotent " + second.diagnostics[0]?.code);
    }
  }

  assert.deepEqual(failures.slice(0, 3), [], failures.length + " corpus failures");
});
