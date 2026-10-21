import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FormatCache, hashConfigLeaves, hashContent } from "../src/cache.mjs";

const cliScript = fileURLToPath(new URL("../bin/fcfmt.mjs", import.meta.url));

function fixture(callback) {
  const directory = fs.mkdtempSync(join(tmpdir(), "fcfmt-cache-test-"));

  try {
    fs.mkdirSync(join(directory, ".git"));
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function runCli(directory, args, input) {
  return spawnSync(process.execPath, [cliScript, ...args], {
    cwd: directory,
    input,
    encoding: "utf8",
  });
}

function createSourceFile(directory, relativePath, content) {
  const absolute = join(directory, relativePath);
  fs.mkdirSync(dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
  return absolute;
}

test("FormatCache unit: initial load, persistence, and hit detection", () => fixture((directory) => {
  const cachePath = join(directory, ".fcfmtcache");
  const cache = FormatCache.load(cachePath, { version: "1.0.0" });

  assert.equal(cache.entries.size, 0);

  const testFile = createSourceFile(directory, "Sample.fcg", 'import "StdLibrary.fcc" as Std\n\ngraph Sample {\n}\n');
  const leaves = { printWidth: 100, "indent.style": "space", "indent.size": 2 };
  const content = fs.readFileSync(testFile);

  assert.equal(cache.isHit(testFile, leaves), false);

  cache.set(testFile, leaves, content);
  assert.equal(cache.isHit(testFile, leaves), true);

  cache.save();
  assert.equal(fs.existsSync(cachePath), true);

  // Reload cache from disk
  const reloaded = FormatCache.load(cachePath, { version: "1.0.0" });
  assert.equal(reloaded.entries.size, 1);
  assert.equal(reloaded.isHit(testFile, leaves), true);
}));

test("FormatCache unit: invalidates on content or config modification", () => fixture((directory) => {
  const cachePath = join(directory, ".fcfmtcache");
  const cache = FormatCache.load(cachePath, { version: "1.0.0" });
  const testFile = createSourceFile(directory, "Sample.fcg", 'import "StdLibrary.fcc" as Std\n\ngraph Sample {\n}\n');
  const leaves = { printWidth: 100, "indent.style": "space" };

  cache.set(testFile, leaves, fs.readFileSync(testFile));
  assert.equal(cache.isHit(testFile, leaves), true);

  // Config change invalidates cache
  const modifiedLeaves = { printWidth: 80, "indent.style": "space" };
  assert.equal(cache.isHit(testFile, modifiedLeaves), false);

  // Content edit invalidates cache
  fs.writeFileSync(testFile, 'import "StdLibrary.fcc" as Std\n\ngraph Modified {\n}\n', "utf8");
  assert.equal(cache.isHit(testFile, leaves), false);
}));

test("FormatCache unit: touch with identical content remains a cache hit", () => fixture((directory) => {
  const cachePath = join(directory, ".fcfmtcache");
  const cache = FormatCache.load(cachePath, { version: "1.0.0" });
  const testFile = createSourceFile(directory, "Sample.fcg", 'import "StdLibrary.fcc" as Std\n\ngraph Sample {\n}\n');
  const leaves = { printWidth: 100 };

  cache.set(testFile, leaves, fs.readFileSync(testFile));
  assert.equal(cache.isHit(testFile, leaves), true);

  // Simulate touch by updating mtime with unchanged bytes
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(testFile, future, future);

  assert.equal(cache.isHit(testFile, leaves), true);
}));

test("FormatCache unit: handles corrupt cache file gracefully", () => fixture((directory) => {
  const cachePath = join(directory, ".fcfmtcache");
  fs.writeFileSync(cachePath, "INVALID NOT JSON {[[", "utf8");

  const cache = FormatCache.load(cachePath, { version: "1.0.0" });
  assert.equal(cache.entries.size, 0);

  const testFile = createSourceFile(directory, "Sample.fcg", "graph G {}\n");
  cache.set(testFile, {}, fs.readFileSync(testFile));
  cache.save();

  const reloaded = FormatCache.load(cachePath, { version: "1.0.0" });
  assert.equal(reloaded.entries.size, 1);
}));

test("FormatCache unit: version mismatch discards older cache", () => fixture((directory) => {
  const cachePath = join(directory, ".fcfmtcache");
  const cacheV1 = FormatCache.load(cachePath, { version: "1.0.0" });
  const testFile = createSourceFile(directory, "Sample.fcg", "graph G {}\n");

  cacheV1.set(testFile, {}, fs.readFileSync(testFile));
  cacheV1.save();

  // Load with upgraded version
  const cacheV2 = FormatCache.load(cachePath, { version: "2.0.0" });
  assert.equal(cacheV2.entries.size, 0);
}));

test("CLI e2e: --cache with --check creates cache and avoids re-formatting on second run", () => fixture((directory) => {
  const formattedSource = 'import "StdLibrary.fcc" as StdLibrary\n\ngraph Demo {\n  func Noop() {}\n}\n';
  const file1 = createSourceFile(directory, "File1.fcg", formattedSource);
  const file2 = createSourceFile(directory, "File2.fcg", formattedSource);
  const cachePath = join(directory, ".fcfmtcache");

  // First run: checks files and initializes cache
  const firstRun = runCli(directory, ["--cache", "--check", file1, file2]);
  assert.equal(firstRun.status, 0, firstRun.stderr);
  assert.equal(fs.existsSync(cachePath), true);

  const cacheData = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  assert.equal(Object.keys(cacheData.entries).length, 2);

  // Second run: cache hit
  const secondRun = runCli(directory, ["--cache", "--check", file1, file2]);
  assert.equal(secondRun.status, 0, secondRun.stderr);
}));

test("CLI e2e: --cache with --write formats unformatted files and skips clean cached files", () => fixture((directory) => {
  const unformatted = 'import "StdLibrary.fcc" as StdLibrary\ngraph Demo{func Noop(){}}';
  const file = createSourceFile(directory, "Target.fcg", unformatted);
  const cachePath = join(directory, ".custom-cache");

  // First run writes formatted file and saves cache
  const firstRun = runCli(directory, ["--cache-location", cachePath, "--write", file]);
  assert.equal(firstRun.status, 0, firstRun.stderr);
  assert.match(firstRun.stdout, /Wrote/);
  assert.equal(fs.existsSync(cachePath), true);

  // Second run: file is in cache and clean, 0 writes performed
  const secondRun = runCli(directory, ["--cache-location", cachePath, "--write", file]);
  assert.equal(secondRun.status, 0, secondRun.stderr);
  assert.equal(secondRun.stdout, "");
}));

test("CLI e2e: --cache invalidates when config changes or CLI flag overrides", () => fixture((directory) => {
  const source = 'import "StdLibrary.fcc" as StdLibrary\n\ngraph Demo {\n  func Noop() {}\n}\n';
  const file = createSourceFile(directory, "Demo.fcg", source);
  const configFile = createSourceFile(directory, ".fcfmt.json", JSON.stringify({ "indent.size": 2 }, null, 2) + "\n");

  const run1 = runCli(directory, ["--cache", "--check", file]);
  assert.equal(run1.status, 0, run1.stderr);

  // Override indent.size to 4 via CLI flag causes format mismatch and cache miss
  const runWithFlag = runCli(directory, ["--cache", "--check", "--indent-size", "4", file]);
  assert.equal(runWithFlag.status, 1);

  // Change project config file to indent.size 4
  fs.writeFileSync(configFile, JSON.stringify({ "indent.size": 4 }, null, 2) + "\n", "utf8");
  const runWithConfigChange = runCli(directory, ["--cache", "--check", file]);
  assert.equal(runWithConfigChange.status, 1);
}));

test("CLI e2e: --cache-strategy content works with content-based hashing", () => fixture((directory) => {
  const formattedSource = 'import "StdLibrary.fcc" as StdLibrary\n\ngraph Demo {\n  func Noop() {}\n}\n';
  const file = createSourceFile(directory, "ContentTest.fcg", formattedSource);

  const run1 = runCli(directory, ["--cache", "--cache-strategy", "content", "--check", file]);
  assert.equal(run1.status, 0, run1.stderr);

  const run2 = runCli(directory, ["--cache", "--cache-strategy", "content", "--check", file]);
  assert.equal(run2.status, 0, run2.stderr);
}));

test("CLI e2e: --diff with --cache outputs nothing when files are clean", () => fixture((directory) => {
  const formattedSource = 'import "StdLibrary.fcc" as StdLibrary\n\ngraph CleanGraph {\n  func Action() {}\n}\n';
  const file = createSourceFile(directory, "Clean.fcg", formattedSource);

  const run1 = runCli(directory, ["--cache", "--diff", file]);
  assert.equal(run1.status, 0, run1.stderr);
  assert.equal(run1.stdout, "");

  const run2 = runCli(directory, ["--cache", "--diff", file]);
  assert.equal(run2.status, 0, run2.stderr);
  assert.equal(run2.stdout, "");
}));

test("CLI e2e: multi-file partial cache invalidation on game modules", () => fixture((directory) => {
  const files = [];

  // Generate 5 game modules inspired by Craftland project components
  for (let index = 1; index <= 5; index += 1) {
    const code = [
      'import "StdLibrary.fcc" as StdLibrary',
      "",
      `[platform_server]`,
      `static graph BattleModule_${index} {`,
      `  _MODULE_ID int = ${index}`,
      "",
      "  func ExecuteTurn(turnNumber int) {",
      "    if (turnNumber > 0) {",
      "      return",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");

    files.push(createSourceFile(directory, `Scripts/Module_${index}.fcg`, code));
  }

  // First run: checks all 5 files, populates cache
  const run1 = runCli(directory, ["--cache", "--check", "Scripts"]);
  assert.equal(run1.status, 0, run1.stderr);

  const cachePath = join(directory, ".fcfmtcache");
  assert.equal(fs.existsSync(cachePath), true);
  const cache1 = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  assert.equal(Object.keys(cache1.entries).length, 5);

  // Modify only Module_3
  fs.writeFileSync(files[2], 'import "StdLibrary.fcc" as StdLibrary\ngraph Unformatted3{}', "utf8");

  // Check fails because Module_3 is unformatted
  const checkFail = runCli(directory, ["--cache", "--check", "Scripts"]);
  assert.equal(checkFail.status, 1);

  // Format with --write: formats only Module_3
  const writeRun = runCli(directory, ["--cache", "--write", "Scripts"]);
  assert.equal(writeRun.status, 0, writeRun.stderr);
  assert.match(writeRun.stdout, /Module_3\.fcg/);
  // Other files should NOT be reported as wrote because they were already clean in cache
  assert.doesNotMatch(writeRun.stdout, /Module_1\.fcg/);
  assert.doesNotMatch(writeRun.stdout, /Module_2\.fcg/);

  // Third run: everything is cached and clean
  const cleanRun = runCli(directory, ["--cache", "--check", "Scripts"]);
  assert.equal(cleanRun.status, 0, cleanRun.stderr);
}));

test("FormatCache unit: prune removes stale entries of deleted files", () => fixture((directory) => {
  const cachePath = join(directory, ".fcfmtcache");
  const cache = FormatCache.load(cachePath, { version: "1.0.0" });
  const fileA = createSourceFile(directory, "FileA.fcg", "graph A {}\n");
  const fileB = createSourceFile(directory, "FileB.fcg", "graph B {}\n");

  cache.set(fileA, {}, fs.readFileSync(fileA));
  cache.set(fileB, {}, fs.readFileSync(fileB));
  assert.equal(cache.entries.size, 2);

  // Delete FileB
  fs.unlinkSync(fileB);
  cache.prune();

  assert.equal(cache.entries.size, 1);
  assert.equal(cache.entries.has(resolve(fileA)), true);
  assert.equal(cache.entries.has(resolve(fileB)), false);
}));
