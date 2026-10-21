/**
 * @module format/golden.test - verifies customizable knobs and whole-file idempotency.
 *
 * Covers `tabWidth`/`useTabs`, `endOfLine`/`insertFinalNewline`, `trailingComma`
 * (never/always/multiline) on broken vs flat groups, `wrapCalls` auto vs never
 * with control-header flatness, `spaceAroundOperators`/`spaceAfterComma`,
 * pinned `callBreakStyle hugFirst→breakAll`, and knob-matrix idempotency.
 */

import { describe, expect, it } from "vitest";
import { formatSource } from "../../../src/format/format.js";

describe("format golden - customizable knobs", () => {
  it("tabWidth and useTabs produce stable indentation", () => {
    const src = "func F() int {\nif x {\nreturn 1\n}\n}";
    expect(formatSource(src, { tabWidth: 2 })).toContain("  return 1");
    expect(formatSource(src, { tabWidth: 4 })).toContain("    return 1");
    expect(formatSource(src, { useTabs: true })).toContain("\treturn 1");
    // Idempotent
    for (const cfg of [{ tabWidth: 2 }, { tabWidth: 4 }, { useTabs: true }] as const) {
      const once = formatSource(src, cfg);
      expect(formatSource(once, cfg)).toBe(once);
    }
  });

  it("endOfLine and insertFinalNewline", () => {
    const src = "func F() int {}";
    expect(formatSource(src, { endOfLine: "lf" })).not.toContain("\r\n");
    expect(formatSource(src, { endOfLine: "crlf" })).toContain("\r\n");
    expect(formatSource(src, { insertFinalNewline: true })).toMatch(/\n$/);
    expect(formatSource(src, { insertFinalNewline: false })).not.toMatch(/\n$/);
  });

  it("trailingComma auto vs never vs always on broken collections", () => {
    // Bare statement CALL (graph { Call(...) }) khi break → có `,` và `)` xuống dòng; gắn data thì không (test riêng ở emit.test assignment)
    const stmt = "[platform_server]\ngraph G { Call(aaa,bbb,ccc,ddd,eee,fff,ggg,hhh,iii,jjj) }";
    const brokenNever = formatSource(stmt, { printWidth: 20, trailingComma: "never" });
    const brokenAlways = formatSource(stmt, { printWidth: 20, trailingComma: "always" });
    const brokenMulti = formatSource(stmt, { printWidth: 20, trailingComma: "multiline" });
    // never: broken but no trailing comma before the closing paren
    expect(brokenNever).not.toMatch(/,\n\s*\)/);
    expect(brokenNever).toMatch(/jjj\n/);
    // always/multiline: broken trailing comma present, ) new line
    expect(brokenAlways).toMatch(/,\n\s*\)/);
    expect(brokenMulti).toMatch(/,\n\s*\)/);
    // Flat stays without trailing comma when not broken
    const flat = "[platform_server]\ngraph G { Call(a, b) }";
    expect(formatSource(flat, { trailingComma: "multiline" })).not.toContain("b, )");
  });

  it("wrapCalls auto vs never keeps control headers flat", () => {
    const src = "func F() int { if LongCall(first, second, third) { return 0 } return 1 }";
    const auto = formatSource(src, { printWidth: 24, wrapCalls: "auto" });
    // Control header calls are kept flat even when narrow (query.ts isStatementCall)
    expect(auto).toContain("if LongCall(first, second, third) {");
    // Statement call wraps when narrow - value calls (return/assign) stay flat by design
    const stmt = "[platform_server]\ngraph G { Call(first, second, third, fourth, fifth, sixth, seventh, eighth) }";
    const wrapped = formatSource(stmt, { printWidth: 24, wrapCalls: "always" });
    expect(wrapped).toContain("Call(\n");
  });

  it("spaceAroundOperators and spaceAfterComma", () => {
    const src = "func F() int { x=a+b; y=Call(a,b) }";
    expect(formatSource(src, { spaceAroundOperators: true })).toContain("x = a + b");
    expect(formatSource(src, { spaceAroundOperators: false })).toContain("x=a+b");
    expect(formatSource("func F() int { x = Call(a,b,c) }", { spaceAfterComma: true })).toContain("a, b, c");
    expect(formatSource("func F() int { x = Call(a,b,c) }", { spaceAfterComma: false })).toContain("a,b,c");
  });

  it("callBreakStyle breakAll vs hugFirst", () => {
    const stmt = "[platform_server]\ngraph G { Call(first, second, third, fourth, fifth, sixth, seventh, eighth) }";
    const breakAll = formatSource(stmt, { printWidth: 24, callBreakStyle: "breakAll", wrapCalls: "always" });
    const hugFirst = formatSource(stmt, { printWidth: 24, callBreakStyle: "hugFirst", wrapCalls: "always" });
    // breakAll: first arg on its own line
    expect(breakAll).toMatch(/Call\(\n\s+first,/);
    // hugFirst: first arg stays on the opener line
    expect(hugFirst).toContain("Call(first,");
    expect(hugFirst).not.toBe(breakAll);
    // breakAll with `auto` also breaks statement calls (not value calls) when narrow
    const autoBreak = formatSource(stmt, { printWidth: 24, callBreakStyle: "breakAll", wrapCalls: "auto" });
    expect(autoBreak).toMatch(/Call\(\n\s+first,/);
  });

  it("callBreakStyle breakAll vs hugFirst for brace collections (Data)", () => {
    const src = "func F() void { var x = List<object>{first, second, third, fourth, fifth, sixth, seventh, eighth} }";
    const breakAll = formatSource(src, { printWidth: 20, callBreakStyle: "breakAll", wrapCollections: "always" });
    const hugFirst = formatSource(src, { printWidth: 20, callBreakStyle: "hugFirst", wrapCollections: "always" });
    expect(breakAll).toMatch(/List<object>\{\n\s+first,/);
    expect(hugFirst).toContain("List<object>{first,");
    expect(hugFirst).not.toBe(breakAll);
    // Idempotent for both styles
    expect(formatSource(breakAll, { printWidth: 20, callBreakStyle: "breakAll", wrapCollections: "always" })).toBe(breakAll);
    expect(formatSource(hugFirst, { printWidth: 20, callBreakStyle: "hugFirst", wrapCollections: "always" })).toBe(hugFirst);
  });

  it("Data trailingComma flat no tail, broken has tail (multiline)", () => {
    const flat = "func F() void { var x = List<object>{a, b, c} }";
    expect(formatSource(flat)).not.toMatch(/c,\s*\}/);
    const flatWithTrailing = "func F() void { var x = List<object>{a, b, c,} }";
    // flat normalizes away trailing `,}` even if source had it
    expect(formatSource(flatWithTrailing)).toContain("List<object>{a, b, c}");
    expect(formatSource(flatWithTrailing)).not.toMatch(/c,\s*\}/);
    const brokenSrc = "func F() void { var x = List<object>{aaa, bbb, ccc, ddd, eee, fff} }";
    const brokenMulti = formatSource(brokenSrc, { printWidth: 20, trailingComma: "multiline", wrapCollections: "always" });
    expect(brokenMulti).toMatch(/fff,\n\s*\}/);
    const brokenNever = formatSource(brokenSrc, { printWidth: 20, trailingComma: "never", wrapCollections: "always" });
    expect(brokenNever).not.toMatch(/,\n\s*\}/);
    expect(brokenNever).toMatch(/fff\n\s*\}/);
    // breakAll broken keeps trailing, hugFirst broken also keeps trailing when multiline
    const brokenHug = formatSource(brokenSrc, { printWidth: 20, trailingComma: "multiline", wrapCollections: "always", callBreakStyle: "hugFirst" });
    expect(brokenHug).toMatch(/fff,\n\s*\}/);
  });

  it("whole-file idempotency across a knob matrix", () => {
    const src = "func F() int { x = Vector3{1,2,3}; y = arr[0]; return Call(a,b) }";
    const cfgs = [
      { bracketSpacing: "none" as const, spaceInsideBraces: false, spaceInsideBrackets: false },
      { bracketSpacing: "space" as const, spaceInsideBraces: true, spaceInsideBrackets: true, spaceInsideParens: true },
      { tabWidth: 4, printWidth: 40 },
      { spaceAroundOperators: false, spaceAfterComma: false },
    ];
    for (const cfg of cfgs) {
      const once = formatSource(src, cfg);
      const twice = formatSource(once, cfg);
      expect(twice).toBe(once);
    }
  });
});
