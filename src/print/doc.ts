/**
 * @module print/doc - a small, pure Wadler/Prettier-style document algebra and greedy printer.
 */

import type { Config } from "../format/config.js";

export type Doc = TextDoc | ConcatDoc | LineDoc | IndentDoc | GroupDoc | IfBreakDoc;

interface TextDoc {
  /** Text literal (may contain newlines for raw strings/comments). */
  type: "text";
  value: string;
}

interface ConcatDoc {
  type: "concat";
  parts: readonly Doc[];
}

interface LineDoc {
  type: "line";
  /** `soft`: empty when flat, newline when broken. `line`: space when flat. `hard`: always newline. */
  kind: "soft" | "line" | "hard";
}

interface IndentDoc {
  type: "indent";
  contents: Doc;
}

interface GroupDoc {
  type: "group";
  contents: Doc;
}

interface IfBreakDoc {
  type: "if-break";
  flat: Doc;
  broken: Doc;
}

/** Empty document. */
export const nil: Doc = { type: "concat", parts: [] };
/** Soft line: nothing when flat, newline when broken. */
export const softline: Doc = { type: "line", kind: "soft" };
/** Hard line: always a newline. */
export const hardline: Doc = { type: "line", kind: "hard" };

/** A line that is a space when flat and a newline when broken. */
export const line: Doc = { type: "line", kind: "line" };

/**
 * Create a text node.
 *
 * @param value - literal text.
 * @returns text doc.
 */
export function text(value: string): Doc {
  return { type: "text", value };
}

/**
 * Concatenate docs, flattening nested concats.
 *
 * @param parts - docs to concatenate.
 * @returns concatenated doc (or `nil` / single doc when trivial).
 */
export function concat(parts: readonly Doc[]): Doc {
  const flattened: Doc[] = [];
  for (const part of parts) {
    if (part.type === "concat") {
      flattened.push(...part.parts);
    } else {
      flattened.push(part);
    }
  }
  if (flattened.length === 0) {
    return nil;
  }
  if (flattened.length === 1) {
    return flattened[0]!;
  }
  return { type: "concat", parts: flattened };
}

/**
 * Join docs with a separator.
 *
 * @param separator - doc inserted between parts.
 * @param parts - docs to join.
 * @returns joined doc.
 */
export function join(separator: Doc, parts: readonly Doc[]): Doc {
  return concat(parts.flatMap((part, index) => (index === 0 ? [part] : [separator, part])));
}

/**
 * Indent a doc by one level (tabs or `tabWidth` spaces per level).
 *
 * @param contents - doc to indent.
 * @returns indented doc.
 */
export function indent(contents: Doc): Doc {
  return { type: "indent", contents };
}

/**
 * Try to fit on one line; break otherwise (greedy).
 *
 * @param contents - doc to group.
 * @returns grouped doc.
 */
export function group(contents: Doc): Doc {
  return { type: "group", contents };
}

/**
 * Conditional doc depending on flat vs break mode.
 *
 * @param flat - doc when flat.
 * @param broken - doc when broken.
 * @returns conditional doc.
 */
export function ifBreak(flat: Doc, broken: Doc): Doc {
  return { type: "if-break", flat, broken };
}

type Mode = "flat" | "break";
interface Command {
  indent: number;
  mode: Mode;
  doc: Doc;
}

/**
 * Build an indentation string for a given level.
 *
 * @param level - indentation depth.
 * @param config - formatter config.
 * @returns tabs or spaces.
 */
function indentText(level: number, config: Config): string {
  return config.useTabs ? "\t".repeat(level) : " ".repeat(level * config.tabWidth);
}

/**
 * Check if a doc fits within the remaining column budget when rendered flat.
 *
 * @param remaining - columns remaining before `printWidth` is exceeded.
 * @param commands - pending commands to measure.
 * @returns true if it fits.
 */
function fits(remaining: number, commands: readonly Command[]): boolean {
  const pending = [...commands];
  while (remaining >= 0 && pending.length > 0) {
    const command = pending.pop()!;
    switch (command.doc.type) {
      case "text": {
        // Multiline text (raw strings/comments) never fits flat.
        if (command.doc.value.includes("\n")) {
          return false;
        }
        remaining -= command.doc.value.length;
        break;
      }
      case "concat": {
        for (let index = command.doc.parts.length - 1; index >= 0; index -= 1) {
          pending.push({ ...command, doc: command.doc.parts[index]! });
        }
        break;
      }
      case "line": {
        if (command.doc.kind === "hard") {
          return false;
        }
        if (command.mode === "flat") {
          if (command.doc.kind === "line") {
            remaining -= 1;
          }
          // softline is empty in flat mode.
          break;
        } else {
          return true;
        }
      }
      case "indent": {
        pending.push({ ...command, indent: command.indent + 1, doc: command.doc.contents });
        break;
      }
      case "group": {
        pending.push({ ...command, mode: "flat", doc: command.doc.contents });
        break;
      }
      case "if-break": {
        pending.push({ ...command, doc: command.doc.flat });
        break;
      }
    }
  }
  return remaining >= 0;
}

/**
 * Render a Doc with greedy group fitting.
 *
 * @param document - document to render.
 * @param config - formatter config (for `printWidth`/`useTabs`/`tabWidth`).
 * @returns rendered string.
 */
export function printDoc(document: Doc, config: Config): string {
  let output = "";
  let column = 0;
  let atLineStart = false;
  const stack: Command[] = [{ indent: 0, mode: "break", doc: document }];

  const appendText = (value: string, level: number): void => {
    const lines = value.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const part = lines[index]!;
      // A text node may be a raw multiline comment/string. Indent only its
      // first physical line; its internal whitespace is source content.
      if (atLineStart && part.length > 0 && index === 0) {
        const prefix = indentText(level, config);
        output += prefix;
        column = prefix.length;
        atLineStart = false;
      }
      output += part;
      column += part.length;
      if (index < lines.length - 1) {
        output += "\n";
        column = 0;
        atLineStart = true;
      }
    }
  };

  while (stack.length > 0) {
    const command = stack.pop()!;
    switch (command.doc.type) {
      case "text": {
        appendText(command.doc.value, command.indent);
        break;
      }
      case "concat": {
        for (let index = command.doc.parts.length - 1; index >= 0; index -= 1) {
          stack.push({ ...command, doc: command.doc.parts[index]! });
        }
        break;
      }
      case "line": {
        if (command.mode === "flat" && command.doc.kind === "soft") {
          // softline disappears when its group fits.
        } else if (command.mode === "flat" && command.doc.kind === "line") {
          appendText(" ", command.indent);
        } else {
          output += "\n";
          column = 0;
          atLineStart = true;
        }
        break;
      }
      case "indent": {
        stack.push({ ...command, indent: command.indent + 1, doc: command.doc.contents });
        break;
      }
      case "group": {
        const flat = { ...command, mode: "flat" as const, doc: command.doc.contents };
        const fitsFlat = fits(config.printWidth - column, [flat]);
        stack.push(fitsFlat ? flat : { ...command, mode: "break", doc: command.doc.contents });
        break;
      }
      case "if-break": {
        stack.push({ ...command, doc: command.mode === "flat" ? command.doc.flat : command.doc.broken });
        break;
      }
    }
  }

  return output;
}
