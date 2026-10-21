import assert from "node:assert/strict";
import test from "node:test";
import { parseWithOracle } from "../src/grammar/extension-oracle.mjs";
import { parseSource } from "../src/syntax/parser.mjs";
import { formatSource } from "../src/printer.mjs";

const graph = body => 'import "StdLibrary.fcc" as StdLibrary\ngraph Demo {\n' + body + '\n}\n';
const statement = body => graph('func Run() {\n' + body + '\n}');
const negative = [
  ["library followed by from", 'import "Foo" from "./Foo.fcc" as Bar\ngraph Demo {}', "fcg"],
  ["decorated body function", graph('[platform_client]\nfunc Run() {}'), "fcg"],
  ["decorated listener", graph('[platform_client]\nevent Game.Ready() {}'), "fcg"],
  ["qualified decorator", graph('[A.B]\nvalue int = 1'), "fcg"],
  ["positional tuple initializer", statement('var value = SpawnInfo{1,2}'), "fcg"],
  ["LocString missing arguments", statement('var value = LocString{"KEY"}'), "fcg"],
  ["LocString typed map arguments", statement('var value = LocString{"KEY", Map<string,int>{"a":1}}'), "fcg"],
  ["unsupported binding generic", statement('var value Foo<Bar> = nil'), "fcg"],
  ["bracket list literal", statement('var value = [1,2]'), "fcg"],
  ["missing alias separator", 'alias Handler func(player entity<Player>, out var result List<object>) int\n', "fcc"],
  ["generic parameter type", 'func Run(value Foo<Bar>)\n', "fcc"],
  ["parameter missing type", 'func Run(value)\n', "fcc"],
  ["map argument count", 'define Values: Map<int>\n', "fcc"],
  ["list argument count", 'define Values: List<int, bool>\n', "fcc"],
  ["result type suffix", 'func Run() int bool\n', "fcc"],
  ["bare map LocString arguments", statement('var value = LocString{"KEY", {"a":1}}'), "fcg"],
  ["collection missing generic arguments", statement('var value = List{1,2}'), "fcg"],
  ["readonly arguments", graph('[readonly int]\nvalue int'), "fcg"],
  ["accept missing type", '[accept]\ndefine Value: int\n', "fcc"],
  ["accept on property", graph('[accept int]\nvalue int'), "fcg"],
  ["multiple element types", '[element int, bool]\nenum Values {Value=1}\n', "fcc"],
  ["bridging on graph", 'import "StdLibrary.fcc" as StdLibrary\n[bridging]\ngraph Demo {}\n', "fcg"],
  ["accept on alias", '[accept int]\nalias Example = int\n', "fcc"],
  ["custom decorator on tuple", '[custom]\ntuple Values {value int}\n', "fcc"],
  ["custom decorator on tuple field", 'tuple Values {[custom]\nvalue int}\n', "fcc"],
  ["readonly on tuple field", 'tuple Values {[readonly]\nvalue int}\n', "fcc"],
];

for (const [name, source, kind] of negative) {
  test("P0 refuses " + name + " without printable output", () => {
    assert.equal(parseWithOracle(source, kind).accepted, false, source);
    const parsed = parseSource(source, kind);
    assert.equal(parsed.tree, null, name);
    assert.ok(parsed.diagnostics.length, name);
    const formatted = formatSource(source, kind);
    assert.equal(formatted.output, null);
    assert.deepEqual(formatted.diagnostics, parsed.diagnostics);
  });
}

