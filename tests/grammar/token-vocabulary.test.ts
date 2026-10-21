import { describe, expect, it } from "vitest";

import { KEYWORD_TOKEN_IDS, MULTI_CHARACTER_TOKEN_IDS } from "../../src/grammar/lexical.js";
import { GRAMMAR_PROVENANCE, TokenId } from "../../src/grammar/token-vocabulary.generated.js";
import { lex } from "../../src/lex/lexer.js";
import { reconstructSource } from "../../src/lex/reconstruct.js";

function nonTriviaKinds(source: string): number[] {
  return lex(source).tokens
    .filter((token) => token.kind !== TokenId.WS && token.kind !== TokenId.EOF)
    .map((token) => token.kind);
}

describe("generated FC token vocabulary", () => {
  it("pins extension provenance and every documented keyword", () => {
    expect(GRAMMAR_PROVENANCE).toMatchObject({
      artifact: "dist/server_syntax.js",
      extensionVersion: "1.10.1",
      tokenCount: 129,
    });
    expect(GRAMMAR_PROVENANCE.sha256).toMatch(/^[a-f0-9]{64}$/);

    const spellings = [...KEYWORD_TOKEN_IDS.keys()];
    const source = spellings.join(" ");
    expect(reconstructSource(lex(source).tokens)).toBe(source);
    expect(nonTriviaKinds(source)).toEqual([...KEYWORD_TOKEN_IDS.values()]);
  });

  it("matches every multi-character spelling before its prefixes", () => {
    const source = MULTI_CHARACTER_TOKEN_IDS.map(([text]) => text).join(" ");
    expect(nonTriviaKinds(source)).toEqual(MULTI_CHARACTER_TOKEN_IDS.map(([, kind]) => kind));
  });

  it("keeps shift operators as adjacent angle tokens", () => {
    expect(nonTriviaKinds("a << b >> c <<= d >>= e")).toEqual([
      TokenId.IDENTIFIER,
      TokenId.LESS,
      TokenId.LESS,
      TokenId.IDENTIFIER,
      TokenId.GREATER,
      TokenId.GREATER,
      TokenId.IDENTIFIER,
      TokenId.LSHIFT_ASSIGN,
      TokenId.IDENTIFIER,
      TokenId.RSHIFT_ASSIGN,
      TokenId.IDENTIFIER,
    ]);
  });
});
