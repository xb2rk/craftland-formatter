import assert from "node:assert/strict";
import test from "node:test";
import { formatSource } from "../src/printer.mjs";
import { parseWithOracle } from "../src/grammar/extension-oracle.mjs";
import { parseSource } from "../src/syntax/parser.mjs";

function formatBody(body, options = {}) {
  const source = 'import "StdLibrary.fcc" as StdLibrary\ngraph Demo {\nfunc Run() {\n' + body + '\n}\n}\n';
  assert.equal(parseWithOracle(source, "fcg").accepted, true, body);
  const result = formatSource(source, "fcg", options);
  assert.deepEqual(result.diagnostics, [], body);
  assert.equal(parseWithOracle(result.output, "fcg").accepted, true, body);
  assert.equal(formatSource(result.output, "fcg", options).output, result.output, body);
  return result.output;
}

test("postfix updates stay attached and retain the next statement boundary", () => {
  const body = [
    "abcd ++", "abcd --", "values[0] ++", "obj.value --",
    "abcd ++ // keep++", "abcd ++", "if true {return}",
  ].join("\n");

  for (const options of [{}, { spacing: { assignment: "compact", comma: "compact" }, lineBreaks: "preserve" }]) {
    const output = formatBody(body, options);
    for (const expected of ["abcd++", "abcd--", "values[0]++", "obj.value--", "abcd++  // keep++"]) {
      assert.ok(output.includes("    " + expected + "\n"), expected + "\n" + output);
    }
    assert.ok(output.includes("    abcd++\n    if true {"), output);
  }
});

test("legacy unary spacing contracts cover returns, calls, maps and binary signs", () => {
  const body = [
    "var absVal int=-value", "var positive int=+value", "var inverted int=~value",
    "var negated int=-(a+b)", "var delta int=a - -b", "var sum int=a + +b",
    'var values Map<string,int> = Map<string,int>{"negative":-1}',
    "if aIsNeg&&!bIsNeg {return -1}", "Use(-value,+value,!aIsNeg,~value)",
    "return-_compareBlocks(a,b)",
  ].join("\n");
  const output = formatBody(body);
  for (const expected of [
    "var absVal int = -value", "var positive int = +value", "var inverted int = ~value",
    "var negated int = -(a + b)", "var delta int = a - -b", "var sum int = a + +b",
    'Map<string, int>{"negative": -1}', "if aIsNeg && !bIsNeg {", "return -1",
    "Use(-value, +value, !aIsNeg, ~value)", "return -_compareBlocks(a, b)",
  ]) {
    assert.ok(output.includes(expected), expected + "\n" + output);
  }
});

test("unary operands bind after compound assignments and comparisons without merging tokens", () => {
  const cases = [
    ...["+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="].map((operator) =>
      ["a" + operator + "- b", "a " + operator + " -b"]),
    ...["==", "!=", "<", ">", "<=", ">="].map((operator) =>
      ["var c = a" + operator + "- b", "var c = a " + operator + " -b"]),
    ["a-=+ b", "a -= +b"],
    ["var c = - -a", "var c = - -a"],
    ["var c = + +a", "var c = + +a"],
    ["var c = - +a", "var c = -+a"],
    ["var c = ~ ~a", "var c = ~~a"],
  ];
  for (const [input, expected] of cases) {
    const output = formatBody(input);
    assert.ok(output.includes("    " + expected + "\n"), input + "\n" + output);
  }
});

test("operators before parenthesized operands use their normal separator", () => {
  for (const operator of ["+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="]) {
    const expected = "a " + operator + " (b)";
    assert.ok(formatBody("a" + operator + "(b)").includes(expected), expected);
  }
  for (const operator of ["==", "!=", "<", ">", "<=", ">=", "+", "-", "*", "/", "%", "&", "|", "^"]) {
    const expected = "var c = a " + operator + " (b)";
    assert.ok(formatBody("var c = a " + operator + "(b)").includes(expected), expected);
  }
  assert.ok(formatBody("var c = (a)", { spacing: { assignment: "compact" } }).includes("var c=(a)"));
});

test("malformed operators are rejected before any formatted output is returned", () => {
  const invalid = [
    "a + +", "a - -", "a + = b", "a - = b", "a = = b", "a ! = b",
    "a & & b", "a | | b", "++a", "--a", "a+++b", "a++ + b", "a +=", "a.",
    "var c = a + *b", "var c = a + +", "var c = a ++", "var c = a + = b",
    "Use(a + = b)", "Use(a++)", "var c = List<int>{1 +}",
    "if a ! = b {}", "while a + {}", "Use(1,,2)",
  ];
  for (const body of invalid) {
    const source = 'import "StdLibrary.fcc" as StdLibrary\ngraph Demo {\nfunc Run() {\n' + body + '\n}\n}\n';
    assert.equal(parseWithOracle(source, "fcg").accepted, false, body);
    const parsed = parseSource(source, "fcg");
    assert.equal(parsed.tree, null, body);
    assert.ok(parsed.diagnostics.length > 0, body);
    assert.equal(parsed.diagnostics[0].phase, "parser", body);
    assert.equal(formatSource(source, "fcg").output, null, body);
    assert.equal(source.slice(parsed.diagnostics[0].start, parsed.diagnostics[0].end).length > 0, true, body);
  }
});

test("legal repeated prefixes, separated shifts and control headers remain accepted", () => {
  const body = [
    "var c = a + +b", "var d = a - -b", "var e = ! !a", "var f = ~ ~a",
    "var shift = a < < b", "var otherShift = a > > b", "for i = 0, 2, 1 {}",
    "for key, value in values {}", "Use(out var value, - -a)",
    "var skybox = globalEntity<Global>.SkyboxEnv", "available[0]<UIWidget>.IsVisible = true",
    "var value = Get()<UIWidget>.IsVisible", "return",
  ].join("\n");
  formatBody(body);
});
