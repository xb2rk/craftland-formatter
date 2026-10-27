/**
 * @fileoverview Column alignment for declarations (Enums, Tuples, Components in .fcc, Graph fields in .fcg).
 *
 * Computes display column widths for declaration elements:
 * - Enum declarations: aligns equals signs (=)
 * - Tuple / Component / Graph fields: aligns names, types, and equals signs (=)
 *
 * Groups of fields separated by blank lines or non-field members are treated as
 * independent alignment scopes.
 */

import { concat, text } from "../document.mjs";
import { columns, render } from "../render.mjs";

/**
 * Maximum column difference permitted between the shortest and longest identifier or type.
 * Gaps wider than 30 columns are rejected to prevent excessive whitespace padding in mismatched groups.
 */
const MAX_ALIGNMENT_GAP = 30;

/**
 * Align declaration entries in a DeclarationBlock or GraphBlock.
 *
 * @param {object} context
 * @param {readonly any[]} context.entries - Child entries/parts of the block.
 * @param {string} context.owner - The enclosing syntax node kind ("DeclarationBlock" | "GraphBlock").
 * @param {string} [context.declarationKind] - Header kind ("enum" | "tuple" | "component" | "graph").
 * @param {string} context.source - Complete source text.
 * @param {(node: any) => any[]} context.getParts - Function returning parts for a node.
 * @param {(parts: readonly any[], owner: string) => any} context.printParts - Function to print parts.
 * @param {any} context.style - Formatter style options.
 * @returns {Map<any, any> | null} Map from entry to aligned Doc, or null if no alignment applied.
 */
export function alignDeclarationEntries({
  entries,
  owner,
  declarationKind,
  source,
  getParts,
  printParts,
  style,
}) {
  if (!declarationKind) {
    return null;
  }

  const isEnum = declarationKind === "enum";
  const isField = ["tuple", "component", "graph"].includes(declarationKind);

  if (isEnum && style.alignment?.enums === false) {
    return null;
  }
  if (isField && style.alignment?.fields === false) {
    return null;
  }
  if (!isEnum && !isField) {
    return null;
  }

  // 1. Partition consecutive Property entries into independent groups separated by blank lines or functions
  const groups = [];
  let currentGroup = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (entry.type === "node" && entry.node.kind === "Property") {
      if (currentGroup.length > 0) {
        const prevEntry = entries[i - 1];
        const gap = source.slice(prevEntry.end, entry.start);
        const sourceBlanks = Math.max(0, (gap.match(/\r\n|\r|\n/g) ?? []).length - 1);

        if (sourceBlanks > 0) {
          groups.push(currentGroup);
          currentGroup = [];
        }
      }
      currentGroup.push(entry);
    } else if (entry.type === "node" && (entry.node.kind === "Function" || entry.node.kind === "EventListener")) {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
      }
    } else if (entry.type === "token") {
      // Standalone comments: if preceded by a blank line, break group
      if (currentGroup.length > 0 && i > 0) {
        const prevEntry = entries[i - 1];
        const gap = source.slice(prevEntry.end, entry.start);
        const sourceBlanks = Math.max(0, (gap.match(/\r\n|\r|\n/g) ?? []).length - 1);

        if (sourceBlanks > 0) {
          groups.push(currentGroup);
          currentGroup = [];
        }
      }
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  if (groups.length === 0) {
    return null;
  }

  const alignedMap = new Map();

  for (const group of groups) {
    if (group.length < 2) {
      continue;
    }

    if (isEnum) {
      alignEnumGroup(group, { getParts, printParts, style, alignedMap });
    } else if (isField) {
      alignFieldGroup(group, { getParts, printParts, style, alignedMap });
    }
  }

  return alignedMap.size > 0 ? alignedMap : null;
}

/**
 * Align equals signs in an enum declaration group.
 */
function alignEnumGroup(group, { getParts, printParts, style, alignedMap }) {
  const parsedRows = [];

  for (const entry of group) {
    const parts = getParts(entry.node);
    const assignIndex = parts.findIndex((p) => p.type === "token" && p.text === "=");

    if (assignIndex <= 0) {
      parsedRows.push({ entry, hasAssign: false, parts });
      continue;
    }

    const nameParts = parts.slice(0, assignIndex);
    const valueParts = parts.slice(assignIndex + 1);
    const nameDoc = printParts(nameParts, "Property");
    let nameWidth;

    if (nameParts.length === 1 && nameParts[0].type === "token") {
      nameWidth = columns(nameParts[0].text);
    } else {
      const renderedName = render(nameDoc, style);
      if (/[\r\n]/.test(renderedName)) {
        return;
      }
      nameWidth = columns(renderedName);
    }

    parsedRows.push({
      entry,
      hasAssign: true,
      nameParts,
      nameDoc,
      nameWidth,
      valueParts,
    });
  }

  const assignRows = parsedRows.filter((r) => r.hasAssign);
  if (assignRows.length < 2) {
    return;
  }

  const nameWidths = assignRows.map((r) => r.nameWidth);
  const maxNameWidth = Math.max(...nameWidths);
  const minNameWidth = Math.min(...nameWidths);

  // Safety threshold: do not pad excessively wide gaps
  if (maxNameWidth - minNameWidth > MAX_ALIGNMENT_GAP) {
    return;
  }

  const assignSpacing = style.spacing?.assignment === "compact" ? "=" : " = ";

  for (const row of assignRows) {
    const pad = " ".repeat(maxNameWidth - row.nameWidth);
    const valueDoc = printParts(row.valueParts, "Property");
    const doc = concat(row.nameDoc, text(pad + assignSpacing), valueDoc);
    alignedMap.set(row.entry, doc);
  }
}

