// =============================================================================
// items.ts - token stream -> "items" (significant tokens + line-break info).
//
// The formatter never works on raw whitespace; instead `itemize` collapses the
// token stream from `tokenizer.ts` (whose vocabulary is derived from the
// official FCGLexer, see `doc.ts` header) into a flat list of "items": every
// significant token (code or comment) annotated with how many line breaks
// preceded it in the source. This lets the formatter recompute all whitespace
// and indentation from scratch (like `gofmt`) while preserving comments and the
// author's statement boundaries.
// =============================================================================

import { Token, TokenKind } from "./tokenizer.js";

export interface Item {
  /** A significant token: code or comment. Whitespace is dropped. */
  tok: Token;
  /** Number of newline characters that separated this item from the previous
   *  one in the source (0 = same physical line). */
  lineBreaks: number;
}

const TRIVIA = new Set<TokenKind>([
  TokenKind.TERMINATOR,
  TokenKind.EOS,
  TokenKind.OTHER,
]);

function isComment(k: TokenKind): boolean {
  return (
    k === TokenKind.COMMENT ||
    k === TokenKind.COMMENT_NLSEMI ||
    k === TokenKind.LINE_COMMENT ||
    k === TokenKind.LINE_COMMENT_NLSEMI
  );
}

/** Count newlines inside a whitespace/comment token's text. */
function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === "\n") n++;
  return n;
}

/**
 * Convert a token stream into items. Comments are kept (as their own items);
 * pure whitespace is discarded but contributes to `lineBreaks`.
 */
export function itemize(tokens: Token[]): Item[] {
  const items: Item[] = [];
  let pendingNewlines = 0;

  for (const t of tokens) {
    if (TRIVIA.has(t.kind)) continue;
    if (t.kind === TokenKind.WS || t.kind === TokenKind.WS_NLSEMI) {
      pendingNewlines += countNewlines(t.text);
      continue;
    }
    if (isComment(t.kind)) {
      items.push({ tok: t, lineBreaks: pendingNewlines });
      pendingNewlines = 0;
      continue;
    }
    items.push({ tok: t, lineBreaks: pendingNewlines });
    pendingNewlines = 0;
  }
  return items;
}

export function isCommentItem(item: Item): boolean {
  return isComment(item.tok.kind);
}
