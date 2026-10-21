import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatSource } from "../src/format/formatter.js";
import { lex } from "../src/lex/lexer.js";
import { parseDomainType, parseExpression } from "../src/parser/type-expression-parser.js";
import { parseGraphFile, parseHeaderFile } from "../src/parser/file-parser.js";
import { getRepositoryRoot } from "./helpers/workspace.js";

const SYNTAX_DOC = join(getRepositoryRoot(), ".craftland", "agents", "references", "fc-syntax.md");

interface DocExample {
  readonly code: string;
  readonly index: number;
  readonly section: string;
}

/**
 * Doc fences that pin current parser behavior instead of asserting clean.
 * Each entry matches a fence by distinctive substring and records why the
 * documented syntax does not parse yet. If an entry starts parsing clean,
 * the test fails so the exemption gets removed — that is the point.
 */
const KNOWN_GAPS: readonly { readonly match: string; readonly reason: string }[] = [
  {
    match: "[readonly]",
    reason:
      "keyword-lexed decorator names (readonly/accept/bridging/combine) are rejected by parseName; " +
      "fccompile accepts them (exit 0 on graph fields and header declarations), so this is a real " +
      "parser gap needing new-syntax work, not a fence fix",
  },
  {
    match: "var callback = func(",
    reason:
      "anonymous func literals are not expressions in the parser (func cannot start a statement either); " +
      "fccompile compiles them (exit 0), confirming a real gap: literal grammar, binder type, formatter role",
  },
];

/**
 * "Wrong" patterns that parse clean anyway. Same contract as KNOWN_GAPS:
 * the laxity is locked in, and tightening the parser flips the test so the
 * entry gets removed rather than silently drifting.
 */
const WRONG_OK: readonly { readonly match: string; readonly reason: string }[] = [
  {
    match: "Vector3(1, 2, 3)",
    reason:
      "parses as a call expression; fccompile parse-rejects it (missing '{' at '('), but our parser " +
      "cannot reject without name resolution, so the fix belongs in binder/linter, not the grammar",
  },
  {
    match: "Temp/UGCLanguage/packages",
    reason:
      "syntactically a valid import (fccompile parses it, then fails resolution late with " +
      "file-path-not-found); the wrongness is conventional, linter-level at most",
  },
];

type Rung = "graph-file" | "header-file" | "expression" | "type" | "member" | "statement";

/** Most specific first: a fragment that parses as an expression must not hide behind a statement wrap. */
const LADDER: readonly Rung[] = ["graph-file", "header-file", "expression", "type", "member", "statement"];

function extractExamples(markdown: string): DocExample[] {
  const examples: DocExample[] = [];
  const counts = new Map<string, number>();
  let section = "";
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const heading = line.match(/^##\s+(.+?)\s*$/u);
    if (heading) {
      section = heading[1]!;
      i += 1;
      continue;
    }
    if (line.trim() === "```fcg") {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && lines[i]!.trim() !== "```") {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1;
      const index = counts.get(section) ?? 0;
      counts.set(section, index + 1);
      examples.push({ code: body.join("\n"), index, section });
    } else {
      i += 1;
    }
  }
  return examples;
}

function contentLines(code: string): string[] {
  return code
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("//"));
}

function rungSource(rung: Rung, text: string): { readonly fileName: string; readonly source: string } {
  switch (rung) {
    case "graph-file":
      return { fileName: "DocProbe.fcg", source: text };
    case "header-file":
      return { fileName: "DocProbe.fcc", source: text };
    case "member":
      return { fileName: "DocProbe.fcg", source: `graph DocProbe {\n${text}\n}\n` };
    case "statement":
      return { fileName: "DocProbe.fcg", source: `graph DocProbe {\nfunc DocProbe() {\n${text}\n}\n}` };
    case "expression":
    case "type":
      return { fileName: "DocProbe.fcg", source: text };
  }
}

