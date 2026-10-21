import assert from "node:assert/strict";
import test from "node:test";
import { lexWithOracle, parseWithOracle } from "../src/grammar/extension-oracle.mjs";

const importLine = 'import "StdLibrary.fcc" as StdLibrary\n';
const withStatement = (statement) =>
  importLine + "graph Demo {\n  func Run() {\n    " + statement + "\n  }\n}\n";
const withMember = (member) =>
  importLine + "graph Demo {\n  " + member + "\n}\n";

/**
 * Each expected result is specific to the surrounding syntax. An accepted
 * newline in one place does not authorize the same newline in another.
 */
const cases = [
  ["logical operator after", withStatement("if a &&\n      b {}"), true],
  ["logical operator before", withStatement("if a\n      && b {}"), false],
  ["arithmetic operator after", withStatement("var x = a +\n      b"), true],
  ["arithmetic operator before", withStatement("var x = a\n      + b"), false],
  ["argument comma after", withStatement("Run(1,\n      2)"), true],
  ["argument comma before", withStatement("Run(1\n      , 2)"), false],
  ["member dot after", withStatement("var x = a.\n      b"), true],
  ["member dot before", withStatement("var x = a\n      .b"), false],
  ["return value same line", withStatement("return 1"), true],
  ["return value on next line", withStatement("return\n      1"), false],
  ["else same line", withStatement("if a {} else {}"), true],
  ["else next line", withStatement("if a {}\n    else {}"), false],
  ["bare call trailing comma and own closing line", withStatement("Run(\n      1,\n      2,\n    )"), true],
  ["value call closes beside final argument", withStatement("var x = Run(\n      1,\n      2)"), true],
  ["value call closing line alone", withStatement("var x = Run(\n      1,\n      2\n    )"), false],
  ["value call trailing comma", withStatement("var x = Run(\n      1,\n      2,\n    )"), false],
  ["collection trailing comma", withStatement("var x = Vector3{\n      1,\n      2,\n      3,\n    }"), true],
  ["multiline empty block is syntactically accepted", withStatement("if a {\n    }"), true],
  ["signature closes beside final parameter", withMember("func Run(\n    a int,\n    b int) {}"), true],
  ["signature closing line alone", withMember("func Run(\n    a int,\n    b int\n  ) {}"), false],
  ["signature trailing comma", withMember("func Run(\n    a int,\n    b int,\n  ) {}"), false],
  ["generic comma after", withMember("m Map<int,\n    string> = nil"), true],
  ["generic comma before", withMember("m Map<int\n    , string> = nil"), false],
  ["generic closing bracket on its own line", withMember("m Map<\n    int,\n    string\n  > = nil"), false],
];

test("grammar-approved and forbidden line breaks stay distinct", async (t) => {
  for (const [name, source, expected] of cases) {
    await t.test(name, () => {
      const result = parseWithOracle(source, "fcg");
      assert.equal(result.accepted, expected, JSON.stringify(result.errors));
    });
  }
});

test("the lexer retains raw multiline literal bytes", () => {
  const literal = String.fromCharCode(96) + "first  \nsecond" + String.fromCharCode(96);
  const source = withStatement("var value = " + literal);
  const parsed = parseWithOracle(source, "fcg");
  assert.equal(parsed.accepted, true, JSON.stringify(parsed.errors));
  const lexed = lexWithOracle(source);
  assert.deepEqual(lexed.errors, []);
  assert.ok(lexed.tokens.some((token) => token.name === "RAW_STRING_LIT" && token.text === literal));
});
