/**
 * @module print/emit/state - mutable sequence accumulator for the Doc emitter.
 *
 * Holds the in-progress `Doc[]` plus spacing/generic state while walking a flat
 * `Item | Node` segment. Kept in its own module so `index.ts` focuses on
 * layout (`renderSequence`/`renderDelimited`/`renderNode`/`emit`); extracting
 * it does not introduce a cycle (`state` → helpers/trivia/spacing only).
 */

import { TokenId } from "../../lex/grammar.generated.js";
import type { Config } from "../../format/config.js";
import { concat, group, hardline, indent, line, softline, text } from "../doc.js";
import { shouldSpaceBefore, type Enclosure, type SpacingContext } from "../../syntax/spacing.js";
import type { Item } from "../../lex/items.js";
import { DelimKind, isNode } from "../../syntax/classifier.js";
import { isGenericOpen } from "./helpers.js";
import { hasBlankLine } from "./helpers.js";
import { renderTrivia } from "./trivia.js";

/**
 * Mutable accumulator while walking a flat segment of `Item | Node` content.
 * Carries spacing suppression flags so the enclosing delimiter can control the
 * first space/break after its opening token.
 */
export interface SequenceState {
  parts: import("../doc.js").Doc[];
  /** Item immediately before `last`; used to distinguish unary +/- from binary operators. */
  beforeLast?: Item;
  last?: Item;
  mode: "root" | "block" | "delimited" | "flat";
  enclosure?: Enclosure;
  genericDepth: number;
  suppressFirstBreak: boolean;
  suppressOpeningSpace: boolean;
  suppressNextSpace: boolean;
  hasLogical: boolean;
  /** True when `last` was a `>` that closed a generic (`List<int>`). Used to keep `List<int> =` spaced while `d > =` becomes `>=`. */
  lastWasGenericClose?: boolean;
}

/**
 * Build the spacing context for the next item.
 *
 * @param state - current sequence state.
 * @param genericOpen - whether the upcoming token opens a generic (e.g. `Type<`).
 * @returns spacing context.
 */
export function contextFor(state: SequenceState, genericOpen: boolean): SpacingContext {
  return {
    enclosure: state.enclosure,
    inGeneric: genericOpen || state.genericDepth > 0,
    previous: state.beforeLast,
  };
}

/**
 * Append a single item (with its leading trivia) to the sequence.
 *
 * @param state - mutable accumulator.
 * @param item - item to append.
 * @param config - formatter config.
 * @param enclosureOverride - override enclosure for spacing (used for the `(` in call headers).
 * @param lookahead - remaining content for generic-open detection.
 */
