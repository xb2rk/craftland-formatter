/**
 * @module format/fc-syntax.test - verifies FC-real syntax formatting.
 *
 * Covers `for` range/index headers, `List`/`Map`/typed composites, indexing
 * tight brackets, decorator single-line, `=` spacing regression, operator
 * spacing (`) *` / `+ (`), shift `>>`/`<<` clinging, and blank-line collapse
 * delegation (`normalize` collapses `>1` to `1`).
 */

import { describe, expect, it } from "vitest";
import { formatSource } from "../../../src/format/format.js";

/**
 * Format with default config (test helper).
 *
 * @param src - FC source.
 * @returns formatted source.
 */
function fmt(src: string): string {
  return formatSource(src, {});
}

describe("FC real syntax - for & collections", () => {
  it("for range keeps header on one line (spec §11)", () => {
    const src = "func F() int { for _, model in _MODEL_ENTITY_LIST { Call(model) } }";
    const out = fmt(src);
    expect(out).toContain("for _, model in _MODEL_ENTITY_LIST {");
    // Header must not be split across lines (G7)
    expect(out).not.toContain("for _,\n");
    expect(fmt(out)).toBe(out);
  });

  it("for index form", () => {
    const src = "func F() int { for step = 0, steps, 1 { Call(step) } }";
    const out = fmt(src);
    expect(out).toContain("for step = 0, steps, 1 {");
    expect(fmt(out)).toBe(out);
  });

  it("List / Map composites use braces not brackets", () => {
    // Real corpus uses {a,b} inside typed literal, not [a,b]
    expect(fmt("func F() int { x = List<int>{1, 2, 3} }")).toContain("List<int>{1, 2, 3}");
    expect(fmt("func F() int { x = Map<string, int>{ \"k\": 1 } }")).toContain("Map<string, int>{");
    // Empty composite keeps space before {}
    expect(fmt("func F() int { var m Map<UUID, entity<Player>> = {} }")).toContain("= {}");
    // Idempotent
    const src = "func F() int { x = Vector3{1, 2, 3} }";
    expect(fmt(fmt(src))).toBe(fmt(src));
  });

  it("indexing keeps tight brackets (default)", () => {
    const src = "func F() int { x = arr[0] }";
    expect(fmt(src)).toContain("arr[0]");
    expect(fmt("func F() int { x = arr[ 0 ] }")).toContain("arr[0]");
  });

  it("decorator brackets stay on one line", () => {
    const src = "[platform_server]\ngraph G { x=1 }";
    const out = fmt(src);
    expect(out).toContain("[platform_server]");
    expect(out).toContain("graph G {");
  });

  it("collection literal after = keeps space (regression for x =[)", () => {
    // Brackets here are not visited in real corpus, but ensure the spacing rule
    // does not drop the space after =. Real code uses { } but we keep the check.
    expect(fmt("func F() int { x = {1, 2, 3} }")).toContain("x = {1, 2, 3}");
    // The bracket case should also keep space if someone ever writes it
    expect(fmt("var x = [1, 2, 3]")).toContain("var x = [1, 2, 3]");
  });

  it("operator spacing: closer -> operator and operator -> opener (regression )* and +()", () => {
    // `) *` - emit used to suppress space after `)` inside delimited (m0384)
    const srcStar = "func F() int { var baseSeed int = (uidHash * 10007 + (shopId + 1) * 131 + ((boundary % _MOD) * 23) % _MOD + 97) % _MOD }";
    expect(fmt(srcStar)).toContain(") * 23");
    expect(fmt(srcStar)).not.toContain(")* 23");
    // `+ (` - spacing.ts:102 operator before L_PAREN must keep space
    expect(fmt("func F() int { x = a + (b) }")).toContain("a + (b)");
    expect(fmt("func F() int { x = key + (key << 3) }")).toContain("key + (key << 3)");
    expect(fmt(fmt(srcStar))).toBe(fmt(srcStar));
  });

  it("shift >>/<< inner gap stays together", () => {
    // Grammar has no dedicated >>/<< token (grammar.ts:98), two `>` must cling (spacing.ts:84)
    const src = "func F() int { key = (key ^ 61) ^ (key >> 16); key = key + (key << 3); key = key ^ (key >> 4) }";
    const out = fmt(src);
    expect(out).toContain(">> 16");
    expect(out).toContain("<< 3");
    expect(out).not.toContain("> >");
    expect(out).not.toContain("< <");
    expect(fmt(out)).toBe(out);
  });

  it("blank lines >=2 collapse to 1 (normalize.ts:77)", async () => {
    const { normalize } = await import("../../../src/print/normalize.js");
    const { resolveConfig } = await import("../../../src/format/config.js");
    const cfg = resolveConfig({});
    // 2 blanks (3 newlines) -> 1 blank (2 newlines), normalize owns this
    expect(normalize("a\n\n\nb\n", cfg)).toBe("a\n\nb\n");
    expect(normalize("a\n\nb\n", cfg)).toBe("a\n\nb\n");
    expect(normalize("a\nb\n", cfg)).toBe("a\nb\n");
    // formatSource for blocks currently normalizes to single newline between stmts
    const src = "func F() int {\n  x = 1\n\n\n  y = 2\n}\n";
    const out = fmt(src);
    expect(out).not.toContain("\n\n\n");
    expect(fmt(out)).toBe(out);
  });
});
