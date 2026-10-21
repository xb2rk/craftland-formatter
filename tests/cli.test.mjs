import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { commitFile } from "../src/cli.mjs";
import { matchesGlob } from "../src/config.mjs";
import { formatSource } from "../src/printer.mjs";

const script = fileURLToPath(new URL("../scripts/fcfmt.mjs", import.meta.url));
const generator = fileURLToPath(new URL("../scripts/gen-config-artifacts.mjs", import.meta.url));
const compact = 'import "StdLibrary.fcc" as StdLibrary\ngraph Demo{func Noop(){}}';

test("CLI version matches the extension release", () => fixture((directory) => {
  const version = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url))).version;
  const extensionVersion = JSON.parse(fs.readFileSync(new URL("../extension/package.json", import.meta.url))).version;
  assert.equal(extensionVersion, version);
  const result = cli(directory, ["--version"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, version + "\n");
}));
const formatted = 'import "StdLibrary.fcc" as StdLibrary\n\ngraph Demo {\n  func Noop() {}\n}\n';

function fixture(callback) {
  const directory = fs.mkdtempSync(join(tmpdir(), "fcfmt-cli-"));

  try {
    fs.mkdirSync(join(directory, ".git"));
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function cli(directory, args, input) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: directory,
    input,
    encoding: "utf8",
  });
}

function sourceFile(directory, relativePath = "Demo.fcg", source = compact) {
  const path = join(directory, relativePath);
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, source);
  return path;
}