/**
 * Align names, types, and equals signs in a tuple/component/graph field group.
 */
function alignFieldGroup(group, { getParts, printParts, style, alignedMap }) {
  const parsedRows = [];

  for (const entry of group) {
    const parts = getParts(entry.node);
    const assignIndex = parts.findIndex((p) => p.type === "token" && p.text === "=");

    const declParts = assignIndex > 0 ? parts.slice(0, assignIndex) : parts;
    const valueParts = assignIndex > 0 ? parts.slice(assignIndex + 1) : [];

    // Separate optional leading decorators from identifier
    let nameIndex = 0;
    while (
      nameIndex < declParts.length &&
      declParts[nameIndex].type === "node" &&
      declParts[nameIndex].node.kind === "Decorator"
    ) {
      nameIndex += 1;
    }

    if (nameIndex >= declParts.length) {
      return;
    }

    const decoratorParts = declParts.slice(0, nameIndex);
    const nameParts = [declParts[nameIndex]];
    const typeParts = declParts.slice(nameIndex + 1);

    const nameDoc = printParts(nameParts, "Property");
    let nameWidth;
    if (nameParts[0]?.type === "token") {
      nameWidth = columns(nameParts[0].text);
    } else {
      const renderedName = render(nameDoc, style);
      if (/[\r\n]/.test(renderedName)) {
        return;
      }
      nameWidth = columns(renderedName);
    }

    let typeDoc = null;
    let typeWidth = 0;

    if (typeParts.length > 0) {
      typeDoc = printParts(typeParts, "Property");
      if (typeParts.length === 1 && typeParts[0].type === "token") {
        typeWidth = columns(typeParts[0].text);
      } else {
        const renderedType = render(typeDoc, style);
        if (/[\r\n]/.test(renderedType)) {
          return;
        }
        typeWidth = columns(renderedType);
      }
    }

    parsedRows.push({
      entry,
      decoratorParts,
      nameParts,
      nameDoc,
      nameWidth,
      typeParts,
      typeDoc,
      typeWidth,
      hasType: typeParts.length > 0,
      hasAssign: assignIndex > 0,
      valueParts,
    });
  }

  const nameWidths = parsedRows.map((r) => r.nameWidth);
  const maxNameWidth = Math.max(...nameWidths);
  const minNameWidth = Math.min(...nameWidths);

  if (maxNameWidth - minNameWidth > MAX_ALIGNMENT_GAP) {
    return;
  }

  const typedRows = parsedRows.filter((r) => r.hasType);
  const alignTypes = typedRows.length >= 2;
  const maxTypeWidth = alignTypes ? Math.max(...typedRows.map((r) => r.typeWidth)) : 0;
  const minTypeWidth = alignTypes ? Math.min(...typedRows.map((r) => r.typeWidth)) : 0;

  if (alignTypes && maxTypeWidth - minTypeWidth > MAX_ALIGNMENT_GAP) {
    return;
  }

  const assignSpacing = style.spacing?.assignment === "compact" ? "=" : " = ";

  for (const row of parsedRows) {
    const segments = [];

    if (row.decoratorParts.length > 0) {
      segments.push(printParts(row.decoratorParts, "Property"), text(" "));
    }

    segments.push(row.nameDoc);

    if (row.hasType) {
      const padName = " ".repeat(maxNameWidth - row.nameWidth);
      segments.push(text(padName + " "), row.typeDoc);

      if (row.hasAssign) {
        const padType = alignTypes ? " ".repeat(maxTypeWidth - row.typeWidth) : "";
        segments.push(text(padType + assignSpacing), printParts(row.valueParts, "Property"));
      }
    } else if (row.hasAssign) {
      const padName = " ".repeat(maxNameWidth - row.nameWidth);
      segments.push(text(padName + assignSpacing), printParts(row.valueParts, "Property"));
    }

    alignedMap.set(row.entry, concat(...segments));
  }
}
