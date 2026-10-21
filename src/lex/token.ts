import type { LexicalTokenId } from "../grammar/lexical.js";
import type { SourceRange } from "./position.js";

/** One source-preserving token. EOF is a zero-width token with empty text. */
export interface Token {
  readonly kind: LexicalTokenId;
  readonly range: SourceRange;
  readonly text: string;
}
