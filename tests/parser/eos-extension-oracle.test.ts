import { describe, expect, it } from "vitest";

import { TokenId } from "../../src/grammar/token-vocabulary.generated.js";
import { lex } from "../../src/lex/lexer.js";
import { deriveStatementBoundaries } from "../../src/parser/statement-boundary.js";
import { EOS_CASES } from "../fixtures/eos-cases.js";
import { findExtensionSyntaxPath, lexWithExtension } from "../helpers/extension-lexer.js";

const syntaxPath = findExtensionSyntaxPath();

describe.skipIf(!syntaxPath)("FCGLexer EOS differential oracle", () => {
  it("matches extension EOS ranges for the pinned state-machine cases", () => {
    for (const testCase of EOS_CASES) {
      const formatterRanges = deriveStatementBoundaries(lex(testCase.source).tokens)
        .filter((boundary) => boundary.kind === "virtual")
        .map((boundary) => [boundary.range.start.offset, boundary.range.end.offset]);
      const extensionRanges = lexWithExtension(testCase.source, syntaxPath ?? "")
        .filter((token) => token.kind === TokenId.EOS && token.text !== ";")
        .map((token) => [token.startOffset, token.endOffset]);

      expect(formatterRanges, testCase.name).toEqual(extensionRanges);
    }
  });
});
