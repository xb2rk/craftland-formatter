/**
 * @module lint/rules/enum - enum member namespace consistency.
 */

import { TokenId } from "../../lex/grammar.generated.js";
import { DelimKind, isNode } from "../../syntax/classifier.js";
import { ENUM_KINDS, diagnosticForItem, hasHeader, isName, type Analysis, type Diagnostic } from "../analysis.js";

/**
 * Enum member namespace consistency.
 *
 * @param analysis - analysis.
 * @param diagnostics - diagnostics sink.
 */
export function pushEnumRules(analysis: Analysis, diagnostics: Diagnostic[]): void {
  for (const node of analysis.nodes) {
    if (node.kind !== DelimKind.Block || !hasHeader(node, ENUM_KINDS)) {
      continue;
    }
    const names = node.content
      .flatMap((entry) => (isNode(entry) ? [] : [entry]))
      .filter((item) => isName(item.token.text) && item.token.kind !== TokenId.ASSIGN)
      .filter((item) => item.token.kind !== TokenId.COMMA);
    const prefixes = new Set<string>();
    for (const item of names) {
      if (!item.token.text.includes("_")) {
        continue;
      }
      const prefix = item.token.text.split("_", 1)[0];
      if (prefix) {
        prefixes.add(prefix);
      }
    }
    if (prefixes.size === 0) {
      continue;
    }
    for (const item of names) {
      if (![...prefixes].some((prefix) => item.token.text.startsWith(`${prefix}_`))) {
        diagnostics.push(diagnosticForItem("enum-member-namespace", "Enum members should use a consistent <Domain>_ prefix.", "warning", item));
      }
    }
  }
}
