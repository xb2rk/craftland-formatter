/**
 * @module lint/rules/shape - structural shape: parens, TS syntax, constructors, wait.
 */

import { TokenId } from "../../lex/grammar.generated.js";
import { DelimKind } from "../../syntax/classifier.js";
import { isConditionParen, isSignatureParameterList } from "../../syntax/query.js";
import { VECTOR_CONSTRUCTOR_KINDS, diagnosticForItem, previousDirectItem, type Analysis, type Diagnostic } from "../analysis.js";
import { isNode } from "../../syntax/classifier.js";

/**
 * Shape rules: condition parens, TS param syntax, vector constructors, `.wait` etc.
 *
 * @param analysis - analysis.
 * @param diagnostics - diagnostics sink.
 */
export function pushShapeRules(analysis: Analysis, diagnostics: Diagnostic[]): void {
  for (const node of analysis.nodes) {
    if (node.kind === DelimKind.Paren && isConditionParen(node) && node.open && node.close) {
      const start = node.open.token.span.end.offset;
      const end = node.close.token.span.start.offset;
      diagnostics.push(
        diagnosticForItem("condition-no-parens", "Project style omits wrapping parentheses around conditions.", "warning", node.open, {
          start: node.open.token.span.start.offset,
          end: node.close.token.span.end.offset,
          replacement: analysis.source.slice(start, end),
        }),
      );
    }
    if (node.kind === DelimKind.Paren && node.open && isSignatureParameterList(node)) {
      if (node.content.some((entry) => !isNode(entry) && entry.token.kind === TokenId.COLON)) {
        diagnostics.push(
          diagnosticForItem("ts-param-syntax", "FC parameters use `name Type`, not TypeScript `name: Type` syntax.", "error", node.open),
        );
      }
    }
    if (node.kind === DelimKind.Paren && node.open) {
      const previous = previousDirectItem(node);
      if (previous && VECTOR_CONSTRUCTOR_KINDS.has(previous.token.kind)) {
        diagnostics.push(diagnosticForItem("no-constructor-call", "Vector values use brace literals, not constructor calls.", "error", previous));
      }
    }
  }

  for (let index = 0; index + 1 < analysis.items.length; index += 1) {
    const current = analysis.items[index]!;
    const next = analysis.items[index + 1]!;
    if (current.token.kind === TokenId.DOT && next.token.kind === TokenId.WAIT) {
      diagnostics.push(diagnosticForItem("no-wait-dot", "Use prefix `wait`, not `.wait()`.", "error", next));
    }
    // Detect `func name ReturnType` (missing parens) - return type should be after `()`.
    if (
      current.token.kind === TokenId.FUNC &&
      analysis.items[index + 2] &&
      analysis.items[index + 1]!.token.kind === TokenId.IDENTIFIER &&
      analysis.items[index + 2]!.token.kind !== TokenId.L_PAREN
    ) {
      const candidate = analysis.items[index + 2]!;
      if (candidate.token.kind !== TokenId.L_CURLY) {
        diagnostics.push(diagnosticForItem("return-type-position", "Function return types follow the parameter list.", "error", candidate));
      }
    }
  }
}