test("schema, types and reference stay in sync with the option registry", () => {
  const result = spawnSync(process.execPath, [generator, "--check"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("parameter preservation defaults, overrides, flags and provenance are consistent", () => fixture((directory) => {
  const input = 'event Changed(firstLongParameter int,\nsecondLongParameter int)\n';
  const file = sourceFile(directory, "Changed.fcc", input);
  const preserved = 'event Changed(firstLongParameter int,\n  secondLongParameter int)\n';
  const result = cli(directory, [file, '--print-width=10']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, preserved);
  const defaults = JSON.parse(cli(directory, ['--explain-config', file]).stdout);
  assert.equal(defaults.options.wrap.parameters, 'preserve');
  assert.equal(defaults.provenance['wrap.parameters'], 'default');

  fs.writeFileSync(join(directory, '.fcfmt.json'), JSON.stringify({
    wrap: { parameters: 'never' },
    overrides: [{ files: '*.fcc', options: { wrap: { parameters: 'preserve' } } }],
  }));
  const configured = cli(directory, [file]);
  assert.equal(configured.status, 0, configured.stderr);
  assert.equal(configured.stdout, preserved);
  const flat = cli(directory, [file, '--wrap-parameters=auto']);
  assert.equal(flat.status, 0, flat.stderr);
  assert.equal(flat.stdout, 'event Changed(firstLongParameter int, secondLongParameter int)\n');
  const explained = JSON.parse(cli(directory, ['--explain-config', file, '--wrap-parameters=preserve']).stdout);
  assert.equal(explained.options.wrap.parameters, 'preserve');
  assert.equal(explained.provenance['wrap.parameters'], 'CLI');
  const explainedCalls = JSON.parse(cli(directory, ['--explain-config', file, '--wrap-calls=preserve']).stdout);
  assert.equal(explainedCalls.options.wrap.calls, 'preserve');
  assert.equal(explainedCalls.provenance['wrap.calls'], 'CLI');
  const explainedCols = JSON.parse(cli(directory, ['--explain-config', file, '--wrap-collections=preserve']).stdout);
  assert.equal(explainedCols.options.wrap.collections, 'preserve');
  assert.equal(explainedCols.provenance['wrap.collections'], 'CLI');
  for (const flag of ['--wrap-conditions=preserve']) {
    assert.equal(cli(directory, [file, flag]).status, 2);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), input);
}));

test("layout settings resolve through config, overrides, CLI flags and provenance", () => fixture((directory) => {
  const input = compact.replace("func Noop(){}", "func Noop(){\n" +
    'var values = Map<int, int>{1:2,123:4}\nif a || b {}\n}');
  const file = sourceFile(directory, "sub/Demo.fcg", input);
  fs.writeFileSync(join(directory, ".fcfmt.json"), JSON.stringify({
    alignment: { collections: true }, indent: { continuation: 0 },
    wrap: { collections: "always", conditions: "always" },
    overrides: [{ files: "sub/*.fcg", options: {
      alignment: { collections: false }, indent: { continuation: 2 },
    } }],
  }));

  const configured = cli(directory, [file]);
  assert.equal(configured.status, 0, configured.stderr);
  assert.ok(configured.stdout.includes("      1: 2,\n      123: 4,"));
  assert.ok(configured.stdout.includes("    if a ||\n        b {}"));

  const flags = ["--align-collections=true", "--indent-continuation=1"];
  const overridden = cli(directory, [file, ...flags]);
  assert.equal(overridden.status, 0, overridden.stderr);
  assert.ok(overridden.stdout.includes("      1  : 2,\n      123: 4,"));
  assert.ok(overridden.stdout.includes("    if a ||\n      b {}"));
  const explained = JSON.parse(cli(directory, ["--explain-config", file, ...flags]).stdout);
  assert.equal(explained.options.alignment.collections, true);
  assert.equal(explained.options.indent.continuation, 1);
  assert.equal(explained.provenance["alignment.collections"], "CLI");
  assert.equal(explained.provenance["indent.continuation"], "CLI");
  assert.equal(fs.readFileSync(file, "utf8"), input);

  for (const flag of ["--indent-continuation=-1", "--indent-continuation=5", "--align-collections=yes"]) {
    const invalid = cli(directory, [file, flag]);
    assert.equal(invalid.status, 2, flag);
    assert.equal(invalid.stdout, "");
  }
}));

test("P1 settings use overrides, flags and provenance without writing inputs", () => fixture((directory) => {
  const input = 'import "Z.fcc" as Z\nimport "A.fcc" as A\ngraph Demo{func Run(){var value=Vector3{1,2,3}}}';
  const file = sourceFile(directory, "sub/Demo.fcg", input);
  fs.writeFileSync(join(directory, ".fcfmt.json"), JSON.stringify({
    spacing: { operators: "compact", brackets: "spaced" },
    imports: { sort: false }, overrides: [{ files: "sub/*.fcg", options: {
      imports: { sort: true }, spacing: { assignment: "spaced", comma: "compact" },
    } }],
  }));
  const configured = cli(directory, [file]);
  assert.equal(configured.status, 0, configured.stderr);
  assert.ok(configured.stdout.startsWith('import "A.fcc" as A'));
  assert.ok(configured.stdout.includes('var value = Vector3{ 1,2,3 }'));
  const flags = ["--sort-imports=false", "--spacing-brackets=tight", "--spacing-assignment=inherit"];
  const overridden = cli(directory, [file, ...flags]);
  assert.equal(overridden.status, 0, overridden.stderr);
  assert.ok(overridden.stdout.startsWith('import "Z.fcc" as Z'));
  assert.ok(overridden.stdout.includes('var value=Vector3{1,2,3}'));
  const explained = JSON.parse(cli(directory, ["--explain-config", file, ...flags]).stdout);
  for (const name of ["imports.sort", "spacing.brackets", "spacing.assignment"]) assert.equal(explained.provenance[name], "CLI");
  assert.match(explained.provenance["spacing.operators"], /\.fcfmt\.json$/);
  assert.equal(fs.readFileSync(file, "utf8"), input);
}));

test("P0 grammar failures prevent the entire CLI write batch", () => fixture((directory) => {
  const good = sourceFile(directory, "Good.fcg");
  for (const body of ['var value=[1,2]', 'var value Foo<Bar>=nil', 'var value=SpawnInfo{1,2}', 'var value=LocString{"KEY"}']) {
    const input = compact.replace("func Noop(){}", "func Noop(){" + body + "}");
    const bad = sourceFile(directory, "Bad.fcg", input);
    const result = cli(directory, ["--write", good, bad]);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(fs.readFileSync(good, "utf8"), compact);
    assert.equal(fs.readFileSync(bad, "utf8"), input);
  }
}));

test("invalid operator input exits 2 and preflight prevents every source write", () => fixture((directory) => {
  const good = sourceFile(directory, "Good.fcg");
  const invalid = compact.replace("func Noop(){}", "func Noop(){a + = b}");
  const bad = sourceFile(directory, "Bad.fcg", invalid);
  const write = cli(directory, ["--write", good, bad]);
  assert.equal(write.status, 2, write.stderr);
  assert.match(write.stderr, /operand/);
  assert.equal(fs.readFileSync(good, "utf8"), compact);
  assert.equal(fs.readFileSync(bad, "utf8"), invalid);
  const stdin = cli(directory, ["--stdin-filepath", bad], invalid);
  assert.equal(stdin.status, 2);
  assert.equal(stdin.stdout, "");
}));

test("config precedence, glob order and provenance are explicit", () => fixture((directory) => {
  const file = sourceFile(directory, "sub/Demo.fcg");
  fs.writeFileSync(join(directory, ".editorconfig"), [
    "root = true", "[*]", "indent_size = 4", "end_of_line = crlf",
    "[*.fcg]", "insert_final_newline = false", "",
  ].join("\n"));
  fs.writeFileSync(join(directory, ".fcfmt.json"), JSON.stringify({
    printWidth: 50,
    indent: { size: 3 },
    overrides: [
      { files: "**/*.fcg", options: { printWidth: 60 } },
      { files: "sub/*.fcg", options: { printWidth: 70, wrap: { conditions: "always" } } },
    ],
  }));

  const result = cli(directory, ["--explain-config", file, "--print-width=90"]);
  assert.equal(result.status, 0, result.stderr);
  const explained = JSON.parse(result.stdout);
  assert.equal(explained.options.printWidth, 90);
  assert.equal(explained.provenance.printWidth, "CLI");
  assert.equal(explained.options.indent.size, 3);
  assert.match(explained.provenance["indent.size"], /\.fcfmt\.json$/);
  assert.equal(explained.options.endOfLine, "crlf");
  assert.match(explained.provenance.endOfLine, /\.editorconfig:4$/);
  assert.equal(explained.options.finalNewline, false);
  assert.equal(explained.options.wrap.conditions, "always");
  assert.match(explained.provenance["wrap.conditions"], /overrides\[1\]$/);
}));

test("stdout, stdin, check, diff and write obey exit codes and explicit writes", () => fixture((directory) => {
  const path = sourceFile(directory);
  const originalMode = fs.statSync(path).mode & 0o777;
  const stdout = cli(directory, [path]);
  assert.equal(stdout.status, 0, stdout.stderr);
  assert.equal(stdout.stdout, formatted);
  assert.equal(stdout.stdout, formatSource(compact, "fcg").output);
  assert.equal(fs.readFileSync(path, "utf8"), compact);

  const stdin = cli(directory, ["--stdin-filepath", path], compact);
  assert.equal(stdin.status, 0, stdin.stderr);
  assert.equal(stdin.stdout, formatted);

  const check = cli(directory, ["--check", path]);
  assert.equal(check.status, 1, check.stderr);
  assert.match(check.stdout, /Demo\.fcg/);
  assert.equal(fs.readFileSync(path, "utf8"), compact);

  const diff = cli(directory, ["--diff", path]);
  assert.equal(diff.status, 0, diff.stderr);
  assert.match(diff.stdout, /^--- a\/Demo\.fcg/m);
  assert.match(diff.stdout, /^@@ -/m);
  assert.equal(cli(directory, ["--check", "--diff", path]).status, 1);
  assert.equal(fs.readFileSync(path, "utf8"), compact);

  const write = cli(directory, ["--write", path]);
  assert.equal(write.status, 0, write.stderr);
  assert.equal(fs.readFileSync(path, "utf8"), formatted);
  assert.equal(fs.statSync(path).mode & 0o777, originalMode);
  assert.equal(cli(directory, ["--check", path]).status, 0);
  assert.equal(cli(directory, [directory]).status, 2);
  assert.equal(cli(directory, ["--write", "--diff", path]).status, 2);
}));

test("directory discovery excludes internal folders and honors both ignore sources", () => fixture((directory) => {
  const included = sourceFile(directory, "sub/keep.fcg");
  sourceFile(directory, "sub/skip.fcg");
  sourceFile(directory, "dist/build.fcg");
  sourceFile(directory, "node_modules/package.fcg");
  fs.writeFileSync(join(directory, ".fcfmt.json"), JSON.stringify({ ignore: ["sub/skip.fcg", "sub/keep.fcg"] }));
  fs.writeFileSync(join(directory, ".fcfmtignore"), "# excluded manually\n*.fcg\n!sub/keep.fcg\n");

  const result = cli(directory, ["--check", directory]);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout.trim(), included);
  assert.equal(fs.readFileSync(included, "utf8"), compact);
  assert.equal(matchesGlob(included, directory, "**/*.fcg"), true);

  const explained = JSON.parse(cli(directory, ["--explain-config", included]).stdout);
  assert.equal(explained.ignored, false);
  assert.match(explained.ignoreReason, /!sub\/keep\.fcg$/);
}));

test("bad config, parse errors and missing files fail without partial writes", () => fixture((directory) => {
  const good = sourceFile(directory, "good.fcg");
  const bad = sourceFile(directory, "bad.fcg", "graph Demo {}");

  const preflight = cli(directory, ["--write", good, bad]);
  assert.equal(preflight.status, 2);
  assert.match(preflight.stderr, /bad\.fcg:1:1:/);
  assert.equal(fs.readFileSync(good, "utf8"), compact);

  const missing = cli(directory, ["--write", good, join(directory, "missing.fcg")]);
  assert.equal(missing.status, 2);
  assert.equal(fs.readFileSync(good, "utf8"), compact);

  for (const invalid of [
    '{"unknown": true}',
    '{"wrap": {"calls": "sometimes"}}',
    '{"printWidth": 80,}',
  ]) {
    fs.writeFileSync(join(directory, ".fcfmt.json"), invalid);
    const result = cli(directory, ["--check", good]);
    assert.equal(result.status, 2, invalid);
    assert.equal(fs.readFileSync(good, "utf8"), compact);
  }
}));

test("init never overwrites, and an atomic rename failure keeps original bytes", () => fixture((directory) => {
  const configPath = join(directory, "custom.json");
  const init = cli(directory, ["--init", "--config", configPath, "--print-width", "96"]);
  assert.equal(init.status, 0, init.stderr);
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).printWidth, 96);
  assert.equal(cli(directory, ["--init", "--config", configPath]).status, 2);

  const path = sourceFile(directory);
  const bytes = fs.readFileSync(path);
  const simulatedIo = { ...fs, renameSync: () => {
    const error = new Error("simulated permission denial");
    error.code = "EACCES";
    throw error;
  } };

  assert.throws(() => commitFile({ path, bytes, output: formatted }, simulatedIo), /simulated permission denial/);
  assert.deepEqual(fs.readFileSync(path), bytes);
  assert.equal(fs.readdirSync(directory).some((name) => name.endsWith(".fcfmt-tmp")), false);
}));