function checkClean(rung: Rung, text: string): { readonly clean: boolean; readonly detail: string } {
  const fail = (detail: string) => ({ clean: false as const, detail });
  if (rung === "expression" || rung === "type") {
    const lexed = lex(text);
    if (lexed.diagnostics.length > 0) return fail(`lex: ${lexed.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ")}`);
    const parsed = rung === "expression" ? parseExpression(lexed) : parseDomainType(lexed);
    if (parsed.diagnostics.length > 0 || !parsed.consumedThroughEof) {
      return fail(parsed.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ") || "trailing input");
    }
    return { clean: true as const, detail: rung };
  }
  const { fileName, source } = rungSource(rung, text);
  const lexed = lex(source);
  if (lexed.diagnostics.length > 0) return fail(`lex: ${lexed.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ")}`);
  const parsed = fileName.endsWith(".fcc") ? parseHeaderFile(lexed) : parseGraphFile(lexed);
  if (parsed.diagnostics.length > 0 || !parsed.consumedThroughEof) {
    return fail(parsed.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ") || "trailing input");
  }
  return { clean: true as const, detail: rung };
}

/** File-rung examples additionally prove the formatter accepts and stabilizes them. */
function checkStable(rung: Rung, text: string, label: string): void {
  if (rung !== "graph-file" && rung !== "header-file" && rung !== "member" && rung !== "statement") return;
  const { fileName, source } = rungSource(rung, text);
  const result = formatSource(source, { fileName });
  expect(result.diagnostics, `${label} formats clean`).toEqual([]);
  expect(result.code, `${label} produces code`).toBeDefined();
  const second = formatSource(result.code!, { fileName });
  expect(second.diagnostics, `${label} reformats clean`).toEqual([]);
  expect(second.code, `${label} is idempotent`).toBe(result.code);
}

function splitWrongCorrect(code: string): { readonly correct: string; readonly wrong: string }[] {
  const pairs: { readonly correct: string; readonly wrong: string }[] = [];
  let current: string[] | undefined;
  let marker: "wrong" | "correct" | undefined;
  const flush = () => {
    if (current !== undefined && marker !== undefined) {
      const text = current.join("\n").trim();
      if (marker === "wrong") pairs.push({ correct: "", wrong: text });
      else if (pairs.length > 0) pairs[pairs.length - 1] = { correct: text, wrong: pairs[pairs.length - 1]!.wrong };
    }
    current = [];
    marker = undefined;
  };
  for (const line of code.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "// Wrong" || trimmed === "// Correct") {
      flush();
      marker = trimmed === "// Wrong" ? "wrong" : "correct";
      current = [];
    } else {
      (current ??= []).push(line);
    }
  }
  flush();
  return pairs.filter((pair) => pair.wrong !== "" && pair.correct !== "");
}

function checkWrongPatterns(example: DocExample): void {
  const label = `${example.section}[${example.index}]`;
  const pairs = splitWrongCorrect(example.code);
  expect(pairs.length, `${label} has Wrong/Correct pairs`).toBeGreaterThan(0);
  for (const pair of pairs) {
    const rung = LADDER.find((candidate) => checkClean(candidate, pair.correct).clean);
    expect(rung, `${label} Correct parses:\n${pair.correct}`).toBeDefined();
    checkStable(rung!, pair.correct, `${label} Correct`);
    const allowed = WRONG_OK.find((entry) => pair.wrong.includes(entry.match));
    const result = checkClean(rung!, pair.wrong);
    if (allowed) {
      expect(result.clean, `${label} Wrong stays accepted (${allowed.reason}):\n${pair.wrong}`).toBe(true);
    } else {
      expect(result.clean, `${label} Wrong parses at ${rung} but must not:\n${pair.wrong}`).toBe(false);
    }
  }
}

function checkExample(example: DocExample): void {
  const label = `${example.section}[${example.index}]`;
  const gap = KNOWN_GAPS.find((entry) => example.code.includes(entry.match));
  if (gap) {
    const result = checkClean("header-file", example.code);
    expect(result.clean, `${label} gap closed, remove the exemption (${gap.reason})`).toBe(false);
    return;
  }
  const isGraphFile = /^graph /mu.test(example.code) || /^\[/mu.test(example.code);
  switch (example.section) {
    case "File Forms":
    case "Decorators":
      if (isGraphFile) {
        expect(checkClean("graph-file", example.code).clean, `${label} parses as graph file`).toBe(true);
        checkStable("graph-file", example.code, label);
      } else {
        expect(checkClean("header-file", example.code).clean, `${label} parses as header file`).toBe(true);
        checkStable("header-file", example.code, label);
      }
      return;
    case "Imports":
    case "Header Declarations":
      expect(checkClean("header-file", example.code).clean, `${label} parses as header file`).toBe(true);
      checkStable("header-file", example.code, label);
      return;
    case "Graph Body":
    case "Function Signatures":
      if (isGraphFile) {
        expect(checkClean("graph-file", example.code).clean, `${label} parses as graph file`).toBe(true);
        checkStable("graph-file", example.code, label);
      } else {
        expect(checkClean("member", example.code).clean, `${label} parses as graph member`).toBe(true);
        checkStable("member", example.code, label);
      }
      return;
    case "Statements":
      expect(checkClean("statement", example.code).clean, `${label} parses as statements`).toBe(true);
      checkStable("statement", example.code, label);
      return;
    case "Expressions":
    case "Literals":
      for (const line of contentLines(example.code)) {
        expect(checkClean("expression", line).clean, `${label} parses expression ${JSON.stringify(line)}`).toBe(true);
      }
      return;
    case "Types":
      for (const line of contentLines(example.code)) {
        expect(checkClean("type", line).clean, `${label} parses type ${JSON.stringify(line)}`).toBe(true);
      }
      return;
    case "Common Wrong Patterns":
      checkWrongPatterns(example);
      return;
    default:
      throw new Error(`doc-examples: no strategy for section ${JSON.stringify(example.section)} (fence ${example.index})`);
  }
}

describe("doc examples", () => {
  it("every fc-syntax.md example parses (Wrong patterns included)", () => {
    const markdown = readFileSync(SYNTAX_DOC, "utf8");
    const examples = extractExamples(markdown);
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) checkExample(example);
  });
});
