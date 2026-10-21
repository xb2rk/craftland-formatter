import assert from "node:assert/strict";
import test from "node:test";

import { formatSource } from "../src/printer.mjs";
import { parseSource } from "../src/syntax/parser.mjs";
import { parseWithOracle } from "../src/grammar/extension-oracle.mjs";

const graph = (body) => 'import "StdLibrary.fcc" as StdLibrary\ngraph Demo {\n  func Run() {\n' +
  body + '\n  }\n}';
const expected = (body) => graph(body).replace('StdLibrary\ngraph', 'StdLibrary\n\ngraph') + '\n';

/** Check readable output independently from syntax acceptance and stability. */
function check(body, output, options = {}) {
  const source = graph(body);
  assert.equal(parseWithOracle(source, "fcg").accepted, true, source);
  const result = formatSource(source, "fcg", options);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.output, expected(output));
  assert.equal(parseWithOracle(result.output, "fcg").accepted, true, result.output);
  assert.equal(formatSource(result.output, "fcg", options).output, result.output);
  return result.output;
}

test("reported multiline condition gets a consistent continuation level", () => {
  check([
    "if entryId <= 0 ||", "targetId <= 0 ||", "conditionValue < 0 ||",
    "!IsValidCategory(category) ||", "!IsValidConditionType(conditionType) ||",
    "Map.ContainKey(_CATEGORY_BY_ENTRY, entryId) {", "LogInvalidRow(rowIndex)", "continue", "}",
  ].join("\n"), [
    "    if entryId <= 0 ||", "      targetId <= 0 ||", "      conditionValue < 0 ||",
    "      !IsValidCategory(category) ||", "      !IsValidConditionType(conditionType) ||",
    "      Map.ContainKey(_CATEGORY_BY_ENTRY, entryId) {", "      LogInvalidRow(rowIndex)",
    "      continue", "    }",
  ].join("\n"));
});

test("reported assignment breaks both the outer and nested logical chains", () => {
  const body = "var isLegitimateCoinEarn bool = currencyType == CurrencyType.Coin &&\n" +
    "(origin == CurrencyEarnOrigin.GameplayReward || origin == CurrencyEarnOrigin.MissionReward || " +
    "origin == CurrencyEarnOrigin.BossDefeat || origin == CurrencyEarnOrigin.CollectionReward)";
  check(body, [
    "    var isLegitimateCoinEarn bool = currencyType == CurrencyType.Coin &&",
    "      (origin == CurrencyEarnOrigin.GameplayReward ||",
    "        origin == CurrencyEarnOrigin.MissionReward ||",
    "        origin == CurrencyEarnOrigin.BossDefeat ||",
    "        origin == CurrencyEarnOrigin.CollectionReward)",
  ].join("\n"));
});

test("logical wrap modes apply to assignments and returns", () => {
  const body = "var valid bool = a && (b || c)\nreturn a && b || c";
  check(body, "    var valid bool = a && (b || c)\n    return a && b || c");
  check(body, ["    var valid bool = a &&", "      (b ||", "        c)",
    "    return a &&", "      b ||", "      c"].join("\n"), { wrap: { conditions: "always" } });
  check(body, "    var valid bool = a && (b || c)\n    return a && b || c",
    { printWidth: 10, wrap: { conditions: "never" } });
});

test("parenthesized expressions wrap independently from call argument lists", () => {
  check("var value = (a || b)\nUse(a || b)",
    "    var value = (a || b)\n    Use(\n      a || b,\n    )",
    { wrap: { calls: "always", conditions: "never" } });
  check("var value = (a || b)\nUse(a || b)",
    "    var value = (a ||\n      b)\n    Use(a ||\n      b)",
    { wrap: { calls: "never", conditions: "always" } });
});

test("logical indentation composes with else-if, while and for headers", () => {
  check("if a && b {} else if c || d {} else {}\nwhile a && b {}\nfor i = 0, 2, 1 {}",
    ["    if a &&", "      b {} else if c ||", "      d {} else {}",
      "    while a &&", "      b {}", "    for i = 0, 2, 1 {}"].join("\n"),
    { wrap: { conditions: "always" } });
});

