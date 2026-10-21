/**
 * @fileoverview Column alignment for broken collection entries (Maps and Struct fields).
 *
 * Computes display column widths for entry keys (colons in maps, equals in structs)
 * and emits conditional column padding (`ifBreak`) so keys align neatly when broken
 * across multiple lines, while collapsing to normal spacing when flat.
 */

import { concat, group, ifBreak, text } from "../document.mjs";
import { columns, render } from "../render.mjs";

/** @typedef {import("../types/doc.d.ts").Doc} Doc */

/**
 * Metadata for a single alignable collection row.
 * @typedef {{
 *   parts: readonly any[],
 *   separatorIndex: number,
 *   left: Doc,
 *   width: number,
 *   separator: string
 * }} AlignedRow
 */

/**
 * Format collection entries with aligned colon or equals separators.
 *
 * @param {object} context
 * @param {readonly any[][]} context.items - List of entry parts separated by commas.
 * @param {string} context.owner - The enclosing syntax node kind (e.g. "Collection").
 * @param {(parts: readonly any[], owner: string) => Doc} context.printParts - Callback to print sub-parts into Docs.
 * @param {(previous: any, current: any, owner: string, beforePrevious?: any) => Doc} context.separator - Callback to get spacing separator.
 * @param {(parts: readonly any[]) => any} context.logicalMode - Callback to resolve logical wrap mode for values.
 * @param {any} context.style - Active formatter style options.
 * @returns {Doc[] | null} Array of aligned row Docs, or null if the collection cannot be aligned.
 */
export function alignCollectionEntries({
  items,
  owner,
  printParts,
  separator,
  logicalMode,
  style,
}) {
  // 1. Analyze each item row to locate the key-value separator (':' or '=')
  const rows = items.map((parts) => {
    const separatorIndex = parts.findIndex(
      (part) => part.type === "token" && (part.text === ":" || part.text === "=")
    );

    if (separatorIndex <= 0) {
      return null;
    }

    // Format the key in flat mode to compute its exact displayed column width
    const leftDoc = printParts(parts.slice(0, separatorIndex), owner);
    const flatKey = render(group(leftDoc, "never"), style);

    // If a key itself contains newlines, abort alignment for safety
    if (/[\r\n]/.test(flatKey)) {
      return null;
    }

    return {
      parts,
      separatorIndex,
      left: leftDoc,
      width: columns(flatKey),
      separator: parts[separatorIndex].text,
    };
  });

  // Guard: Alignment requires all rows to have valid separators of identical spelling
  const hasInvalidRow = rows.some((row) => !row || row.separator !== rows[0]?.separator);
  if (hasInvalidRow || rows.length === 0) {
    return null;
  }

  // 2. Find the maximum displayed key width across all rows
  const maxKeyWidth = Math.max(...rows.map((row) => row.width));

  // 3. Construct aligned document nodes with conditional padding
  return rows.map(({ parts, separatorIndex, left, width }) => {
    const separatorToken = parts[separatorIndex];
    const valueParts = parts.slice(separatorIndex + 1);
    const valueDoc = group(printParts(valueParts, owner), logicalMode(valueParts));

    const paddingSpaces = " ".repeat(maxKeyWidth - width);
    const beforeSeparatorDoc = separator(
      parts[separatorIndex - 1],
      separatorToken,
      owner,
      parts[separatorIndex - 2]
    );

    const afterSeparatorDoc = valueParts.length > 0
      ? separator(separatorToken, valueParts[0], owner, parts[separatorIndex - 1])
      : text("");

    // Keep padding inside ifBreak so it applies ONLY when the enclosing collection breaks.
    // In flat mode, no extra column padding is added.
    return concat(
      left,
      ifBreak(text(paddingSpaces)),
      beforeSeparatorDoc,
      text(separatorToken.text),
      afterSeparatorDoc,
      valueDoc
    );
  });
}
