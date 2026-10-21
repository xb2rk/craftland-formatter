import { TokenId } from "../src/grammar/token-vocabulary.generated.js";
import { lex } from "../src/lex/lexer.js";
import { deriveStatementBoundaries } from "../src/parser/statement-boundary.js";
import { EOS_CASES } from "../tests/fixtures/eos-cases.js";
import { findExtensionSyntaxPath, lexWithExtension } from "../tests/helpers/extension-lexer.js";

const syntaxPath = findExtensionSyntaxPath();
if (!syntaxPath) throw new Error("Craftland Studio syntax extension is required for verify:eos");

for (const testCase of EOS_CASES) {
  const formatterRanges = deriveStatementBoundaries(lex(testCase.source).tokens)
    .filter((boundary) => boundary.kind === "virtual")
    .map((boundary) => [boundary.range.start.offset, boundary.range.end.offset]);
  const extensionRanges = lexWithExtension(testCase.source, syntaxPath)
    .filter((token) => token.kind === TokenId.EOS && token.text !== ";")
    .map((token) => [token.startOffset, token.endOffset]);
  if (JSON.stringify(formatterRanges) !== JSON.stringify(extensionRanges)) {
    throw new Error(`${testCase.name}: expected ${JSON.stringify(extensionRanges)}, got ${JSON.stringify(formatterRanges)}`);
  }
}

console.log(`EOS verification passed for ${EOS_CASES.length} extension-pinned cases.`);
