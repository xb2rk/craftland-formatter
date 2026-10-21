import assert from "node:assert/strict";
import test from "node:test";

import { computeLineHunks, unifiedDiff } from "../src/diff.mjs";

test("computeLineHunks: returns empty array for identical texts", () => {
  const source = "graph Demo {\n  func Action() {}\n}\n";
  const hunks = computeLineHunks(source, source);
  assert.equal(hunks.length, 0);
});

test("computeLineHunks: detects single-line modification in the middle", () => {
  const before = "line 1\nline 2\nline 3\n";
  const after = "line 1\nline two changed\nline 3\n";
  const hunks = computeLineHunks(before, after);

  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].oldStartLine, 1);
  assert.equal(hunks[0].oldLineCount, 1);
  assert.equal(hunks[0].newStartLine, 1);
  assert.equal(hunks[0].newLineCount, 1);
  assert.equal(hunks[0].newText, "line two changed\n");
  assert.equal(hunks[0].oldText, "line 2\n");
});

test("computeLineHunks: detects pure line insertion", () => {
  const before = "line 1\nline 2\n";
  const after = "line 1\ninserted line\nline 2\n";
  const hunks = computeLineHunks(before, after);

  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].oldStartLine, 1);
  assert.equal(hunks[0].oldLineCount, 0);
  assert.equal(hunks[0].newStartLine, 1);
  assert.equal(hunks[0].newLineCount, 1);
  assert.equal(hunks[0].newText, "inserted line\n");
  assert.equal(hunks[0].oldText, "");
});

test("computeLineHunks: detects pure line deletion", () => {
  const before = "line 1\nline to delete\nline 2\n";
  const after = "line 1\nline 2\n";
  const hunks = computeLineHunks(before, after);

  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].oldStartLine, 1);
  assert.equal(hunks[0].oldLineCount, 1);
  assert.equal(hunks[0].newStartLine, 1);
  assert.equal(hunks[0].newLineCount, 0);
  assert.equal(hunks[0].newText, "");
  assert.equal(hunks[0].oldText, "line to delete\n");
});

test("computeLineHunks: detects multiple disconnected hunks across a document", () => {
  const before = [
    "line 0 unchanged",
    "line 1 old A",
    "line 2 unchanged",
    "line 3 unchanged",
    "line 4 old B",
    "line 5 unchanged",
  ].join("\n") + "\n";

  const after = [
    "line 0 unchanged",
    "line 1 new A",
    "line 2 unchanged",
    "line 3 unchanged",
    "line 4 new B",
    "line 5 unchanged",
  ].join("\n") + "\n";

  const hunks = computeLineHunks(before, after);

  assert.equal(hunks.length, 2);

  // First hunk at line 1
  assert.equal(hunks[0].oldStartLine, 1);
  assert.equal(hunks[0].oldLineCount, 1);
  assert.equal(hunks[0].newText, "line 1 new A\n");

  // Second hunk at line 4
  assert.equal(hunks[1].oldStartLine, 4);
  assert.equal(hunks[1].oldLineCount, 1);
  assert.equal(hunks[1].newText, "line 4 new B\n");
});

test("computeLineHunks: preserves CRLF line endings in hunks", () => {
  const before = "header\r\nline old\r\nfooter\r\n";
  const after = "header\r\nline new\r\nfooter\r\n";
  const hunks = computeLineHunks(before, after);

  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].newText, "line new\r\n");
  assert.equal(hunks[0].oldText, "line old\r\n");
});

test("unifiedDiff: maintains existing output format", () => {
  const before = "a\nb\nc\n";
  const after = "a\nx\nc\n";
  const diff = unifiedDiff(before, after, "test.fcg");

  assert.match(diff, /--- a\/test\.fcg/);
  assert.match(diff, /\+\+\+ b\/test\.fcg/);
  assert.match(diff, /-b/);
  assert.match(diff, /\+x/);
});
