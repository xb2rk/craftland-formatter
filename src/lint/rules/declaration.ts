/**
 * @module lint/rules/declaration - event prefix and JSDoc presence for public decls.
 */

import { TokenId } from "../../lex/grammar.generated.js";
import { DECLARATION_KINDS, diagnosticForItem, hasJSDoc, isName, isWithinGraph, type Analysis, type Diagnostic } from "../analysis.js";

/** Event prefix regex. */
const EVENT_PREFIX_RE = /^((Request|Notify|Fact)_[A-Za-z0-9_]+|On[A-Z][A-Za-z0-9_]*)$/u;

/**
 * Declaration rules: event prefix, public decl JSDoc inside graph.
 *
 * @param analysis - analysis.
 * @param diagnostics - diagnostics sink.
 */
export function pushDeclarationRules(analysis: Analysis, diagnostics: Diagnostic[]): void {
  for (let index = 0; index < analysis.items.length; index += 1) {
    const item = analysis.items[index]!;
    if (item.token.kind === TokenId.EVENT) {
      const name = analysis.items[index + 1];
      if (name && isName(name.token.text) && !EVENT_PREFIX_RE.test(name.token.text)) {
        diagnostics.push(
          diagnosticForItem(
            "event-name-prefix",
            "Events should use Request_, Notify_, or Fact_ prefixes (OnX is reserved for lifecycle events).",
            "warning",
            name,
          ),
        );
      }
    }
    if (!DECLARATION_KINDS.has(item.token.kind) || item.token.kind === TokenId.GRAPH) {
      continue;
    }
    if (!isWithinGraph(analysis, item)) {
      continue;
    }
    if (!hasJSDoc(analysis.items, index)) {
      diagnostics.push(diagnosticForItem("jsdoc-missing", "Public declarations should have a /** */ JSDoc comment.", "warning", item));
    }
  }
}
