import { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { Token } from "./token.js";

export type TriviaKind = "whitespace" | "line-comment" | "block-comment" | "jsdoc";

export function triviaKindOf(token: Token): TriviaKind | undefined {
  switch (token.kind) {
    case TokenId.WS:
    case TokenId.WS_NLSEMI:
      return "whitespace";
    case TokenId.LINE_COMMENT:
    case TokenId.LINE_COMMENT_NLSEMI:
      return "line-comment";
    case TokenId.COMMENT:
    case TokenId.COMMENT_NLSEMI:
      return token.text.startsWith("/**") ? "jsdoc" : "block-comment";
    default:
      return undefined;
  }
}

export function isTrivia(token: Token): boolean {
  return triviaKindOf(token) !== undefined;
}

export function containsLineBreak(token: Token): boolean {
  return token.text.includes("\r") || token.text.includes("\n");
}
