/**
 * @module lint/rules/trailing-comma - trailing comma consistency with formatter.
 *
 * Mirrors `print/emit/wrap.ts:resolveWrap` trailing decision:
 * - flatRequired (signature/condition or non-statement call) → never
 * - trailingComma `never` → never
 * - `always` → always when hasComma
 * - `multiline` → only when original is multiline (contains newline)
 * Fixes `List<object>{a, b,}` weirdness: flat `{a, b}` must not have trailing comma
 * unless `always`; hugFirst/breakAll share same trailing policy.
 */

import { isConditionParen, isSignatureParameterList, isStatementCall } from "../../syntax/query.js";
import { isNode, type Node } from "../../syntax/classifier.js";
import { enclosureOf, hasComma, hasDirectContent, hasTrailingComma } from "../../print/emit/helpers.js";
import { diagnosticForItem, type Analysis, type Diagnostic } from "../analysis.js";
import type { LintOptions } from "../options.js";

/**
 * Trailing comma rule.
 *
 * @param analysis - analysis.
 * @param diagnostics - diagnostics sink.
 * @param config - lint config (needs trailingComma).
 */
export function pushTrailingCommaRules(analysis: Analysis, diagnostics: Diagnostic[], config: Required<LintOptions>): void {
  for (const node of analysis.nodes) {
    if (!node.open || !node.close) {
      continue;
    }
    if (!hasDirectContent(node)) {
      continue;
    }
    if (!hasComma(node)) {
      continue;
    }
    const enclosure = enclosureOf(node.kind);
    const isParen = enclosure === "paren";
    const flatRequired = isSignatureParameterList(node) || isConditionParen(node) || (isParen && !isStatementCall(node));
    if (flatRequired) {
      // Flat-required groups (signatures, conditions, value calls) never have trailing comma.
      if (hasTrailingComma(node)) {
        diagnostics.push(diagnosticForItem("trailing-comma", "Unexpected trailing comma for this group.", "warning", node.close, {
          start: findTrailingCommaStart(node)!,
          end: findTrailingCommaStart(node)! + 1,
          replacement: "",
        }));
      }
      continue;
    }

    const trailingComma = config.trailingComma;
    if (trailingComma === "never") {
      if (hasTrailingComma(node)) {
        diagnostics.push(diagnosticForItem("trailing-comma", "Trailing commas are not allowed (trailingComma: never).", "warning", node.close, {
          start: findTrailingCommaStart(node)!,
          end: findTrailingCommaStart(node)! + 1,
          replacement: "",
        }));
      }
      continue;
    }

    const slice = analysis.source.slice(node.open.token.span.end.offset, node.close.token.span.start.offset);
    const isMultiline = slice.includes("\n") || slice.includes("\r");

    let expected = false;
    if (trailingComma === "always") {
      expected = true;
    } else if (trailingComma === "multiline") {
      expected = isMultiline;
    }

    const hasTrailing = hasTrailingComma(node);
    if (expected && !hasTrailing) {
      // Insert comma before close.
      diagnostics.push(diagnosticForItem("trailing-comma", "Missing trailing comma for multiline group.", "warning", node.close, {
        start: node.close.token.span.start.offset,
        end: node.close.token.span.start.offset,
        replacement: ",",
      }));
    } else if (!expected && hasTrailing) {
      const start = findTrailingCommaStart(node);
      if (start !== undefined) {
        diagnostics.push(diagnosticForItem("trailing-comma", "Unexpected trailing comma for single-line group.", "warning", node.close, {
          start,
          end: start + 1,
          replacement: "",
        }));
      }
    }
  }
}

function findTrailingCommaStart(node: Node): number | undefined {
  // Walk content backwards to find last comma that is trailing.
  for (let i = node.content.length - 1; i >= 0; i--) {
    const entry = node.content[i]!;
    if (isNode(entry as any)) {
      const n = entry as Node;
      if (n.close) {
        // Nested node close before trailing comma? Continue.
        continue;
      }
    } else {
      const item = entry as any;
      if (item.token && item.token.text === ",") {
        // Check if everything after this comma up to close is only trivia/empty.
        // hasTrailingComma already guarantees this is trailing, so return its start.
        return item.token.span.start.offset;
      }
      if (item.token && item.token.text.trim() !== "" && item.token.text !== ",") {
        // Found non-comma content before trailing position.
        break;
      }
    }
  }
  return undefined;
}