test("Windows paths with spaces and CRLF style work through stdin", () => fixture((directory) => {
  const path = sourceFile(directory, "nested folder/Space Demo.fcg");
  fs.writeFileSync(join(directory, ".fcfmt.json"), JSON.stringify({ endOfLine: "crlf" }));

  const result = cli(directory, ["--stdin-filepath", path], compact);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes("\r\n"));
  assert.equal(fs.readFileSync(path, "utf8"), compact);
}));

test("project style options reach the printer without changing comments", () => fixture((directory) => {
  const comment = "// protected  \t";
  const source = [
    'import "StdLibrary.fcc" as StdLibrary',
    "graph Demo {",
    "  func Run() {",
    `    ${comment}`,
    "    DoSomething(1,2)",
    "  }",
    "}",
  ].join("\n");
  const path = sourceFile(directory, "Styled.fcg", source);
  fs.writeFileSync(join(directory, ".fcfmt.json"), JSON.stringify({
    indent: { style: "tab", size: 4 },
    wrap: { calls: "always" },
  }));

  const result = cli(directory, ["--stdin-filepath", path], source);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(comment));
  assert.match(result.stdout, /\n\tfunc Run/);
  assert.match(result.stdout, /DoSomething\(\n/);
  assert.equal(fs.readFileSync(path, "utf8"), source);
}));

