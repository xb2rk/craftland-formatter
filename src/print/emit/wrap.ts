/**
 * @module print/emit/wrap - wrapping decision for delimited nodes.
 *
 * Centralizes the `flatRequired → never` / `wrapCalls` vs `wrapCollections`
 * logic so `renderDelimited` stays readable and the formatter's wrapping
 * policy is auditable in one place (mirrors the `Config` knobs).
 */

import { TokenId } from "../../lex/grammar.generated.js";
import type { Config, WrapMode } from "../../format/config.js";
import { hardline, nil, softline, text, ifBreak, type Doc } from "../doc.js";
import { type Node } from "../../syntax/classifier.js";
import { isAssignmentCall, isConditionParen, isInsideLocStringLiteral, isLocStringLiteral, isSignatureParameterList, isStatementCall } from "../../syntax/query.js";
import { hasComma, hasTrailingComma } from "./helpers.js";
import type { Enclosure } from "../../syntax/spacing.js";

/** Result of `resolveWrap`. */
export interface WrapDecision {
  flatRequired: boolean;
  canWrapCall: boolean;
  wrapMode: WrapMode;
  leadingBreak: Doc;
  trailingBreak: Doc;
  trailing: Doc;
}

/**
 * Decide wrapping for a delimited node.
 *
 * @param node - delimiter node.
 * @param config - formatter config.
 * @param enclosure - enclosure kind.
 * @returns wrap decision.
 */
export function resolveWrap(node: Node, config: Config, enclosure: Enclosure): WrapDecision {
  const signatureParameters = enclosure === "paren" && isSignatureParameterList(node);
  const conditionParameters = enclosure === "paren" && isConditionParen(node);
  const statementCall = enclosure === "paren" && isStatementCall(node);
  const isAssignment = isAssignmentCall(node);
  const locStringLiteral = enclosure === "brace" && (isLocStringLiteral(node) || isInsideLocStringLiteral(node));
  const flatRequired = signatureParameters || conditionParameters || (enclosure === "paren" && !statementCall && !isAssignment) || locStringLiteral;

  const isCollection = enclosure === "brace" || enclosure === "bracket";
  let trailing: Doc =
    !flatRequired && hasComma(node) && config.trailingComma !== "never"
      ? config.trailingComma === "always"
        ? text(",")
        : ifBreak(nil, text(","))
      : nil;

  // CALL gắn data (var/return/colon): không `,` , `)` chung hàng với biến cuối.
  // CALL trần/wait: giữ `,` theo trailingComma và `)` xuống dòng - phân biệt bằng isAssignment.
  if (isAssignment) {
    trailing = nil;
  }

  const canWrapCall = enclosure === "paren" && hasComma(node) && (statementCall || isAssignment);
  let wrapMode: WrapMode;
  if (flatRequired || (enclosure === "paren" && !canWrapCall)) {
    wrapMode = "never";
  } else if (enclosure === "paren") {
    wrapMode = config.wrapCalls;
  } else {
    wrapMode = config.wrapCollections;
  }

  // `callBreakStyle` controls leading break for both statement calls (paren) and
  // breakable collections (brace/bracket) - split cases but shared knob.
  // `breakAll`: first element moves to new line (softline → hardline when broken).
  // `hugFirst`: first element stays on opener line (nil), remaining args break.
  const canWrapCollection = enclosure !== "paren" && hasComma(node) && !flatRequired;
  const canWrap = canWrapCall || canWrapCollection;
  let leadingBreak: Doc = wrapMode === "always" ? hardline : softline;
  let trailingBreak: Doc = wrapMode === "always" ? hardline : softline;
  if (canWrap) {
    if (config.callBreakStyle === "hugFirst") {
      leadingBreak = nil;
      trailingBreak = wrapMode === "always" ? hardline : softline;
    } else {
      // breakAll - keep auto's softline so short groups can stay flat; when
      // the group breaks, softline becomes hardline and the first arg moves
      // to its own line.
      leadingBreak = wrapMode === "always" ? hardline : softline;
      trailingBreak = wrapMode === "always" ? hardline : softline;
    }
  }
  // Chỉ CALL gắn data mới `)` chung hàng; CALL trần/wait giữ `)` xuống dòng.
  if (isAssignment) {
    trailingBreak = nil;
  }

  return { flatRequired, canWrapCall, wrapMode, leadingBreak, trailingBreak, trailing };
}
