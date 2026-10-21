import { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { Token } from "./token.js";

/** Rebuild the exact source text from every non-EOF token. */
export function reconstructSource(tokens: readonly Token[]): string {
  return tokens
    .filter((token) => token.kind !== TokenId.EOF)
    .map((token) => token.text)
    .join("");
}