export function appendItem(
  state: SequenceState,
  item: Item,
  config: Config,
  enclosureOverride?: Enclosure,
  lookahead: readonly import("../../syntax/classifier.js").Content[] = [],
): void {
  if (item.token.kind === TokenId.GREATER_OR_EQUALS && state.genericDepth > 0) {
    const fakeGreater: Item = {
      token: { kind: TokenId.GREATER, text: ">" } as unknown as Item["token"],
      before: item.before,
      lineBreakBefore: item.lineBreakBefore,
    } as unknown as Item;
    appendItem(state, fakeGreater, config, enclosureOverride, lookahead);
    const fakeAssign: Item = {
      token: { kind: TokenId.ASSIGN, text: "=" } as unknown as Item["token"],
      before: [],
      lineBreakBefore: false,
    } as unknown as Item;
    appendItem(state, fakeAssign, config, enclosureOverride, lookahead);
    return;
  }
  const genericOpen = isGenericOpen(state.last, item, lookahead);
  const context = contextFor(state, genericOpen);
  if (enclosureOverride) {
    context.enclosure = enclosureOverride;
  }
  const trivia = renderTrivia(item.before);
  const isLogicalCurrent = item.token.kind === TokenId.LOGICAL_OR || item.token.kind === TokenId.LOGICAL_AND;
  const hasBlockAheadForCurrent = lookahead.some((entry) => isNode(entry as unknown as import("../../syntax/classifier.js").Content) && (entry as unknown as { kind: DelimKind }).kind === DelimKind.Block);
  const prevIsLogical = state.last !== undefined && (state.last.token.kind === TokenId.LOGICAL_OR || state.last.token.kind === TokenId.LOGICAL_AND);
  const hasBlockAhead = hasBlockAheadForCurrent;
  // For header conditions (`if a || b || c {`) enforce after-style `a ||\n  b`,
  // not before-style `a\n|| b`. Suppress break before `||`/`&&` and let the
  // following `b` break after the operator via the softline below.
  const suppressLeadingBreakForLogical = isLogicalCurrent && trivia.leadingBreak && hasBlockAheadForCurrent;

  // Header continuation `a ||\n  b` where `b` has leadingBreak after `||`
  // should keep indent (2 spaces). Handle `b` after `||` with newline specially.
  if (state.last && trivia.leadingBreak && !state.suppressNextSpace) {
    if (prevIsLogical && hasBlockAheadForCurrent) {
      const isBlockFirst = state.mode === "block" && state.suppressFirstBreak;
      if (!isBlockFirst && (!state.suppressFirstBreak || trivia.forcesBreak)) {
        state.parts.push(hardline);
        state.parts.push(trivia.doc, text(item.token.text));
        if (hasBlankLine(item.before)) {
          state.parts.push(hardline);
        }
        state.beforeLast = state.last;
        state.last = item;
        state.suppressFirstBreak = false;
        state.suppressOpeningSpace = false;
        state.suppressNextSpace = false;
        if (item.token.kind === TokenId.LOGICAL_OR || item.token.kind === TokenId.LOGICAL_AND) {
          state.hasLogical = true;
        }
        const wasGenericClose1 = item.token.kind === TokenId.GREATER && state.genericDepth > 0 && !genericOpen;
        if (genericOpen) {
          state.genericDepth += 1;
        } else if (item.token.kind === TokenId.GREATER && state.genericDepth > 0) {
          state.genericDepth -= 1;
        }
        if (item.token.kind === TokenId.GREATER) {
          state.lastWasGenericClose = wasGenericClose1;
        } else {
          state.lastWasGenericClose = false;
        }
        return;
      }
    }
    if (!suppressLeadingBreakForLogical) {
      const isBlockFirst = state.mode === "block" && state.suppressFirstBreak;
      if (isBlockFirst) {
        // Always 0 - block already emitted `hardline` after `{`. Any leading
        // break (including `\n\n` blank) on the first child would duplicate it
        // (`{\n\n  //` → `{\n  //`). Collapse to zero; intentional blank after
        // `{` is normalized away per spec (max 1 elsewhere, 0 at block start).
      } else if (!state.suppressFirstBreak || trivia.forcesBreak) {
        // A comment that starts on a new physical line must keep that break even
        // inside a flat positional literal; otherwise the next pass sees `{//` as
        // an inline comment and changes the layout again.
        state.parts.push(state.mode === "delimited" ? softline : hardline);
        if (hasBlankLine(item.before)) {
          state.parts.push(hardline);
        }
      }
    }
  }
  if (state.last && trivia.leadingSpaceNeeded && !trivia.leadingBreak) {
    state.parts.push(text(" "));
  }

  const blankLine = hasBlankLine(item.before);

  // Trailing operator style: `a ||` then break `  b` (after), not `a` break `|| b` (before).
  // Only for header conditions before `{` (e.g. `if a || b || c {`), not for
  // general expressions like `return a && b || c` which should stay flat.
  // Wrap continuation in `group(indent(line + text))` so it stays flat when header fits (even though outer block is broken) and indents +2 when broken.
  if (prevIsLogical && hasBlockAhead) {
    if (state.last && !trivia.forcesBreak && !state.suppressOpeningSpace && !state.suppressNextSpace) {
      if (!item.lineBreakBefore && !trivia.leadingSpaceNeeded && shouldSpaceBefore(state.last, item, config, context)) {
        state.parts.push(group(indent(concat([line, trivia.doc, text(item.token.text)]))));
        state.beforeLast = state.last;
        state.last = item;
        state.suppressFirstBreak = false;
        state.suppressOpeningSpace = false;
        state.suppressNextSpace = false;
        const wasGenericClose2 = item.token.kind === TokenId.GREATER && state.genericDepth > 0 && !genericOpen;
        if (genericOpen) {
          state.genericDepth += 1;
        } else if (item.token.kind === TokenId.GREATER && state.genericDepth > 0) {
          state.genericDepth -= 1;
        }
        if (item.token.kind === TokenId.GREATER) {
          state.lastWasGenericClose = wasGenericClose2;
        } else {
          state.lastWasGenericClose = false;
        }
        return;
      }
    }
  }

  // Special merge for split comparison operators `> =` / `< =` → `>=` / `<=`
  // `List<int> =` must keep space (generic close), while `d > = BlockBase` must merge.
  const isCmpMerge =
    state.last !== undefined &&
    ((state.last.token.kind === TokenId.GREATER && item.token.kind === TokenId.ASSIGN) ||
      (state.last.token.kind === TokenId.LESS && item.token.kind === TokenId.ASSIGN));
  let cmpMergeHandled = false;
  let cmpShouldSpace = false;
  if (isCmpMerge) {
    const lastWasGenericCloseForCmp = state.lastWasGenericClose === true;
    const shouldMerge = !(state.last!.token.kind === TokenId.GREATER && lastWasGenericCloseForCmp) && !context.inGeneric;
    cmpMergeHandled = true;
    cmpShouldSpace = !shouldMerge && config.spaceAroundOperators;
  }

  if (state.last && !trivia.forcesBreak && !state.suppressOpeningSpace && !state.suppressNextSpace) {
    if (item.lineBreakBefore && state.mode !== "flat" && !trivia.leadingBreak && !state.suppressFirstBreak) {
      state.parts.push(state.mode === "delimited" ? softline : hardline);
      if (blankLine) {
        state.parts.push(hardline);
      }
    } else if (!item.lineBreakBefore && !trivia.leadingSpaceNeeded) {
      if (cmpMergeHandled) {
        if (cmpShouldSpace) state.parts.push(text(" "));
      } else if (shouldSpaceBefore(state.last, item, config, context)) {
        state.parts.push(text(" "));
      }
    }
  } else if (!state.last && item.lineBreakBefore && !state.suppressFirstBreak) {
    state.parts.push(hardline);
    if (blankLine) {
      state.parts.push(hardline);
    }
  }

  state.parts.push(trivia.doc, text(item.token.text));
  state.beforeLast = state.last;
  state.last = item;
  state.suppressFirstBreak = false;
  state.suppressOpeningSpace = false;
  state.suppressNextSpace = false;
  if (item.token.kind === TokenId.LOGICAL_OR || item.token.kind === TokenId.LOGICAL_AND) {
    state.hasLogical = true;
  }

  const wasGenericClose = item.token.kind === TokenId.GREATER && state.genericDepth > 0 && !genericOpen;
  if (genericOpen) {
    state.genericDepth += 1;
  } else if (item.token.kind === TokenId.GREATER && state.genericDepth > 0) {
    state.genericDepth -= 1;
  }
  // Remember whether this `>` closed a generic so next `=` can decide `List<int> =` vs `d >=`.
  if (item.token.kind === TokenId.GREATER) {
    state.lastWasGenericClose = wasGenericClose;
  } else {
    state.lastWasGenericClose = false;
  }
}
