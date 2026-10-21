import assert from "node:assert/strict";
import test from "node:test";
import { formatSource } from "../src/printer.mjs";
import { parseWithOracle } from "../src/grammar/extension-oracle.mjs";

const graph = body => 'import "StdLibrary.fcc" as StdLibrary\n\ngraph Demo {\n  func Run() {\n' + body + '\n  }\n}\n';
function check(source, options, expected) {
  assert.equal(parseWithOracle(source, "fcg").accepted, true, source);
  const result = formatSource(source, "fcg", options);
  assert.deepEqual(result.diagnostics, []);
  if (expected !== undefined) assert.equal(result.output, expected);
  assert.equal(parseWithOracle(result.output, "fcg").accepted, true, result.output);
  assert.equal(formatSource(result.output, "fcg", options).output, result.output);
  return result.output;
}

test("compact operators retain words, shift tokens and repeated unary boundaries", () => {
  const source = graph('var a = 1 + 2\na += - 1\nif a >= 0 && b != 0 {}\nvar shifted = a < < b\nvar value = a as int()\nvar repeated = - -a\nvar positive = a + +b');
  check(source, { spacing: { operators: "compact" } }, graph('    var a=1+2\n    a+=-1\n    if a>=0&&b!=0 {}\n    var shifted=a<<b\n    var value=a as int()\n    var repeated=- -a\n    var positive=a+ +b'));
  const spacedAssignments = check(source, { spacing: { operators: "compact", assignment: "spaced" } });
  assert.ok(spacedAssignments.includes('var a = 1+2'));
  assert.ok(spacedAssignments.includes('a+=-1'));
});

test("flat bracket padding respects width and leaves empty braces compact", () => {
  check(graph('var vector = Vector3{1,2,3}\nvar map = Map<int,int>{1:2}\nvar empty = List<int>{}'),
    { spacing: { brackets: "spaced", comma: "compact" } },
    graph('    var vector = Vector3{ 1,2,3 }\n    var map = Map<int,int>{ 1: 2 }\n    var empty = List<int>{}'));
  const broken = check(graph('var value = List<int>{1,2}'),
    { spacing: { brackets: "spaced" }, wrap: { collections: "always" } });
  assert.ok(broken.includes('List<int>{\n      1,\n      2,\n    }'));
});

test("collection comments follow their values and neighboring entries reflow", () => {
  const input = graph('var values = Map<int,int>{\n// small\n1:2, // tiny\n/* wider */ 123:4,\n// footer\n}');
  check(input, {}, graph('    var values = Map<int, int>{\n      // small\n      1  : 2, // tiny\n      /* wider */\n      123: 4,\n      // footer\n    }'));
  const vector = graph('var value = Vector3{\n// note\n1,2,3,\n}');
  check(vector, { wrap: { collections: "never" } }, graph('    var value = Vector3{\n      // note\n      1,\n      2,\n      3,\n    }'));
});

test("multiline raw literals preserve bytes alongside collection style controls", () => {
  const literal = '`one  \r\ntwo`';
  const output = check(graph('var values = List<string>{' + literal + ', "x"}'),
    { spacing: { brackets: "spaced" }, wrap: { collections: "always" } });
  assert.ok(output.includes(literal));
});

test("import sorting groups paths and moves attached comments and aliases", () => {
  const source = ['// last project\nimport Z as Zed from "./Z.fcg"',
    'import "EditorGenLib.fcc" as EditorGen', 'import "StdLibrary.fcc" as StdLibrary',
    '// contract\nimport Model from "../Contracts/Model.fcc"',
    'import Parent from "../../Parent.fcc"', 'import A from "./A.fcg"', 'graph Demo {}', ''].join('\n');
  const output = check(source, { imports: { sort: true } });
  assert.equal(output, ['import "StdLibrary.fcc" as StdLibrary', 'import "EditorGenLib.fcc" as EditorGen', '',
    '// contract', 'import Model from "../Contracts/Model.fcc"', '',
    'import Parent from "../../Parent.fcc"', 'import A from "./A.fcg"', '// last project',
    'import Z as Zed from "./Z.fcg"', '', 'graph Demo {}', ''].join('\n'));
  assert.equal(check(source, {}), output);
  assert.ok(check(source, { imports: { sort: false } }).startsWith('// last project\nimport Z as Zed'));
});

test("source ignores preserve a whole next entry and format surrounding entries", () => {
  const preserved = '    // fc-format-ignore\n       if ready {\n var x=1+2\n   }';
  const source = graph('var before=1\n' + preserved + '\nvar after=2');
  const output = check(source, { spacing: { operators: "compact" } });
  assert.ok(output.includes(preserved), output);
  assert.ok(output.includes('    var before=1\n'));
  assert.ok(output.includes('\n    var after=2'));
});

test("block ignores protect nested regions, comments and indentation", () => {
  const preserved = ' /* fc-format-ignore-start */\n var first=1+2\n /* fc-format-ignore-start */\n   var second = 3 + 4\n /* fc-format-ignore-end */\n /* fc-format-ignore-end */';
  const output = check(graph(preserved + '\nvar after=5'), {});
  assert.ok(output.includes(preserved), output);
  assert.ok(output.includes('    var after = 5'));
});

test("a line ignore also retains its attached trailing comment spacing", () => {
  const preserved = '  // fc-format-ignore\n var first=1+2 /* exact */';
  const output = check(graph(preserved + '\nvar next=3'), {});
  assert.ok(output.includes(preserved));
  assert.ok(output.includes('    var next = 3'));
});

test("ignore markers in literals are inert and marker errors suppress formatting", () => {
  const source = graph('var label="// fc-format-ignore"\nvar value=1+2');
  assert.ok(check(source, {}).includes('    var value = 1 + 2'));
  for (const marker of ['/* fc-format-ignore-start */', '/* fc-format-ignore-end */']) {
    const result = formatSource(graph(marker + '\nvar value=1'), "fcg");
    assert.equal(result.output, null);
    assert.equal(result.diagnostics[0].code, 'unmatched-ignore-marker');
  }
  assert.equal(formatSource(graph('// fc-format-ignore\nvar value=[1,2]'), "fcg").output, null);
});

test("import sorting honors protected imports and detached comment boundaries", () => {
  for (const boundary of ['// fc-format-ignore', '// detached\n']) {
    const source = 'import "Z.fcc" as Z\n' + boundary + '\nimport "A.fcc" as A\ngraph Demo {}\n';
    const output = check(source, { imports: { sort: true } });
    assert.ok(output.indexOf('"Z.fcc"') < output.indexOf('"A.fcc"'));
    assert.ok(output.includes(boundary.trim()));
  }
});

test("import sorting retains duplicate units and multiline trailing comment bytes", () => {
  const comment = '/* keep  \r\nthese bytes */';
  const source = 'import "Z.fcc" as Z ' + comment + '\nimport "A.fcc" as A\nimport "A.fcc" as Again\ngraph Demo {}\n';
  const output = check(source, { imports: { sort: true } });
  assert.ok(output.startsWith('import "A.fcc" as A\nimport "A.fcc" as Again'));
  assert.ok(output.includes('import "Z.fcc" as Z  ' + comment));
});
