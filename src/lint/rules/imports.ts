/**
 * @module lint/rules/imports - import alias, reserved abbreviations, and ordering.
 */

import { collectImports, diagnosticForItem, diagnosticForRange, sortedImportFacts, type Analysis, type Diagnostic } from "../analysis.js";
import { importBucket } from "../../shared/import-bucket.js";

/**
 * Quote a module path.
 *
 * @param value - unquoted path.
 * @returns quoted literal.
 */
function quotePath(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

/**
 * Render one import fact to source text (mirrors `format/format.ts`).
 *
 * @param fact - import fact.
 * @returns source line.
 */
function renderFact(fact: ReturnType<typeof collectImports>[number]): string {
  if (fact.kind === "library") {
    return `import ${quotePath(fact.path)} as ${fact.alias!}`;
  }
  return `import ${fact.raw}${fact.alias ? ` as ${fact.alias}` : ""} from ${quotePath(fact.path)}`;
}

/**
 * Map bucket to visual group (mirrors `format/format.ts`).
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
 * Render sorted imports with one blank line between groups.
 *
 * @param sorted - sorted import facts.
 * @returns rendered block.
 */
function renderSortedBlock(sorted: ReturnType<typeof sortedImportFacts>): string {
  const lines: string[] = [];
  let previousGroup: number | undefined;
  for (const fact of sorted) {
    const bucket = importBucket(fact.kind, fact.path);
    const group = bucketGroup(bucket);
    if (previousGroup !== undefined && group !== previousGroup) {
      lines.push("");
    }
    lines.push(renderFact(fact));
    previousGroup = group;
  }
  return lines.join("\n");
}

/**
 * Import rules: library alias required, reserved abbrevs, alias matching, ordering.
 *
 * @param analysis - analysis.
 * @param diagnostics - diagnostics sink.
 */
export function pushImportRules(analysis: Analysis, diagnostics: Diagnostic[]): void {
  const imports = collectImports(analysis.items);
  for (const entry of imports) {
    if (entry.kind === "library") {
      const stem = entry.path.replace(/\.fcc$/iu, "");
      if (!entry.alias) {
        diagnostics.push(diagnosticForItem("import-library-alias", "Library imports require an alias.", "error", entry.importItem));
      } else if ((entry.path === "StdLibrary.fcc" || entry.path === "EditorGenLib.fcc") && entry.alias !== stem) {
        diagnostics.push(
          diagnosticForItem(
            "import-reserved-abbrev",
            `Reserved library aliases must be ${stem}.`,
            "warning",
            entry.aliasItem ?? entry.importItem,
            {
              start: (entry.aliasItem ?? entry.importItem).token.span.start.offset,
              end: (entry.aliasItem ?? entry.importItem).token.span.end.offset,
              replacement: stem,
            },
          ),
        );
      }
    } else if (entry.alias && entry.alias !== entry.raw) {
      diagnostics.push(
        diagnosticForItem(
          "import-alias-mismatch",
          `Script import alias should match ${entry.raw}.`,
          "warning",
          entry.aliasItem ?? entry.importItem,
          {
            start: (entry.aliasItem ?? entry.importItem).token.span.start.offset,
            end: (entry.aliasItem ?? entry.importItem).token.span.end.offset,
            replacement: entry.raw,
          },
        ),
      );
    }
    if (entry.alias?.includes(".")) {
      const first = entry.aliasItem ?? entry.importItem;
      diagnostics.push(
        diagnosticForRange("import-alias-dotted", "Import aliases must be a single identifier.", "error", first, entry.aliasEndItem ?? first),
      );
    }
    if (entry.path.includes(".craftland") || entry.path.includes("node_modules")) {
      diagnostics.push(
        diagnosticForItem(
          "package-cache-import",
          "Import paths must not reference a package cache.",
          "error",
          entry.pathItem ?? entry.importItem,
        ),
      );
    }
  }

  // Order check: compare source order vs sorted order and blank groups.
  const sorted = sortedImportFacts(imports);
  if (imports.length > 0) {
    const first = imports[0]!.importItem;
    const last = imports[imports.length - 1]!.endItem;
    const rendered = renderSortedBlock(sorted);
    // Use source slice to also catch missing blanks when order is correct.
    // `analysis.source` may be undefined when called via `lintSource` with raw string; fall back to reconstructing from items.
    const start = first.token.span.start.offset;
    const end = last.token.span.end.offset;
    const originalSlice = analysis.source.slice(start, end);
    let needsSort = originalSlice !== rendered;
    if (!needsSort) {
      for (let index = 0; index < imports.length; index += 1) {
        if (imports[index] !== sorted[index]) {
          needsSort = true;
          break;
        }
      }
    }
    if (needsSort) {
      diagnostics.push(
        diagnosticForItem("import-order", "Imports should be sorted into the standard buckets.", "warning", first, {
          start,
          end,
          replacement: rendered,
        }),
      );
    }
  }
}