test("spacing and blank-line settings resolve across config, override, and CLI", () => fixture((directory) => {
  const source = [
    'import "StdLibrary.fcc" as StdLibrary',
    "graph Demo {",
    "  func Run() {",
    "    var value = List<int>{1, 2}",
    "  }",
    "}",
  ].join("\n");
  const path = sourceFile(directory, "sub/Demo.fcg", source);
  fs.writeFileSync(join(directory, ".fcfmt.json"), JSON.stringify({
    spacing: { assignment: "compact" },
    blankLines: { afterImports: "never" },
    overrides: [{ files: "sub/*.fcg", options: { spacing: { comma: "compact" } } }],
  }));

  const result = cli(directory, ["--stdin-filepath", path, "--blank-lines-max", "0"], source);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /var value=List<int>\{1,2\}/);
  assert.doesNotMatch(result.stdout, /\n\n/);
  assert.equal(fs.readFileSync(path, "utf8"), source);

  const explained = cli(directory, ["--explain-config", path, "--blank-lines-max", "0"]);
  assert.equal(explained.status, 0, explained.stderr);
  const config = JSON.parse(explained.stdout);
  assert.equal(config.options.spacing.assignment, "compact");
  assert.match(config.provenance["spacing.comma"], /overrides\[0\]$/);
  assert.equal(config.provenance["blankLines.maxConsecutive"], "CLI");

  fs.writeFileSync(join(directory, ".fcfmt.json"), '{"blankLines":{"maxConsecutive":3}}');
  assert.equal(cli(directory, ["--check", path]).status, 2);
}));

test("explicit symlinks are refused and discovered symlinks are skipped", (context) => fixture((directory) => {
  const target = sourceFile(directory, "real.fcg");
  const link = join(directory, "link.fcg");

  try {
    fs.symlinkSync(target, link, "file");
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      context.skip("This Windows account cannot create symlinks.");
      return;
    }

    throw error;
  }

  const explicit = cli(directory, ["--write", link]);
  assert.equal(explicit.status, 2);
  assert.match(explicit.stderr, /symbolic-link input/);

  const discovered = cli(directory, ["--check", directory]);
  assert.equal(discovered.status, 1, discovered.stderr);
  assert.equal(discovered.stdout.trim(), target);
}));
