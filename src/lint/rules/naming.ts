/**
 * @module lint/rules/naming - naming conventions for funcs, locals, and graph fields.
 */

import { TokenId } from "../../lex/grammar.generated.js";
import { diagnosticForItem, isCamelCase, isConstantName, isDirectGraphField, isName, isPascalCase, type Analysis, type Diagnostic } from "../analysis.js";

/**
 * Naming rules: `func` PascalCase, locals/params camelCase, private fields `_Pascal`/`_UPPER`.
 *
 * @param analysis - analysis.
 * @param diagnostics - diagnostics sink.
 */
export function pushNameRules(analysis: Analysis, diagnostics: Diagnostic[]): void {
  for (let index = 0; index < analysis.items.length; index += 1) {
    const item = analysis.items[index]!;
    const next = analysis.items[index + 1];
    // Function name check: `func Foo` - allow PascalCase (public) or optional _ + camelCase (private)
    // Previous rule was strict PascalCase and rejected `_myFunc` / `myFunc` private style.
    // Now: stripped name (without leading _) must be either PascalCase or camelCase.
    if (item.token.kind === TokenId.FUNC && next && isName(next.token.text)) {
      const name = next.token.text;
      const stripped = name.startsWith("_") ? name.slice(1) : name;
      const ok = isPascalCase(name) || isCamelCase(stripped) || isPascalCase(stripped);
      if (!ok || stripped.length === 0) {
        diagnostics.push(diagnosticForItem("naming-func", "Function names should be PascalCase or optional _ + camelCase/PascalCase.", "warning", next));
      }
    }
    if (item.token.kind !== TokenId.VAR || !next || !isName(next.token.text)) {
      continue;
    }
    if (isDirectGraphField(analysis, item)) {
      if (
        next.token.text.startsWith("_") &&
        !isConstantName(next.token.text) &&
        !isPascalCase(next.token.text.slice(1))
      ) {
        diagnostics.push(
          diagnosticForItem("naming-field", "Private fields should use _PascalCase or _UPPER_SNAKE_CASE.", "warning", next),
        );
      }
      diagnostics.push(diagnosticForItem("graph-field-no-var", "Graph fields must be declared in the graph header, not with var.", "error", item));
    } else if (next.token.text !== "_" && !next.token.text.startsWith("_") && !isCamelCase(next.token.text)) {
      diagnostics.push(diagnosticForItem("naming-local", "Locals and parameters should be camelCase.", "warning", next));
    }
  }
}
