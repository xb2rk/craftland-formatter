/**
 * @module format/format - public, side-effect-free formatting pipeline.
 */

import { classify } from "../syntax/classifier.js";
import { resolveConfig, type Config } from "./config.js";
import { emit } from "../print/emit/index.js";
import { itemize } from "../lex/items.js";
import { collectImports, sortedImportFacts } from "../lint/analysis.js";
import { normalize } from "../print/normalize.js";
import { printDoc } from "../print/doc.js";
import { importBucket } from "../shared/import-bucket.js";
import { tokenize } from "../lex/tokenizer.js";

/**
 * Format one complete `.fcg` or `.fcc` source document.
 *
 * Every stage consumes the previous stage's typed model; no later stage scans
 * source text again. Passing partial options is supported for library callers,
 * while the resolved object is always what reaches the printer.
 *
 * @param source - raw source text.
 * @param config - resolved or partial config.
 * @returns formatted source.
 */
/**
 * Quote a module path as a double-quoted literal.
 *
 * @param value - unquoted path.
 * @returns quoted literal.
 */
function quoteImportPath(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

/**
 * Render one import fact to source text.
 *
 * @param fact - import fact.
 * @returns source line.
 */
function renderImportFact(fact: ReturnType<typeof collectImports>[number]): string {
  if (fact.kind === "library") {
    return `import ${quoteImportPath(fact.path)} as ${fact.alias!}`;
  }
  return `import ${fact.raw}${fact.alias ? ` as ${fact.alias}` : ""} from ${quoteImportPath(fact.path)}`;
}

/**
 * Map a bucket to a visual group for blank-line insertion.
 * Group 0: library normal (0) + Std (1) + EditorGen (2) + script from (3)
 * Group 1: Contracts (4)
 * Group 2: ../ depth (5)
 * Group 3: ./ local (6)
 *
 * @param bucket - bucket 0–6.
 * @returns group 0–3.
 */
function bucketGroup(bucket: number): number {
  if (bucket <= 3) {
    return 0;
  }
  if (bucket === 4) {
    return 1;
  }
  if (bucket === 5) {
    return 2;
  }
  return 3;
}

/**
 * Sort the leading import block deterministically and render it.
 * One blank line is inserted between groups:
 *   [library, Std, EditorGen, `from`] → Contracts → ../ → ./
 *
 * @param source - raw source.
 * @returns source with imports sorted, or original if already sorted / no imports.
 */
function withSortedImports(source: string): string {
  const document = itemize(tokenize(source));
  const imports = collectImports(document.items);
  if (imports.length <= 1) {
    return source;
  }
  const sorted = sortedImportFacts(imports);
  const first = imports[0]!.importItem;
  const last = imports[imports.length - 1]!.endItem;
  const start = first.token.span.start.offset;
  const end = last.token.span.end.offset;
  const lines: string[] = [];
  let previousGroup: number | undefined;
  for (const fact of sorted) {
    const bucket = importBucket(fact.kind, fact.path);
    const group = bucketGroup(bucket);
    if (previousGroup !== undefined && group !== previousGroup) {
      lines.push("");
    }
    lines.push(renderImportFact(fact));
    previousGroup = group;
  }
  const rendered = lines.join("\n");
  const originalSlice = source.slice(start, end);
  if (originalSlice === rendered) {
    return source;
  }
  // Also check order-only fast path: if already sorted and slice already matches, skip.
  let alreadySorted = true;
  for (let index = 0; index < imports.length; index += 1) {
    if (imports[index] !== sorted[index]) {
      alreadySorted = false;
      break;
    }
  }
  if (alreadySorted && originalSlice === rendered) {
    return source;
  }
  return `${source.slice(0, start)}${rendered}${source.slice(end)}`;
}

export function formatSource(source: string, config: Config | Partial<Config> = {}): string {
  const resolved = resolveConfig(config);
  const withImports = withSortedImports(source);
  const document = itemize(tokenize(withImports));
  const tree = classify(document);
  const doc = emit(tree, resolved);
  return normalize(printDoc(doc, resolved), resolved);
}
