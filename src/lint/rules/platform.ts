/**
 * @module lint/rules/platform - graph platform qualifier placement.
 */

import { TokenId } from "../../lex/grammar.generated.js";
import { DelimKind } from "../../syntax/classifier.js";
import {
  PREFIX_KINDS,
  diagnosticForItem,
  graphHeader,
  hasPlatformBefore,
  isPlatformBracket,
  isWithinGraph,
  type Analysis,
  type Diagnostic,
} from "../analysis.js";
import type { Item } from "../../lex/items.js";

/**
 * Platform rules: graph should have platform, platform decorator placement.
 *
 * @param analysis - analysis.
 * @param diagnostics - diagnostics sink.
 */
export function pushPlatformRules(analysis: Analysis, diagnostics: Diagnostic[]): void {
  for (const node of analysis.nodes) {
    if (node.kind === DelimKind.Block && graphHeader(node) && !hasPlatformBefore(node)) {
      diagnostics.push(
        diagnosticForItem("graph-missing-platform", "Graphs should declare [platform_server] or [platform_client].", "warning", node.open!),
      );
    }
    if (!isPlatformBracket(node) || !node.close) {
      continue;
    }
    const closeIndex = analysis.itemIndex.get(node.close);
    if (closeIndex === undefined) {
      continue;
    }
    let declaration: Item | undefined;
    for (let index = closeIndex + 1; index < analysis.items.length; index += 1) {
      const candidate = analysis.items[index]!;
      if (PREFIX_KINDS.has(candidate.token.kind)) {
        continue;
      }
      if (
        candidate.token.kind === TokenId.GRAPH ||
        candidate.token.kind === TokenId.FUNC ||
        candidate.token.kind === TokenId.EVENT
      ) {
        declaration = candidate;
      }
      break;
    }
    if (declaration && declaration.token.kind !== TokenId.GRAPH && isWithinGraph(analysis, node.close)) {
      diagnostics.push(diagnosticForItem("platform-on-graph", "Platform decorators belong on the graph, not a graph handler.", "warning", node.open!));
    }
  }
}