test("nested calls and parenthesized children retain separate continuation scopes", () => {
  check("if first && Check(a, b) || (second && third) {}",
    ["    if first &&", "      Check(", "        a,", "        b) ||",
      "      (second &&", "        third) {}"].join("\n"),
    { wrap: { calls: "always", conditions: "always" } });
});

test("continuation indent supports zero, multiple levels, tabs and preserved breaks", () => {
  check("if a || b || c {}", "    if a ||\n    b ||\n    c {}",
    { continuationIndent: 0, wrap: { conditions: "always" } });
  check("if a || b || c {}", "    if a ||\n        b ||\n        c {}",
    { continuationIndent: 2, wrap: { conditions: "always" } });
  check("if a ||\nb || c {}", "    if a ||\n      b || c {}",
    { lineBreaks: "preserve", wrap: { conditions: "never" } });

  const options = { indentUnit: "\t", continuationIndent: 2, wrap: { conditions: "always" } };
  const source = graph("if a || b {}\nvar value = a && (b || c)");
  const output = formatSource(source, "fcg", options).output;
  assert.equal(output, [
    'import "StdLibrary.fcc" as StdLibrary', "", "graph Demo {", "\tfunc Run() {",
    "\t\tif a ||", "\t\t\t\tb {}", "\t\tvar value = a &&", "\t\t\t\t(b ||",
    "\t\t\t\t\t\tc)", "\t}", "}", "",
  ].join("\n"));
  assert.equal(parseWithOracle(output, "fcg").accepted, true);
  assert.equal(formatSource(output, "fcg", options).output, output);
});

test("a fitting nested chain stays flat even when its enclosing condition breaks", () => {
  check("if firstCondition || secondCondition || (a && b) {}",
    "    if firstCondition ||\n      secondCondition ||\n      (a && b) {}", { printWidth: 35 });
});

test("logical chains in arguments and collection values use the same policy", () => {
  check("Use(a && b, c)\nvar values = List<bool>{a || b, c && d}", [
    "    Use(", "      a &&", "        b,", "      c,", "    )",
    "    var values = List<bool>{", "      a ||", "        b,",
    "      c &&", "        d,", "    }",
  ].join("\n"), { wrap: { calls: "always", collections: "always", conditions: "always" } });
});

test("comments and multiline literals keep protected grouping bytes", () => {
  const body = "var value = (a || /* exact */ b)\nvar raw = (`first\r\nsecond`)";
  check(body, "    var value = (a || /* exact */ b)\n    var raw = (`first\r\nsecond`)",
    { wrap: { calls: "always", conditions: "always" }, printWidth: 10 });
});

test("grouping parentheses preserve grammar-approved closes and forbid call commas", () => {
  const parsed = parseSource(graph("var value = (a || b)\nUse(a)"), "fcg");
  const pending = [parsed.tree];
  const kinds = [];
  while (pending.length) {
    const node = pending.pop();
    kinds.push(node.kind);
    pending.push(...node.children);
  }
  assert.ok(kinds.includes("Parenthesized"));
  assert.ok(kinds.includes("BareCall"));

  for (const body of ["var value = (a || b\n)", "var value = (a,)"]) {
    assert.equal(parseWithOracle(graph(body), "fcg").accepted, false);
    assert.equal(formatSource(graph(body), "fcg").output, null);
  }
});

test("spaced builtin type arguments, component access and shifts canonicalize safely", () => {
  check("var values = List < int > {1,2}\nvar value = globalEntity < Global > .SkyboxEnv\n" +
    "var shifted = a < < b\nvar back = a > > b\nvar less = a < b",
    "    var values = List<int>{1, 2}\n    var value = globalEntity<Global>.SkyboxEnv\n" +
    "    var shifted = a << b\n    var back = a >> b\n    var less = a < b");
});
