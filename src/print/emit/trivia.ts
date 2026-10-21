/**
 * @module print/emit/trivia - trivia rendering helpers for the Doc emitter.
 */

import { concat, hardline, nil, text, type Doc } from "../doc.js";
import type { Trivia } from "../../lex/items.js";

export interface TriviaDoc {
  /** Doc fragment for this trivia slice. */
  doc: Doc;
  /** A comment itself already emits a line boundary. */
  forcesBreak: boolean;
  /** Trivia begins after a physical newline (the comment is leading). */
  leadingBreak: boolean;
  /** The first comment starts on the previous token's physical line. */
  leadingSpaceNeeded: boolean;
}

/**
 * Check if trivia contains any comment.
 *
 * @param trivia - trivia slice.
 * @returns true if it contains a line or block comment.
 */
export function hasComment(trivia: readonly Trivia[]): boolean {
  return trivia.some((entry) => entry.kind !== "whitespace");
}

/**
 * Check if text contains a line break (`\n` or `\r\n`).
 *
 * @param value - text to test.
 * @returns true if it contains a newline.
 */
function containsNewline(value: string): boolean {
  return /\r?\n/u.test(value);
}

/**
 * Check if text contains a blank line (two newlines with optional spaces, CRLF-aware).
 *
 * @param value - text to test.
 * @returns true if it contains a blank line.
 */
function containsBlankLine(value: string): boolean {
  return /\r?\n[ \t]*\r?\n/u.test(value);
}

/**
 * Render trivia to a `Doc` fragment.
 *
 * @param trivia - source trivia slice.
 * @returns trivia doc with break/space hints.
 */
export function renderTrivia(trivia: readonly Trivia[]): TriviaDoc {
  if (trivia.length === 0) {
    return { doc: nil, forcesBreak: false, leadingBreak: false, leadingSpaceNeeded: false };
  }
  const parts: Doc[] = [];
  let forcesBreak = false;
  let atLineStart = false;
  let sawComment = false;
  let leadingBreak = false;
  let leadingSpaceNeeded = false;
  for (const entry of trivia) {
    if (entry.kind === "whitespace") {
      if (containsNewline(entry.token.text)) {
        atLineStart = true;
        if (!sawComment) {
          leadingBreak = true;
        } else if (containsBlankLine(entry.token.text)) {
          // Blank line between two comments (e.g. `// ==========` → `/**`) must
          // survive as one empty line - semantic, not raw `"\n\n"` counting in emit.
          parts.push(hardline);
        }
      }
      continue;
    }
    sawComment = true;
    const raw = entry.token.text;
    if (!atLineStart && !leadingSpaceNeeded) {
      leadingSpaceNeeded = true;
    }
    if (entry.kind === "line-comment") {
      parts.push(text(raw), hardline);
      forcesBreak = true;
      atLineStart = true;
      continue;
    }
    const wasAtLineStart = atLineStart;
    parts.push(text(raw));
    if (containsNewline(raw)) {
      forcesBreak = true;
      atLineStart = true;
      if (!/\r?\n$/u.test(raw)) {
        parts.push(hardline);
      }
    } else if (wasAtLineStart) {
      // Block comment that started a line (e.g. `/** doc */` before `[platform_server]`)
      // must stay on its own line - the following `\n` in trivia is consumed as
      // whitespace, so emit an explicit hardline here.
      parts.push(hardline);
      atLineStart = true;
    } else {
      parts.push(text(" "));
      atLineStart = false;
    }
  }
  return { doc: concat(parts), forcesBreak, leadingBreak, leadingSpaceNeeded };
}
