import assert from "node:assert/strict";
import test from "node:test";
import { lexWithOracle, parseWithOracle } from "../src/grammar/extension-oracle.mjs";

const base = [
  'import "StdLibrary.fcc" as StdLibrary // import note  ',
  "/** graph docs  ",
  " * second line */",
  "graph Demo {",
  "  func Run() {",
  "    // fc-format-ignore",
  "    var value = " + String.fromCharCode(96) + "first  ",
  "second" + String.fromCharCode(96),
  "    /* block note  ",
  "       second line */",
  "  }",
  "}",
  "",
].join("\r\n");

test("CRLF comments and raw strings retain exact token spans", () => {
  const parsed = parseWithOracle(base, "fcg");
  assert.equal(parsed.accepted, true, JSON.stringify(parsed.errors));
  const lexed = lexWithOracle(base);
  assert.deepEqual(lexed.errors, []);

  for (const token of lexed.tokens) {
    if (token.type === -1 || token.start === token.end) {
      continue;
    }

    assert.equal(base.slice(token.start, token.end), token.text, token.name);
  }
  assert.ok(lexed.tokens.some((token) =>
    token.name === "COMMENT" && token.text.includes("/** graph docs  \r\n")));
  assert.ok(lexed.tokens.some((token) =>
    token.name === "LINE_COMMENT" && token.text === "// fc-format-ignore"));
  assert.ok(lexed.tokens.some((token) =>
    token.name === "RAW_STRING_LIT" && token.text.includes("first  \r\nsecond")));
  assert.ok(lexed.tokens.some((token) =>
    token.text === "\r\n"));
});

test("a UTF-8 BOM is rejected by the pinned grammar", () => {
  const source = "\uFEFF" + base;
  const parsed = parseWithOracle(source, "fcg");
  assert.equal(parsed.accepted, false);
  assert.ok(parsed.errors.some((error) => error.phase === "lexer"));
});

test("duplicate imports and aliases are syntactically accepted", () => {
  const source = [
    'import "StdLibrary.fcc" as StdLibrary',
    'import "StdLibrary.fcc" as Other',
    "graph Demo {}",
    "",
  ].join("\n");
  const parsed = parseWithOracle(source, "fcg");
  assert.equal(parsed.accepted, true, JSON.stringify(parsed.errors));
});
