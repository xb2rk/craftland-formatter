/**
 * @module lint/rules/style - bracketSpacing, spaceInside*, and line length.
 */

import { TokenId } from "../../lex/grammar.generated.js";
import { DelimKind } from "../../syntax/classifier.js";
import { diagnosticAt, diagnosticForItem, type Analysis, type Diagnostic } from "../analysis.js";
import type { LintOptions } from "../options.js";
import type { Item } from "../../lex/items.js";

/**
 * Check if an item has a comment in its trivia.
 *
 * @param item - item to test.
 * @returns true if it has a comment.
 */
function hasCommentBefore(item: Item): boolean {
  return item.before.some((entry) => entry.kind !== "whitespace");
}

/**
 * Style rules: `bracketSpacing` and `spaceInside*`.
 *
 * @param analysis - analysis.
 * @param diagnostics - diagnostics sink.
 * @param config - lint style config.
 */
export function pushStyleRules(analysis: Analysis, diagnostics: Diagnostic[], config: Required<LintOptions>): void {
  const { source, items, itemIndex, nodes } = analysis;

  const checkGap = (prev: Item, next: Item, expectedHasSpace: boolean, ruleId: string, message: string): void => {
    if (next.lineBreakBefore) {
      return;
    }
    if (hasCommentBefore(next)) {
      return;
    }
    const prevEnd = prev.token.span.end.offset;
    const nextStart = next.token.span.start.offset;
    const slice = source.slice(prevEnd, nextStart);
    if (slice.includes("\n") || slice.includes("\r")) {
      return;
    }
    const actualHasSpace = slice.length > 0;
    const actualIsSingleSpace = slice === " ";
    const mismatch = expectedHasSpace ? !actualIsSingleSpace : actualHasSpace;
    if (!mismatch) {
      return;
    }
    const replacement = expectedHasSpace ? " " : "";
    const fix = { start: prevEnd, end: nextStart, replacement };
    // Report at the opening/closing edge for precise range.
    diagnostics.push(diagnosticForItem(ruleId, message, "warning", next, fix));
  };

  // bracketSpacing: space before ` {` composites (and blocks always require a space)
  for (const node of nodes) {
    const open = node.open;
    if (!open || open.token.kind !== TokenId.L_CURLY) {
      continue;
    }
    const openIdx = itemIndex.get(open);
    if (openIdx === undefined || openIdx === 0) {
      continue;
    }
    const prev = items[openIdx - 1]!;
    const expected = node.kind === DelimKind.Block ? true : config.bracketSpacing === "space";
    const message = expected ? "Expected a single space before '{'." : "Unexpected space before '{'.";
    checkGap(prev, open, expected, "bracket-spacing", message);
  }

  for (const node of nodes) {
    const open = node.open;
    const close = node.close;
    if (!open || !close) {
      continue;
    }
    const openIdx = itemIndex.get(open);
    const closeIdx = itemIndex.get(close);
    if (openIdx === undefined || closeIdx === undefined) {
      continue;
    }
    const interior = items.slice(openIdx + 1, closeIdx);
    if (node.kind === DelimKind.Paren) {
      const expected = config.spaceInsideParens;
      const msgAfter = expected ? "Expected a single space after '('." : "Unexpected space after '('."; 
      const msgBefore = expected ? "Expected a single space before ')'." : "Unexpected space before ')'."; 
      if (interior.length === 0) {
        // Empty `()` - spec says no inside space (before !== L_PAREN guard)
        continue;
      }
      const first = interior[0]!;
      const last = interior[interior.length - 1]!;
      checkGap(open, first, expected, "space-inside-parens", msgAfter);
      checkGap(last, close, expected, "space-inside-parens", msgBefore);
    } else if (node.kind === DelimKind.Bracket) {
      const expected = config.spaceInsideBrackets;
      const msgAfter = expected ? "Expected a single space after '['." : "Unexpected space after '['.";
      const msgBefore = expected ? "Expected a single space before ']'." : "Unexpected space before ']'.";
      if (interior.length === 0) {
        continue;
      }
      const first = interior[0]!;
      const last = interior[interior.length - 1]!;
      checkGap(open, first, expected, "space-inside-brackets", msgAfter);
      checkGap(last, close, expected, "space-inside-brackets", msgBefore);
    } else if (node.kind === DelimKind.Data || node.kind === DelimKind.Struct || node.kind === DelimKind.Map) {
      const expected = config.spaceInsideBraces;
      const msgAfter = expected ? "Expected a single space after '{'." : "Unexpected space after '{'.";
      const msgBefore = expected ? "Expected a single space before '}'." : "Unexpected space before '}'.";
      if (interior.length === 0) {
        continue;
      }
      const first = interior[0]!;
      const last = interior[interior.length - 1]!;
      checkGap(open, first, expected, "space-inside-braces", msgAfter);
      checkGap(last, close, expected, "space-inside-braces", msgBefore);
    }
  }
}

/**
 * Advisory line-length rule.
 *
 * @param analysis - analysis.
 * @param diagnostics - diagnostics sink.
 * @param printWidth - max width.
 */
export function pushLineLengthRules(analysis: Analysis, diagnostics: Diagnostic[], printWidth: number): void {
  let line = 1;
  const lines = analysis.source.split(/\r\n|\r|\n/u);
  for (const text of lines) {
    const length = text.length;
    if (length > printWidth) {
      diagnostics.push(
        diagnosticAt("line-too-long", `Line exceeds printWidth (${printWidth}).`, "warning", line, printWidth + 1, length - printWidth),
      );
    }
    line += 1;
  }
}
