/**
 * @module lex/items - lossless trivia partition.
 *
 * Preserve the exact trivia between significant tokens.
 * Trivia belongs to the document sequence, not prematurely to a "leading" or
 * "trailing" comment slot. The emitter can later choose a layout while this
 * layer guarantees that every source comment, including EOF trivia, survives.
 */

import { TokenId } from "./grammar.generated.js";
import { isTrivia } from "./grammar.js";
import type { Token } from "./tokens.js";

export type TriviaKind = "whitespace" | "line-comment" | "block-comment";

export interface Trivia {
  /** Classified trivia kind. */
  kind: TriviaKind;
  /** Original trivia token. */
  token: Token;
}

/** One significant token and the source trivia immediately before it. */
export interface Item {
  /** The significant token. */
  token: Token;
  /** Trivia immediately before this token in source order. */
  before: readonly Trivia[];
  /** Physical line break in `before`; not a guessed parser EOS. */
  lineBreakBefore: boolean;
}

/** A lossless partition of a token stream. */
export interface LexedDocument {
  /** Ordered significant items with their preceding trivia. */
  items: readonly Item[];
  /** Trivia after the final significant token, retained even at EOF. */
  trailingTrivia: readonly Trivia[];
}

/**
 * Classify a trivia token into a higher-level kind.
 *
 * @param token - raw trivia token.
 * @returns classified trivia.
 */
function toTrivia(token: Token): Trivia {
  switch (token.kind) {
    case TokenId.LINE_COMMENT:
    case TokenId.LINE_COMMENT_NLSEMI: {
      return { kind: "line-comment", token };
    }
    case TokenId.COMMENT:
    case TokenId.COMMENT_NLSEMI: {
      return { kind: "block-comment", token };
    }
    default: {
      return { kind: "whitespace", token };
    }
  }
}

/**
 * Check if any trivia entry contains a line break.
 *
 * @param trivia - trivia slice.
 * @returns true if any entry contains `\n`.
 */
function hasLineBreak(trivia: readonly Trivia[]): boolean {
  return trivia.some((entry) => entry.token.text.includes("\n"));
}

/**
 * Partition raw tokens without discarding or relocating trivia.
 *
 * `TokenId.EOS` is rejected deliberately. It is an ANTLR lexer-mode token, not
 * source text, and callers of this lossless model must not smuggle guessed
 * semicolon boundaries into structural formatting.
 *
 * @param tokens - raw tokens from `tokenize`.
 * @returns partitioned document preserving all trivia.
 * @throws if `EOS` is present (parser-mode token, not source).
 */
export function itemize(tokens: readonly Token[]): LexedDocument {
  const items: Item[] = [];
  let between: Trivia[] = [];

  for (const token of tokens) {
    if (token.kind === TokenId.EOF) {
      continue;
    }
    if (token.kind === TokenId.EOS) {
      throw new Error("itemize() accepts raw source tokens only; EOS is parser-mode state");
    }
    if (isTrivia(token.kind)) {
      between.push(toTrivia(token));
      continue;
    }
    items.push({ token, before: between, lineBreakBefore: hasLineBreak(between) });
    between = [];
  }

  return { items, trailingTrivia: between };
}

/**
 * Rebuild source from a partitioned document exactly, excluding EOF.
 *
 * @param document - partitioned document.
 * @returns exact source reconstruction.
 */
export function reconstructDocument(document: LexedDocument): string {
  return [
    ...document.items.flatMap((item) => [...item.before.map((entry) => entry.token.text), item.token.text]),
    ...document.trailingTrivia.map((entry) => entry.token.text),
  ].join("");
}
