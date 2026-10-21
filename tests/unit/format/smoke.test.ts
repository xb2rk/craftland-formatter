/**
 * @module format/smoke.test - verifies grammar provenance and config defaults.
 *
 * Covers `grammar.generated.ts` token id anchors, duplicate-id check, provenance
 * (artifact/version/sha), lookup tables (`keywordKind`, longest-first operators,
 * trivia), and `DEFAULT_CONFIG` / `resolveConfig` defaults.
 */

import { describe, it, expect } from "vitest";
import { GRAMMAR_PROVENANCE, TokenId } from "../../../src/lex/grammar.generated.js";
import { KEYWORDS, OPERATORS, PUNCTUATORS, keywordKind, isTrivia } from "../../../src/lex/grammar.js";
import { DEFAULT_CONFIG, resolveConfig } from "../../../src/format/config.js";

describe("grammar.generated.ts", () => {
  it("mirrors FCGLexer token ids (spot-check the anchors)", () => {
    expect(TokenId.DEFINE).toBe(1);
    expect(TokenId.IMPORT).toBe(16);
    expect(TokenId.IDENTIFIER).toBe(60);
    expect(TokenId.RAW_STRING_LIT).toBe(119);
    expect(TokenId.EOS).toBe(128);
    expect(TokenId.OTHER).toBe(129);
  });

  it("has no duplicate numeric ids", () => {
    const ids = Object.values(TokenId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("records the extension artifact that generated this table", () => {
    expect(GRAMMAR_PROVENANCE.artifact).toBe("dist/server_syntax.js");
    expect(GRAMMAR_PROVENANCE.extensionVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(GRAMMAR_PROVENANCE.tokenCount).toBe(129);
    expect(GRAMMAR_PROVENANCE.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("grammar.ts lookup tables", () => {
  it("resolves keywords and falls back to IDENTIFIER", () => {
    expect(keywordKind("import")).toBe(TokenId.IMPORT);
    expect(keywordKind("Vector3")).toBe(TokenId.VECTOR3);
    expect(keywordKind("object")).toBe(TokenId.OBJECT);
    expect(keywordKind("myThing")).toBe(TokenId.IDENTIFIER);
  });

  it("lists operators longest-first (no single char before a longer match)", () => {
    expect(OPERATORS[0]![0]).toBe("<<=");
    expect(KEYWORDS["define"]).toBe(TokenId.DEFINE);
    expect(PUNCTUATORS["{"]).toBe(TokenId.L_CURLY);
  });

  it("classifies trivia correctly", () => {
    expect(isTrivia(TokenId.WS)).toBe(true);
    expect(isTrivia(TokenId.COMMENT)).toBe(true);
    expect(isTrivia(TokenId.EOS)).toBe(false); // only ANTLR's parser-mode lexer emits EOS
    expect(isTrivia(TokenId.IDENTIFIER)).toBe(false);
  });
});

describe("config.ts", () => {
  it("resolves defaults and overrides", () => {
    expect(resolveConfig().printWidth).toBe(100);
    expect(resolveConfig({ printWidth: 80 }).printWidth).toBe(80);
    expect(DEFAULT_CONFIG.endOfLine).toBe("lf");
    expect(DEFAULT_CONFIG.tabWidth).toBe(2);
    expect(DEFAULT_CONFIG.bracketSpacing).toBe("none");
    expect(DEFAULT_CONFIG.trailingComma).toBe("multiline");
    expect(DEFAULT_CONFIG.spaceInsideBrackets).toBe(false);
    expect(DEFAULT_CONFIG.callBreakStyle).toBe("breakAll");
  });
});
