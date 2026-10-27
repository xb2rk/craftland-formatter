import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { grammarMetadata, lexWithOracle, loadExtensionOracle, parseWithOracle } from "../src/grammar/extension-oracle.mjs";

const importLine = 'import "StdLibrary.fcc" as StdLibrary\n';

test("loads exactly the pinned parser inventory", () => {
  const metadata = grammarMetadata();
  assert.equal(metadata.baseline.version, "1.11.1");
  assert.equal(metadata.ruleNames.length, 124);
  assert.equal(metadata.ruleNames[44], "graphFile");
  assert.equal(metadata.ruleNames[123], "eos");
  assert.equal(loadExtensionOracle().sha256, metadata.baseline.sha256);
});

test("lexes a complete graph including its import", () => {
  const result = lexWithOracle(importLine + "graph Demo {}\n");
  assert.deepEqual(result.errors, []);
  assert.equal(result.tokens.at(-1).type, -1);
  assert.ok(result.tokens.some((token) => token.text === "graph"));
});

test("accepts compact graph, function, and control-flow blocks", () => {
  const sources = [
    importLine + "graph Demo {}\n",
    importLine + "graph Demo {\n  func Noop() {}\n}\n",
    importLine + "graph Demo {\n  func Noop() {\n    if true {}\n  }\n}\n",
  ];
  for (const source of sources) {
    const result = parseWithOracle(source, "fcg");
    assert.equal(result.accepted, true, JSON.stringify(result.errors));
    assert.ok(result.ruleIndices.includes(44));
  }
});

test("rejects missing import and unfinished blocks", () => {
  const missingImport = parseWithOracle("graph Demo {}\n", "fcg");
  assert.equal(missingImport.accepted, false);
  assert.ok(missingImport.errors.length > 0);

  const unfinished = parseWithOracle(importLine + "graph Demo {", "fcg");
  assert.equal(unfinished.accepted, false);
  assert.ok(unfinished.errors.length > 0);
});

test("rejects a different syntax bundle hash", () => {
  const path = join(tmpdir(), "fc-format-v5-wrong-bundle-" + randomUUID() + ".js");
  writeFileSync(path, "module.exports = {};", "utf8");
  try {
    assert.throws(() => grammarMetadata(path), /grammar hash mismatch/);
  } finally {
    unlinkSync(path);
  }
});

test("uses sourceFile and rejects a mismatched file extension", () => {
  const source = importLine + "graph Demo {}\n";
  const graph = parseWithOracle(source, "fcg");
  assert.ok(graph.ruleIndices.includes(0));
  assert.equal(graph.observedEntryIndex, 44);

  const mislabeled = parseWithOracle(source, "fcc");
  assert.equal(mislabeled.accepted, false);
  assert.ok(mislabeled.errors.some((error) => error.phase === "file-kind"));
});

test("rare fixtures reach the five rules absent from the sampled corpora", () => {
  const fixtures = JSON.parse(readFileSync(new URL("../grammar/rare-fixtures.json", import.meta.url), "utf8"));
  const exercised = new Set();
  for (const fixture of fixtures) {
    const result = parseWithOracle(fixture.source, fixture.kind);
    assert.equal(result.accepted, true, fixture.name + ": " + JSON.stringify(result.errors));
    for (const index of fixture.expectedRuleIndices) {
      assert.ok(result.ruleIndices.includes(index), fixture.name + " did not reach rule " + index);
      exercised.add(index);
    }
  }
  assert.deepEqual([...exercised].sort((a, b) => a - b), [5, 24, 43, 56, 87]);
});