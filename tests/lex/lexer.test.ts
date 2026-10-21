import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { TokenId } from "../../src/grammar/token-vocabulary.generated.js";
import { lex } from "../../src/lex/lexer.js";
import { reconstructSource } from "../../src/lex/reconstruct.js";
import { isTrivia, triviaKindOf } from "../../src/lex/trivia.js";
import { collectCorpusFiles } from "../helpers/workspace.js";

function meaningfulTokens(source: string) {
  return lex(source).tokens.filter((token) => !isTrivia(token) && token.kind !== TokenId.EOF);
}

describe("lossless FC lexer", () => {
  it("preserves literals, comments, Unicode names, and CRLF bytes exactly", () => {
    const source = [
      "var café_độ int = 0xCA_FE + .5e-2i\r\n",
      "// giữ nguyên hai spaces  \r\n",
      "var color Color = #a1b2c3d4\r\n",
      "var text string = \"a\\\"b\"\r\n",
      "var rune string = 'x'\r\n",
      "var raw string = `one\r\ntwo`\r\n",
      "/** docs  */\r\n",
    ].join("");
    const result = lex(source);

    expect(result.diagnostics).toEqual([]);
    expect(reconstructSource(result.tokens)).toBe(source);
    expect(result.tokens.some((token) => token.kind === TokenId.RAW_STRING_LIT && token.text === "`one\r\ntwo`")).toBe(true);
    expect(result.tokens.some((token) => triviaKindOf(token) === "jsdoc" && token.text === "/** docs  */")).toBe(true);
    expect(result.tokens.some((token) => token.kind === TokenId.COLOR_HEX_LIT && token.text === "#a1b2c3d4")).toBe(true);
    expect(result.tokens.some((token) => token.kind === TokenId.IMAGINARY_LIT && token.text === ".5e-2i")).toBe(true);
  });

  it("reports malformed protected tokens without dropping their source", () => {
    const cases = [
      ["/* unterminated", "unterminated-block-comment"],
      ['"unterminated', "unterminated-interpreted-string"],
      ["`unterminated", "unterminated-raw-string"],
      ["'unterminated", "unterminated-rune"],
    ] as const;

    for (const [source, code] of cases) {
      const result = lex(source);
      expect(reconstructSource(result.tokens)).toBe(source);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([code]);
    }
  });

  it("uses zero-based UTF-16 positions and treats CRLF as one logical newline", () => {
    const result = lex("α\r\n🤖");
    const [alpha, whitespace, robot, eof] = result.tokens;

    expect(alpha?.range).toEqual({
      start: { offset: 0, line: 0, column: 0 },
      end: { offset: 1, line: 0, column: 1 },
    });
    expect(whitespace?.range).toEqual({
      start: { offset: 1, line: 0, column: 1 },
      end: { offset: 3, line: 1, column: 0 },
    });
    expect(robot?.range).toEqual({
      start: { offset: 3, line: 1, column: 0 },
      end: { offset: 5, line: 1, column: 2 },
    });
    expect(eof).toMatchObject({ kind: TokenId.EOF, text: "", range: { start: robot?.range.end, end: robot?.range.end } });
  });

  it("never emits the compiler's synthetic EOS token", () => {
    const result = lex("var count int = 1\ncount += 1\n");
    expect(result.tokens.some((token) => token.kind === TokenId.EOS)).toBe(false);
  });

  it("reconstructs every project FC source file and covers it with contiguous ranges", () => {
    const files = collectCorpusFiles();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const result = lex(source);
      const sourceTokens = result.tokens.filter((token) => token.kind !== TokenId.EOF);

      expect(reconstructSource(result.tokens), file).toBe(source);
      expect(result.diagnostics, file).toEqual([]);
      expect(sourceTokens[0]?.range.start.offset ?? 0, file).toBe(0);
      for (let index = 1; index < sourceTokens.length; index += 1) {
        expect(sourceTokens[index]?.range.start.offset, file).toBe(sourceTokens[index - 1]?.range.end.offset);
      }
      expect(sourceTokens.at(-1)?.range.end.offset ?? 0, file).toBe(source.length);
    }
  }, 30_000);

  it("keeps punctuation and ordinary operators distinct from protected atoms", () => {
    const source = "# #112233 < > = | / % & ^ ! ~ + - * ( ) { } [ ] , ; : .";
    expect(meaningfulTokens(source).map((token) => token.kind)).toEqual([
      TokenId.HASHTAG,
      TokenId.COLOR_HEX_LIT,
      TokenId.LESS,
      TokenId.GREATER,
      TokenId.ASSIGN,
      TokenId.OR,
      TokenId.DIV,
      TokenId.MOD,
      TokenId.AND,
      TokenId.XOR,
      TokenId.EXCLAMATION,
      TokenId.BIT_NOT,
      TokenId.PLUS,
      TokenId.MINUS,
      TokenId.STAR,
      TokenId.L_PAREN,
      TokenId.R_PAREN,
      TokenId.L_CURLY,
      TokenId.R_CURLY,
      TokenId.L_BRACKET,
      TokenId.R_BRACKET,
      TokenId.COMMA,
      TokenId.SEMI,
      TokenId.COLON,
      TokenId.DOT,
    ]);
  });

  it("does not accept a seven-digit color as a valid color literal", () => {
    const result = lex("#abcdefa");
    expect(result.tokens.slice(0, -1).map((token) => token.kind)).toEqual([
      TokenId.HASHTAG,
      TokenId.IDENTIFIER,
    ]);
  });
});
