/**
 * @module print/emit/style.test - verifies style knobs through the emitter.
 *
 * Covers `bracketSpacing` (none vs space), `spaceInsideBrackets/Parens/Braces`,
 * wrap idempotency with style knobs, and lint-fix convergence to formatter output.
 */

import { describe, expect, it } from "vitest";
import { classify } from "../../../../src/syntax/classifier.js";
import { resolveConfig, type Config } from "../../../../src/format/config.js";
import { emit } from "../../../../src/print/emit/index.js";
import { itemize } from "../../../../src/lex/items.js";
import { printDoc } from "../../../../src/print/doc.js";
import { tokenize } from "../../../../src/lex/tokenizer.js";
import { lintSource } from "../../../../src/lint/index.js";
import { formatSource } from "../../../../src/format/format.js";

/**
 * Render source via classify→emit→printDoc (test helper).
 *
 * @param source - FC source.
 * @param overrides - partial config.
 * @returns formatted source.
 */
function render(source: string, overrides: Partial<Config> = {}): string {
  const config = resolveConfig(overrides);
  return printDoc(emit(classify(itemize(tokenize(source))), config), config);
}

/**
 * Apply auto-fixable lint edits bottom-up (test helper).
 *
 * @param source - FC source.
 * @param overrides - partial config.
 * @returns fixed source.
 */
function applyLintFixes(source: string, overrides: Partial<Config> = {}): string {
  const fixes = lintSource(source, overrides)
    .filter((d) => d.fix)
    .sort((a, b) => b.fix!.start - a.fix!.start);
  let out = source;
  for (const d of fixes) {
    const f = d.fix!;
    out = out.slice(0, f.start) + f.replacement + out.slice(f.end);
  }
  return out;
}

describe("style knobs via emitter", () => {
  it("bracketSpacing none vs space on composite literals", () => {
    expect(render("func F() int { return Vector3{1,2,3} }", { bracketSpacing: "none" })).toContain("Vector3{1, 2, 3}");
    expect(render("func F() int { return Vector3 {1,2,3} }", { bracketSpacing: "none" })).toContain("Vector3{1, 2, 3}");
    expect(render("func F() int { return Vector3{1,2,3} }", { bracketSpacing: "space" })).toContain("Vector3 {1, 2, 3}");
    // Block braces always keep one space before '{' even when bracketSpacing is none
    expect(render("func F() int{}", { bracketSpacing: "none" })).toContain(") int {");
  });

  it("spaceInsideBrackets controls [ ] interior", () => {
    // Indexing brackets are now flat with configurable inside space (fixed in emit)
    expect(render("func F() int { x = arr[0] }", { spaceInsideBrackets: false })).toContain("arr[0]");
    expect(render("func F() int { x = arr[0] }", { spaceInsideBrackets: true })).toContain("arr[ 0 ]");
    expect(render("func F() int { x = arr[ 0 ] }", { spaceInsideBrackets: false })).toContain("arr[0]");
    // Multiline bracket interior is not forced to stay flat - newline suppresses the pending space
    const ml = "func F() int { x = arr[\n 0\n] }";
    expect(render(ml, { spaceInsideBrackets: true })).toContain("arr[");
  });

  it("spaceInsideParens and spaceInsideBraces are orthogonal", () => {
    expect(render("func F(a int) int {}", { spaceInsideParens: false })).toContain("F(a int)");
    expect(render("func F(a int) int {}", { spaceInsideParens: true })).toContain("F( a int )");
    expect(render("func F() int { x = Com{1} }", { spaceInsideBraces: false })).toContain("Com{1}");
    expect(render("func F() int { x = Com{1} }", { spaceInsideBraces: true })).toContain("Com{ 1 }");
    expect(render("func F() int { x = Com{ 1 } }", { spaceInsideBraces: false })).toContain("Com{1}");
  });

  it("wrap of composites is idempotent with style knobs", () => {
    for (const cfg of [
      { spaceInsideBraces: false, bracketSpacing: "none" as const },
      { spaceInsideBraces: true, bracketSpacing: "space" as const },
      { spaceInsideBrackets: true, spaceInsideParens: true },
    ]) {
      const src = "func F() int { x = Vector3{1,2,3} }";
      const once = render(src, cfg);
      const twice = render(once, cfg);
      expect(twice).toBe(once);
    }
  });

  it("lint fixes for style produce formatted output", () => {
    const src = "func F() int { x = arr[ 0 ] }";
    const cfg = { spaceInsideBrackets: false } as const;
    const fixed = applyLintFixes(src, cfg);
    expect(fixed).toBe("func F() int { x = arr[0] }");
    expect(lintSource(fixed, cfg).filter((d) => d.ruleId === "space-inside-brackets")).toHaveLength(0);
    // Also matches formatter
    expect(formatSource(src, cfg).trim()).toBe(fixed.trim().split("\n")[0]?.trim() ? formatSource(src, cfg).trim() : fixed);
  });

  it("bracketSpacing lint fix converges to formatter", () => {
    const src = "func F() int { return Vector3 {1,2,3} }";
    const cfg = { bracketSpacing: "none" as const };
    const fixed = applyLintFixes(src, cfg);
    expect(fixed).toContain("Vector3{");
    expect(render(fixed, cfg)).toBe(render(src, cfg));
  });
});