const positive = [
  ["script import", 'import Foo from "./Foo.fcg"\ngraph Demo {}\n', "fcg"],
  ["aliased script import", 'import Foo as Other from "./Foo.fcg"\ngraph Demo {}\n', "fcg"],
  ["raw library path", 'import `StdLibrary.fcc` as StdLibrary\ngraph Demo {}\n', "fcg"],
  ["raw script path", 'import Foo as Other from `./Foo.fcg`\ngraph Demo {}\n', "fcg"],
  ["builtin module aliases", 'import "List.fcc" as List\nimport "Map.fcc" as Map\ngraph Demo {}\n', "fcg"],
  ["contextual parameter names", 'func Run(element int, from bool)\n', "fcc"],
  ["decorated header function", '[platform_client]\nfunc Test()\n', "fcc"],
  ["decorated property", graph('[readonly]\nvalue int = 1'), "fcg"],
  ["accept type decorator", '[accept entity<Player>]\ndefine Allowed: entity<Player>\n', "fcc"],
  ["enum element decorator", '[element int]\nenum Values {Value=1}\n', "fcc"],
  ["enum accept and entry decorator", '[element int]\n[accept int]\nenum Values {\nValue=1\n[deprecated]\nOld=1\n}\n', "fcc"],
  ["decorated declared graph", '[custom]\ndeclare graph Values {}\n', "fcc"],
  ["component combination", '[combine Transform, Player]\ncomponent View {}\n', "fcc"],
  ["bridging component", '[bridging]\ncomponent View {}\n', "fcc"],
  ["alias union", 'alias Example = int | float\n', "fcc"],
  ["nested function type", 'define Callback: Map<int, func(player entity<Player>, out var result List<object>) bool>\n', "fcc"],
  ["localized literal", statement('var value = LocString{"KEY", List<object>{value}}'), "fcg"],
  ["localized expression key and bare arguments", statement('var value = LocString{key, {value, Map<int,int>{1:2}}}'), "fcg"],
  ["localized empty arguments", statement('var value = LocString{"KEY", {}}'), "fcg"],
  ["static declared graph", 'declare static graph Res {\nField int\n}\n', "fcc"],
  ["qualified tuple", statement('var value = CustomTuple.JsonDocument{Nodes=snapshot,RootIndex=0}'), "fcg"],
  ["cast call", statement('var value = a as int()'), "fcg"],
  ["indexes and grouping", statement('var value = (items)[index]\nvar other = Read()[index]'), "fcg"],
];
for (const [name, source, kind] of positive) {
  test("P0 retains " + name, () => {
    assert.equal(parseWithOracle(source, kind).accepted, true, source);
    const result = formatSource(source, kind);
    assert.deepEqual(result.diagnostics, []);
    assert.equal(parseWithOracle(result.output, kind).accepted, true, result.output);
    assert.equal(formatSource(result.output, kind).output, result.output);
  });
}

test("function-pointer signatures and cast calls have explicit printer roles", () => {
  const source = 'define Callback: func(firstArgument entity<Player>, secondArgument List<object>, out var payload List<object>) int\n';
  const result = formatSource(source, "fcc", { printWidth: 30, wrap: { parameters: "always", calls: "never" } });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.output, 'define Callback: func(\n  firstArgument entity<Player>,\n  secondArgument List<object>,\n  out var payload List<object>) int\n');
  assert.equal(parseWithOracle(result.output, "fcc").accepted, true);
  assert.equal(formatSource(result.output, "fcc", { printWidth: 30, wrap: { parameters: "always", calls: "never" } }).output, result.output);
  assert.ok(formatSource(statement('var value = a as int()'), "fcg").output.includes('a as int()'));
});

test("anonymous function bodies retain statements and block indentation", () => {
  const source = statement('var callback func(value int) int=func(value int) int {\nvar copy=value\nreturn copy\n}');
  assert.equal(parseWithOracle(source, "fcg").accepted, true);
  const result = formatSource(source, "fcg");
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.output.includes('    var callback func(value int) int = func(value int) int {\n      var copy = value\n      return copy\n    }'));
  assert.equal(parseWithOracle(result.output, "fcg").accepted, true);
  assert.equal(formatSource(result.output, "fcg").output, result.output);
});

test("sorted raw import paths retain their literal spelling", () => {
  const source = 'import `./Z.fcc` as Z\nimport "StdLibrary.fcc" as StdLibrary\nimport Foo as A from `./A.fcc`\ngraph Demo {}\n';
  const options = { imports: { sort: true } };
  assert.equal(parseWithOracle(source, "fcg").accepted, true);
  const result = formatSource(source, "fcg", options);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.output.startsWith('import "StdLibrary.fcc" as StdLibrary\n\nimport Foo as A from `./A.fcc`\nimport `./Z.fcc` as Z\n'));
  assert.equal(parseWithOracle(result.output, "fcg").accepted, true);
  assert.equal(formatSource(result.output, "fcg", options).output, result.output);
});
