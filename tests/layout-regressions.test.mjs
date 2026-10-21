import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { formatSource } from "../src/printer.mjs";
import { parseWithOracle } from "../src/grammar/extension-oracle.mjs";

const graph = body => 'import "StdLibrary.fcc" as StdLibrary\n\ngraph Demo {\n  func Run() {\n' + body + '\n  }\n}\n';

/** Readability, grammar acceptance and stability are independent assertions. */
function check(source, expected, options = {}, kind = "fcg") {
  assert.equal(parseWithOracle(source, kind).accepted, true, source);
  const result = formatSource(source, kind, options);
  assert.deepEqual(result.diagnostics, []);
  if (expected !== undefined) assert.equal(result.output, expected);
  assert.equal(parseWithOracle(result.output, kind).accepted, true, result.output);
  assert.equal(formatSource(result.output, kind, options).output, result.output);
  return result.output;
}

test("reported logging expression wraps concatenation before its small nested calls", () => {
  const source = graph('LogInfo(\n' +
    '"Client_EntityPool: " + reportKey + " available=" + ToString(List.Length(_AvailableByKey[reportKey])) + " active=" + ToString(GetActiveCount(reportKey)),\n)');
  check(source, graph([
    '    LogInfo(',
    '      "Client_EntityPool: " +',
    '        reportKey +',
    '        " available=" +',
    '        ToString(List.Length(_AvailableByKey[reportKey])) +',
    '        " active=" +',
    '        ToString(GetActiveCount(reportKey)),',
    '    )',
  ].join('\n')));
});

test("arithmetic precedence groups and fitting logical operands have independent layout", () => {
  check(graph('var total = alpha + beta * gamma + delta'),
    graph('    var total = alpha +\n      beta * gamma +\n      delta'), { printWidth: 28 });
  check(graph('var valid = left + right > 0 && second + third > 0'),
    graph('    var valid = left + right > 0 &&\n      second + third > 0'),
    { printWidth: 45, wrap: { conditions: "always" } });
  check(graph('var total = firstLongOperand + +secondLongOperand - -thirdLongOperand'),
    graph('    var total = firstLongOperand +\n      +secondLongOperand -\n      -thirdLongOperand'), { printWidth: 40 });
});

test("binary continuations compose with compact spacing, tabs, parentheses and call policy", () => {
  const source = graph('Use(alpha + beta + gamma)');
  check(source, graph('    Use(alpha+beta+gamma)'),
    { printWidth: 10, spacing: { operators: "compact" }, wrap: { calls: "never" } });
  check(graph('var value = (alpha + beta + gamma)'),
    graph('    var value = (alpha +\n      beta +\n      gamma)'), { printWidth: 25 });

  const output = check(source, undefined,
    { indentUnit: '\t', continuationIndent: 2, printWidth: 15 });
  assert.ok(output.includes('\t\tUse(\n\t\t\talpha +\n\t\t\t\t\tbeta +\n\t\t\t\t\tgamma,'), output);
  for (const operator of ['*', '/', '%', '&', '^', '|']) {
    check(graph(`var total = alpha ${operator} beta ${operator} gamma ${operator} delta`),
      graph(`    var total = alpha ${operator}\n      beta ${operator}\n      gamma ${operator}\n      delta`), { printWidth: 30 });
  }
});

test("commented collections keep row sections, comment gaps and footer gaps up to the cap", () => {
  const source = graph('var values=Map<int,int>{1:2, // first\n\n\n\n' +
    '// next\n\n\n123:4,\n\n// footer\n\n}');
  for (const cap of [0, 1, 2]) {
    const gap = '\n'.repeat(cap);
    const expected = graph('    var values = Map<int, int>{\n' +
      '      1  : 2, // first\n' + gap +
      '      // next\n' + gap +
      '      123: 4,\n' + '\n'.repeat(Math.min(cap, 1)) +
      '      // footer\n' + '\n'.repeat(Math.min(cap, 1)) + '    }');
    check(source, cap === 0 ? expected.replace('\n\ngraph', '\ngraph') : expected,
    { blankLines: { maxConsecutive: cap } });
  }
});

test("nested commented collections retain their own sections with CRLF and forced flat policy", () => {
  const source = graph('var values=List<List<int>>{\n\n// group\nList<int>{\n1,\n\n// next\n2,\n},\n}');
  const expected = graph('    var values = List<List<int>>{\n\n      // group\n' +
    '      List<int>{\n        1,\n\n        // next\n        2,\n      },\n    }');
  check(source.replaceAll('\n', '\r\n'), expected.replaceAll('\n', '\r\n'),
    { endOfLine: 'crlf', wrap: { collections: 'never' } });
  check(graph('var values=List<int>{\n// footer only\n\n}'),
    graph('    var values = List<int>{\n      // footer only\n\n    }'));
});

