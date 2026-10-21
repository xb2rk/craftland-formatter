import { describe, expect, it } from "vitest";
import { lex } from "../../src/lex/index.js";
import {
  parseExpression,
  parseGraphFile,
  parseHeaderFile,
  type ParseDiagnostic,
} from "../../src/parser/index.js";

/**
 * Error-fence contract: inside one bracketed construct, the first failure at
 * a token is reported and every re-report at that same token (loop retry,
 * terminal closing-token check) is dropped — one error per broken token.
 * Recovery outside the construct may still re-anchor at the same token;
 * those diagnostics belong to a different construct and are kept.
 */
function messages(diagnostics: readonly ParseDiagnostic[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.message);
}

describe("error fence", () => {
  it("collapses same-token cascades in call arguments", () => {
    const result = parseExpression(lex("foo(a, , b)"));
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.length).toBeLessThanOrEqual(4);
    expect(messages(result.diagnostics)).toContain("Expected an FC expression.");
    expect(messages(result.diagnostics)).not.toContain("Expected ')' after call arguments.");
  });

  it("collapses same-token cascades in positional composites", () => {
    const result = parseExpression(lex("List<int>{1, , 2}"));
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.length).toBeLessThanOrEqual(4);
    expect(messages(result.diagnostics)).toContain("Expected an FC expression.");
    expect(messages(result.diagnostics)).not.toContain("Expected '}' after composite entries.");
  });

  it("collapses same-token cascades in function signatures", () => {
    const result = parseGraphFile(lex("graph Foo { func Bar(a int, , b int) {} }"));
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.length).toBeLessThanOrEqual(8);
    expect(messages(result.diagnostics)).toContain("Expected an FC identifier-like name.");
    expect(messages(result.diagnostics)).not.toContain("Expected ')' after parameters.");
  });

  it("collapses same-token cascades in function types", () => {
    const result = parseHeaderFile(lex("define Cb: func(a int, , b int) bool"));
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.length).toBeLessThanOrEqual(6);
    expect(messages(result.diagnostics)).toContain("Expected an FC identifier-like name.");
    expect(messages(result.diagnostics)).not.toContain("Expected ')' after function type parameters.");
  });

  it("collapses same-token cascades in decorator arguments", () => {
    const result = parseGraphFile(lex("[custom , Transform] graph Foo {}"));
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.length).toBeLessThanOrEqual(9);
    expect(messages(result.diagnostics)).toContain("Expected an FC type.");
    expect(messages(result.diagnostics)).not.toContain("Expected ']' after decorator.");
  });

  it("keeps single-failure constructs at exactly one diagnostic", () => {
    expect(parseExpression(lex('Map<string, int>{"a": }')).diagnostics).toHaveLength(1);
    expect(parseExpression(lex("SpawnInfo{position = , yaw = 0}")).diagnostics).toHaveLength(1);
    expect(parseExpression(lex("Map<, int>{}")).diagnostics).toHaveLength(1);
  });
});

/**
 * Sync-recovery contract (E2): when a declaration/member/statement fails,
 * the owning loop reports once and skips forward to the next token that can
 * start a construct of the same kind. Valid constructs after the failure
 * are still parsed; `R_CURLY`/`EOF` always terminate a skip unconsumed so
 * the owning block keeps its closing brace.
 */
describe("sync recovery", () => {
  it("resumes the next statement after a broken one", () => {
    const result = parseGraphFile(lex(`graph G { func F() { foo(, bar var after = 1 } }`));
    expect(result.consumedThroughEof).toBe(true);
    expect(result.diagnostics.length).toBeLessThanOrEqual(3);
    const func = result.node?.graph?.members?.[0];
    expect(func?.kind).toBe("function-declaration");
    if (func?.kind !== "function-declaration") return;
    const names = func.body?.statements.map((s) => (s.kind === "variable-statement" ? s.name?.text : s.kind)) ?? [];
    expect(names).toContain("after");
  });

  it("resumes the next member after leading garbage", () => {
    const result = parseGraphFile(lex(`graph G { ,,, func F() {} func H() {} }`));
    expect(result.consumedThroughEof).toBe(true);
    expect(result.diagnostics.length).toBeLessThanOrEqual(2);
    const names = (result.node?.graph?.members ?? []).map((m) => (m.kind === "function-declaration" ? m.name?.text : m.kind));
    expect(names).toEqual(["F", "H"]);
    expect(messages(result.diagnostics)).toContain('Expected a graph member. Found ",".');
  });

  it("preserves the closing brace after garbage", () => {
    const result = parseGraphFile(lex(`graph G { func F() { ,,, } func H() { var x = 1 } }`));
    expect(result.consumedThroughEof).toBe(true);
    expect(result.diagnostics.length).toBeLessThanOrEqual(2);
    expect(messages(result.diagnostics)).not.toContain("Expected '}' after code block.");
    const first = result.node?.graph?.members?.[0];
    const second = result.node?.graph?.members?.[1];
    expect(first?.kind).toBe("function-declaration");
    expect(second?.kind).toBe("function-declaration");
    if (first?.kind === "function-declaration") expect(first.body?.statements).toHaveLength(0);
    if (second?.kind === "function-declaration") expect(second.body?.statements).toHaveLength(1);
  });

  it("does not let unbalanced parens poison resumption", () => {
    const result = parseGraphFile(lex(`graph G { ((( func F() {} }`));
    expect(result.consumedThroughEof).toBe(true);
    expect(result.diagnostics.length).toBeLessThanOrEqual(2);
    const names = (result.node?.graph?.members ?? []).map((m) => (m.kind === "function-declaration" ? m.name?.text : m.kind));
    expect(names).toEqual(["F"]);
  });

  it("reports each stray-semicolon run once and keeps both declarations", () => {
    const result = parseHeaderFile(lex("define A: int;\n;;;\ndefine B: string;\n"));
    expect(result.consumedThroughEof).toBe(true);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.map((d) => d.range.start.offset)).toEqual([13, 35]);
    const names = (result.node?.declarations ?? []).map((d) => (d.kind === "define-declaration" ? d.name?.text : d.kind));
    expect(names).toEqual(["A", "B"]);
  });

  it("keeps parsed enum members before the failure", () => {
    const result = parseHeaderFile(lex(`enum E { A ,,, B }`));
    expect(result.consumedThroughEof).toBe(true);
    expect(result.diagnostics.length).toBeLessThanOrEqual(2);
    expect(messages(result.diagnostics)).toContain('Expected an enum member. Found ",".');
    const decl = result.node?.declarations[0];
    expect(decl?.kind).toBe("enum-declaration");
    // `B` is identifier-started so no sync token can resync to it; it is
    // skipped silently by design, while `A` survives.
    if (decl?.kind === "enum-declaration") {
      expect(decl.members.map((m) => m.name?.text)).toContain("A");
    }
  });

  it("resumes header declarations after garbage", () => {
    const result = parseHeaderFile(lex(`,,, define B: string`));
    expect(result.consumedThroughEof).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    const names = (result.node?.declarations ?? []).map((d) => (d.kind === "define-declaration" ? d.name?.text : d.kind));
    expect(names).toEqual(["B"]);
  });

  it("terminates on a failure at the closing brace", () => {
    const result = parseGraphFile(lex(`graph G { func F() { ( } }`));
    expect(result.consumedThroughEof).toBe(true);
    expect(result.diagnostics.length).toBeLessThanOrEqual(2);
    expect(result.node?.graph?.members?.[0]?.kind).toBe("function-declaration");
  });
});
