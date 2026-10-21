import assert from "node:assert/strict";
import test from "node:test";

import { formatSource } from "../src/printer.mjs";
import { parseWithOracle } from "../src/grammar/extension-oracle.mjs";

const graph = (body) => 'import "StdLibrary.fcc" as StdLibrary\n\ngraph Demo {\n  ' + body + '\n}\n';

function check(input, output, options = {}) {
  const source = graph(input);
  assert.equal(parseWithOracle(source, "fcg").accepted, true, source);
  const result = formatSource(source, "fcg", options);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.output, graph(output));
  assert.equal(parseWithOracle(result.output, "fcg").accepted, true, result.output);
  assert.equal(formatSource(result.output, "fcg", options).output, result.output);
}

test("reported rarity table aligns map colons by default when it breaks", () => {
  check("_RARITY_TINT_MAP Map<int, Color> = {Rarity.Common: #B0BEC5, Rarity.Uncommon: #81C784, " +
    "Rarity.Rare: #64B5F6, Rarity.Epic: #BA68C8, Rarity.Legendary: #FFD54F, Rarity.Mythic: #E57373, " +
    "Rarity.Special: #80DEEA, Rarity.Locked: #78909C}", [
    "_RARITY_TINT_MAP Map<int, Color> = {", "    Rarity.Common   : #B0BEC5,",
    "    Rarity.Uncommon : #81C784,", "    Rarity.Rare     : #64B5F6,",
    "    Rarity.Epic     : #BA68C8,", "    Rarity.Legendary: #FFD54F,",
    "    Rarity.Mythic   : #E57373,", "    Rarity.Special  : #80DEEA,",
    "    Rarity.Locked   : #78909C,", "  }",
  ].join("\n"));
});

test("flat collections have normal punctuation without column padding", () => {
  check('values = Map<string, int>{"a": 1, "long": 2}',
    'values = Map<string, int>{"a": 1, "long": 2}');
  check("value = Thing{a = 1, longer = 2}", "value = Thing{a = 1, longer = 2}");
  check("values = Map<int, int>{1: 1, 123: 2}", "values = Map<int, int>{1: 1, 123: 2}",
    { printWidth: 10, wrap: { collections: "never" } });
});

test("struct equals signs align with spaced and compact assignment style", () => {
  check("value = Thing{a=1,longer=2}", "value = Thing{\n    a      = 1,\n    longer = 2,\n  }",
    { wrap: { collections: "always" } });
  check("value = Thing{a=1,longer=2}", "value=Thing{\n    a     =1,\n    longer=2,\n  }",
    { wrap: { collections: "always" }, spacing: { assignment: "compact", comma: "compact" } });
});

test("disabled alignment removes source column padding in broken collections", () => {
  check('values = Map<string, int>{"a"   : 1,"long":2}',
    'values = Map<string, int>{\n    "a": 1,\n    "long": 2,\n  }',
    { alignment: { collections: false }, wrap: { collections: "always" } });
  check("value = Thing{a=1,longer=2}", "value = Thing{\n    a = 1,\n    longer = 2,\n  }",
    { alignment: { collections: false }, wrap: { collections: "always" } });
});

test("nested collections align within their own scope and lists get no padding", () => {
  check("values = Map<int, Map<int, int>>{1: Map<int, int>{2: 3, 444: 5}, 123: Map<int, int>{6: 7}}", [
    "values = Map<int, Map<int, int>>{", "    1  : Map<int, int>{", "      2  : 3,",
    "      444: 5,", "    },", "    123: Map<int, int>{", "      6: 7,", "    },", "  }",
  ].join("\n"), { wrap: { collections: "always" } });
  check("values = List<int>{1,123}", "values = List<int>{\n    1,\n    123,\n  }",
    { wrap: { collections: "always" } });
});

test("alignment uses displayed columns for wide and combining literal keys", () => {
  check('values = Map<string, int>{"漢":1,"aa":2,"é":3}',
    'values = Map<string, int>{\n    "漢": 1,\n    "aa": 2,\n    "é" : 3,\n  }',
    { wrap: { collections: "always" } });
  const options = { indentUnit: "\t", wrap: { collections: "always" } };
  const source = graph('values = Map<string, int>{"a":1,"long":2}');
  const output = formatSource(source, "fcg", options).output;
  assert.equal(output, 'import "StdLibrary.fcc" as StdLibrary\n\ngraph Demo {\n' +
    '\tvalues = Map<string, int>{\n\t\t"a"   : 1,\n\t\t"long": 2,\n\t}\n}\n');
  assert.equal(formatSource(output, "fcg", options).output, output);
});

test("alignment remains active when map values are independently flat or broken", () => {
  check("values = Map<int, bool>{1: a && b, 123: c}",
    "values = Map<int, bool>{\n    1  : a &&\n      b,\n    123: c,\n  }",
    { wrap: { collections: "always", conditions: "always" } });
});

test("preserved groups and protected multiline literals retain source layout", () => {
  for (const input of [
    'values = Map<int, string>{1: `a\r\nb`, 123: "x"}',
  ]) {
    check(input, input, { wrap: { collections: "always" }, alignment: { collections: false } });
  }
  const original = "values = Map<int, int>{\n   1: 2,\n   123: 4,\n }";
  check(original, original, { lineBreaks: "preserve", wrap: { collections: "always" } });
});
