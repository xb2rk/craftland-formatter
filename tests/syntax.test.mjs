import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import test from "node:test";

import { lexWithOracle, parseWithOracle } from "../src/grammar/extension-oracle.mjs";
import { lexSource } from "../src/syntax/lexer.mjs";
import { parseSource } from "../src/syntax/parser.mjs";
import { targetCorpus } from "./corpus.mjs";

const corpus = targetCorpus();

test("lossless lexer matches syntax token boundaries on the target corpus", () => {
  assert.ok(corpus.length >= 5, "The target corpus must contain test fixtures.");

  for (const path of corpus) {
    const source = readFileSync(path, "utf8");
    const actual = lexSource(source);
    const expected = lexWithOracle(source);

    assert.deepEqual(actual.diagnostics, [], path);
    assert.equal(actual.tokens.map((token) => token.text).join(""), source, path);

    const syntax = actual.tokens
      .filter((token) => token.channel === "syntax")
      .map(({ kind, text, start, end }) => ({ kind, text, start, end }));
    const oracleSyntax = expected.tokens
      .filter((token) => token.channel === 0 && token.type !== -1 && token.name !== "EOS")
      .map(({ name: kind, text, start, end }) => ({ kind, text, start, end }));

    assert.equal(syntax.length, oracleSyntax.length, path + " token count");

    for (let index = 0; index < syntax.length; index += 1) {
      assert.deepEqual(syntax[index], oracleSyntax[index], path + " token " + index);
    }
  }
});

test("structural parser accepts the target corpus and rare fixtures", () => {
  const rare = JSON.parse(readFileSync(new URL("../grammar/rare-fixtures.json", import.meta.url), "utf8"));
  const examples = corpus.map((path) => ({
    name: path,
    kind: extname(path).slice(1).toLowerCase(),
    source: readFileSync(path, "utf8"),
  }));
  const failures = [];

  for (const fixture of [...examples, ...rare]) {
    const oracle = parseWithOracle(fixture.source, fixture.kind);
    const actual = parseSource(fixture.source, fixture.kind);

    if (!oracle.accepted) {
      failures.push(fixture.name + ": oracle rejection");
    }

    if (actual.diagnostics.length > 0) {
      failures.push(fixture.name + ": " + actual.diagnostics[0].code + " at line " + actual.diagnostics[0].line);
    } else if (!actual.tree || actual.tree.start !== 0 || actual.tree.end !== fixture.source.length) {
      failures.push(fixture.name + ": missing or incomplete tree");
    }
  }

  assert.deepEqual(failures, []);
});

test("known malformed inputs produce diagnostics without a printable tree", () => {
  const fixtures = JSON.parse(readFileSync(new URL("../grammar/compiler-fixtures.json", import.meta.url), "utf8"));

  for (const fixture of fixtures.filter((item) => item.expectParserSuccess === false)) {
    const actual = parseSource(fixture.source, fixture.kind);

    assert.ok(actual.tree === null, fixture.name + " was accepted unexpectedly");
    assert.ok(actual.diagnostics.length > 0, fixture.name);
  }
});

test("line-break rules match the pinned grammar in their syntax roles", () => {
  const statement = (body) =>
    'import "StdLibrary.fcc" as StdLibrary\ngraph Demo {\n  func Run() {\n    ' + body + "\n  }\n}\n";
  const member = (body) =>
    'import "StdLibrary.fcc" as StdLibrary\ngraph Demo {\n  ' + body + "\n}\n";
  const cases = [
    ["operator after", statement("var x = a +\n      b"), true],
    ["operator before", statement("var x = a\n      + b"), false],
    ["call comma before", statement("Run(1\n      , 2)"), false],
    ["member dot before", statement("var x = a\n      .b"), false],
    ["return value next line", statement("return\n      1"), false],
    ["else next line", statement("if a {}\n    else {}"), false],
    ["bare call trailing comma", statement("Run(\n      1,\n      2,\n    )"), true],
    ["value call trailing comma", statement("var x = Run(\n      1,\n      2,\n    )"), false],
    ["value call isolated close", statement("var x = Run(\n      1,\n      2\n    )"), false],
    ["signature trailing comma", member("func Run(\n    a int,\n    b int,\n  ) {}"), false],
    ["signature isolated close", member("func Run(\n    a int,\n    b int\n  ) {}"), false],
    ["generic comma before", member("m Map<int\n    , string> = nil"), false],
    ["generic isolated close", member("m Map<\n    int,\n    string\n  > = nil"), false],
  ];

  for (const [name, source, expected] of cases) {
    assert.equal(parseWithOracle(source, "fcg").accepted, expected, name + " oracle expectation");

    const actual = parseSource(source, "fcg");
    assert.equal(actual.tree !== null, expected, name + " independent parser");
  }
});

test("syntax tree exposes roles needed by the printer", () => {
  const graph = [
    'import "StdLibrary.fcc" as StdLibrary',
    "graph Demo {",
    "  func Sum(a int) int { return a }",
    "  func Run() {",
    "    if true { var values = List<int>{1} }",
    "    Sum(1)",
    "    var value = Sum(2)",
    "  }",
    "}",
    "",
  ].join("\n");
  const header = 'import "StdLibrary.fcc" as StdLibrary\ncomponent Thing {\n  Field int\n}\n';

  for (const [source, kind, expected] of [
    [graph, "fcg", ["Import", "Graph", "GraphBlock", "Function", "Signature", "CodeBlock", "ControlFlow", "Condition", "TypeArguments", "Collection", "BareCall", "ValueCall"]],
    [header, "fcc", ["Import", "Declaration", "DeclarationBlock", "Property"]],
  ]) {
    assert.equal(parseWithOracle(source, kind).accepted, true, kind + " oracle acceptance");

    const parsed = parseSource(source, kind);
    assert.deepEqual(parsed.diagnostics, [], kind);

    const kinds = new Set();
    const pending = [parsed.tree];

    while (pending.length > 0) {
      const node = pending.pop();
      kinds.add(node.kind);
      pending.push(...node.children);
    }

    for (const role of expected) {
      assert.ok(kinds.has(role), kind + " missing " + role);
    }
  }
});
