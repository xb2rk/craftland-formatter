import assert from "node:assert/strict";
import test from "node:test";
import { parseWithOracle } from "../src/grammar/extension-oracle.mjs";

const importLine = 'import "StdLibrary.fcc" as StdLibrary\n';
const withStatement = (statement) =>
  importLine + "graph Demo {\n  func Run() {\n    " + statement + "\n  }\n}\n";
const withMember = (member) =>
  importLine + "graph Demo {\n  " + member + "\n}\n";

const cases = [
  ["empty list", withStatement("var x = List<int>{}"), true],
  ["single-item list", withStatement("var x = List<int>{1}"), true],
  ["broken single-item list with comma", withStatement("var x = List<int>{\n  1,\n}"), true],
  ["broken single-item list without comma", withStatement("var x = List<int>{\n  1\n}"), false],
  ["flat map", withStatement('var x = Map<string, int>{"one": 1}'), true],
  ["broken map with trailing comma", withStatement('var x = Map<string, int>{\n  "one": 1,\n  "two": 2,\n}'), true],
  ["broken map without trailing comma", withStatement('var x = Map<string, int>{\n  "one": 1,\n  "two": 2\n}'), false],
  ["nested composite", withStatement('var x = Map<string, List<int>>{\n  "one": List<int>{1, 2},\n}'), true],
  ["flat struct fields", withStatement("var x = SpawnInfo{position = Vector3{0, 0, 0}, yaw = 0}"), true],
  ["broken struct fields with comma", withStatement("var x = SpawnInfo{\n  position = Vector3{0, 0, 0},\n  yaw = 0,\n}"), true],
  ["broken struct fields without comma", withStatement("var x = SpawnInfo{\n  position = Vector3{0, 0, 0},\n  yaw = 0\n}"), false],
  ["localized string wraps without trailing comma", withStatement('var x = LocString{\n  "x",\n  {1, 2}}'), true],
  ["localized string rejects trailing comma", withStatement('var x = LocString{\n  "x",\n  {1, 2},\n}'), false],
  ["while block", withStatement("while true {}"), true],
  ["for block", withStatement("for i = 0, 2, 1 {}"), true],
  ["wait call", withStatement("wait Action(\n  1,\n  2,\n)"), true],
  ["start call", withStatement("start Action(\n  1,\n  2,\n)"), true],
  ["return call closes beside last argument", withMember("func Sum(a int,b int) int { return a+b }\n func Run() int { return Sum(\n  1,\n  2) }"), true],
  ["return call closing line alone", withMember("func Sum(a int,b int) int { return a+b }\n func Run() int { return Sum(\n  1,\n  2\n ) }"), false],
  ["switch is absent from 1.11.0", withStatement("switch 1 {}"), false],
];

test("collection, control-flow, and call-role grammar matrix", async (t) => {
  for (const [name, source, expected] of cases) {
    await t.test(name, () => {
      const result = parseWithOracle(source, "fcg");
      assert.equal(result.accepted, expected, JSON.stringify(result.errors));
    });
  }
});