test("live feature flags and pooling sources retain the reported layout contracts", (t) => {
  const candidates = [
    new URL('../../../Assets/Scripts/Core/FeatureFlags.fcg', import.meta.url),
    new URL('../../PlantsVsZombiesFCC/Assets/Scripts/Core/FeatureFlags.fcg', import.meta.url),
  ];
  const flagUrl = candidates.find((u) => existsSync(u));
  if (!flagUrl) {
    t.skip("No live game project available for FeatureFlags test");
    return;
  }
  const flags = readFileSync(flagUrl, 'utf8');
  const output = check(flags);
  assert.match(output, /KillSwitchChestSystem\s*: true,\n\n\s*\/\/ The existing KillSwitch/);
  for (const side of ['Client', 'Server']) {
    const poolCandidates = [
      new URL(`../../../Assets/Scripts/Global/${side}_EntityPool.fcg`, import.meta.url),
      new URL(`../../PlantsVsZombiesFCC/Assets/Scripts/Global/${side}_EntityPool.fcg`, import.meta.url),
    ];
    const poolUrl = poolCandidates.find((u) => existsSync(u));
    const source = readFileSync(poolUrl, 'utf8');
    const formatted = check(source);
    assert.ok(formatted.includes('ToString(GetActiveCount(reportKey))'), side);
    assert.ok(!formatted.includes('ToString(\n'), side);
  }
});

test("default parameter policy retains single-line signatures even past printWidth", () => {
  const source = 'import "StdLibrary.fcc" as StdLibrary\ngraph Demo {\n' +
    'func Process( firstVeryLongParameter int , secondVeryLongParameter List< int > ) {}\n}';
  const expected = 'import "StdLibrary.fcc" as StdLibrary\n\ngraph Demo {\n' +
    '  func Process(firstVeryLongParameter int, secondVeryLongParameter List<int>) {}\n}\n';
  check(source, expected, { printWidth: 20 });
});

test("preserve keeps partial parameter breaks in functions and event listeners", () => {
  const source = 'import "StdLibrary.fcc" as StdLibrary\ngraph Demo {\n' +
    'func Process( first int,\nsecond List< int >, third bool) {}\n' +
    'event OnReady(first int,\nsecond int) {}\n}';
  const expected = 'import "StdLibrary.fcc" as StdLibrary\n\ngraph Demo {\n' +
    '  func Process(first int,\n    second List<int>, third bool) {}\n' +
    '  event OnReady(first int,\n    second int) {}\n}\n';
  check(source, expected, { printWidth: 15 });
  check(source, expected.replaceAll('    second', '\t\tsecond').replaceAll('  func', '\tfunc').replaceAll('  event', '\tevent'),
    { indentUnit: '\t', printWidth: 15 });
});

test("event declarations and function types preserve parameter breaks independently of EOL", () => {
  const source = 'event Changed(first int,\nsecond int)\n' +
    'define Callback:func(\nfirst int, second List<int>,\nout var third int) bool\n';
  const expected = 'event Changed(first int,\n  second int)\n' +
    'define Callback: func(\n  first int, second List<int>,\n  out var third int) bool\n';
  check(source, expected, { wrap: { parameters: 'preserve' } }, 'fcc');
  check(source, expected.replaceAll('\n', '\r\n'), { endOfLine: 'crlf' }, 'fcc');
});

test("nested and anonymous function signatures do not accumulate flat-parent indentation", () => {
  const source = 'import "StdLibrary.fcc" as StdLibrary\ngraph Demo {\n' +
    'func Apply(callback func(\nvalue int) int) {}\nfunc Run() {\n' +
    'var callback func(value int) int = func(\nvalue int) int {return value}\n}\n}';
  const expected = 'import "StdLibrary.fcc" as StdLibrary\n\ngraph Demo {\n' +
    '  func Apply(callback func(\n    value int) int) {}\n  func Run() {\n' +
    '    var callback func(value int) int = func(\n      value int) int {\n      return value\n    }\n  }\n}\n';
  check(source, expected);
});

test("parameter auto/always/never remain available and preserve is limited to parameters", () => {
  const source = 'event Changed(\nfirst int, second int)\n';
  check(source, 'event Changed(first int, second int)\n', { wrap: { parameters: 'auto' } }, 'fcc');
  check(source, 'event Changed(first int, second int)\n', { printWidth: 5, wrap: { parameters: 'never' } }, 'fcc');
  check(source, 'event Changed(\n  first int,\n  second int)\n', { wrap: { parameters: 'always' } }, 'fcc');
  check(source, 'event Changed(\n  first int,\n  second int)\n', { printWidth: 20, wrap: { parameters: 'auto' } }, 'fcc');
  for (const name of ['calls', 'collections', 'conditions']) {
    assert.throws(() => formatSource(source, 'fcc', { wrap: { [name]: 'preserve' } }), TypeError);
  }
});

test("parameter blank-line caps and protected commented signatures keep their boundaries", () => {
  check('event Changed(\n\n\nfirst int,\n\n\nsecond int)\n',
    'event Changed(\n\n  first int,\n\n  second int)\n', { blankLines: { maxConsecutive: 1 } }, 'fcc');
  check('event Changed(\n\nfirst int,\n\nsecond int)\n',
    'event Changed(\n  first int,\n  second int)\n', { blankLines: { maxConsecutive: 0 } }, 'fcc');
  const source = 'event Changed( first int, // exact\n    second int)\n';
  check(source, source, { printWidth: 5 }, 'fcc');
});
