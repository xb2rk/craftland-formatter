import { describe, expect, it } from "vitest";
import { formatDiagnosticList } from "../../src/cli/diagnostics.js";
import {
  fromLexDiagnostic,
  fromLintDiagnostic,
  fromParseDiagnostic,
  toLintDiagnostic,
} from "../../src/diagnostics.js";
import type { LexDiagnostic, LexDiagnosticCode } from "../../src/lex/diagnostic.js";
import type { SourceRange } from "../../src/lex/position.js";
import type { LintDiagnostic } from "../../src/lint/contracts.js";
import type { ParseDiagnostic, ParseDiagnosticCode } from "../../src/parser/diagnostic.js";

function range(): SourceRange {
  return {
    end: { column: 1, line: 0, offset: 1 },
    start: { column: 0, line: 0, offset: 0 },
  };
}

const LEX_CODES: readonly LexDiagnosticCode[] = [
  "unexpected-character",
  "unterminated-block-comment",
  "unterminated-interpreted-string",
  "unterminated-raw-string",
  "unterminated-rune",
];

const PARSE_CODES: readonly ParseDiagnosticCode[] = [
  "expected-expression",
  "expected-name",
  "expected-token",
  "expected-type",
  "unexpected-decorator",
  "unexpected-token",
];

describe("diagnostic pipeline", () => {
  it.each(LEX_CODES)("lex %s adapts to layer lex with error severity and renders", (code) => {
    const diagnostic: LexDiagnostic = { code, message: "boom", range: range() };
    const unified = fromLexDiagnostic(diagnostic);
    expect(unified).toMatchObject({ code, layer: "lex", severity: "error" });
    expect(formatDiagnosticList("World.fcg", [unified])).toBe(`World.fcg:1:1 ${code} boom`);
  });

  it.each(PARSE_CODES)("parse %s adapts to layer parse with error severity and renders", (code) => {
    const diagnostic: ParseDiagnostic = { code, message: "boom", range: range() };
    const unified = fromParseDiagnostic(diagnostic);
    expect(unified).toMatchObject({ code, layer: "parse", severity: "error" });
    expect(formatDiagnosticList("World.fcg", [unified])).toBe(`World.fcg:1:1 ${code} boom`);
  });

  it("lex/parse diagnostics share one lint adaptation (fc/parse, fc-parser)", () => {
    const lex: LexDiagnostic = { code: "unexpected-character", message: "bad char", range: range() };
    const parse: ParseDiagnostic = { code: "expected-type", message: "bad type", range: range() };
    expect(toLintDiagnostic(lex)).toMatchObject({ code: "unexpected-character", ruleId: "fc/parse", severity: "error", source: "fc-parser" });
    expect(toLintDiagnostic(parse)).toMatchObject({ code: "expected-type", ruleId: "fc/parse", severity: "error", source: "fc-parser" });
  });

  it("lint diagnostics keep their ruleId and severity through the pipeline", () => {
    const diagnostic: LintDiagnostic = {
      message: "unused",
      range: range(),
      ruleId: "fc/no-unused-local",
      severity: "warning",
      source: "fc-lint",
    };
    const unified = fromLintDiagnostic(diagnostic);
    expect(unified).toMatchObject({ code: "fc/no-unused-local", layer: "lint", ruleId: "fc/no-unused-local", severity: "warning" });
    expect(formatDiagnosticList("World.fcg", [diagnostic])).toBe("World.fcg:1:1 fc/no-unused-local unused");
  });
});
