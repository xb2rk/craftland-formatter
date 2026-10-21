import type { Doc } from "./document.js";

export interface PrintOptions { readonly printWidth?: number; readonly indentWidth?: number; }
interface Command { readonly doc: Doc; readonly indent: number; readonly mode: "flat" | "break"; }

/** Deterministic width-aware document printer. */
export function printDocument(document: Doc, options: PrintOptions = {}): string {
  const width = options.printWidth ?? 120;
  const indentWidth = options.indentWidth ?? 2;
  let output = "";
  let column = 0;
  let lineStart = true;
  const stack: Command[] = [{ doc: document, indent: 0, mode: "break" }];
  while (stack.length > 0) {
    const command = stack.pop();
    if (!command) continue;
    const doc = command.doc;
    switch (doc.kind) {
      case "text":
        if (lineStart) { output += " ".repeat(command.indent * indentWidth); column = command.indent * indentWidth; lineStart = false; }
        output += doc.value; column += doc.value.length; break;
      case "line":
        if (command.mode === "flat" && !doc.hard) { output += " "; column += 1; }
        else { output = output.replace(/[ \t]+$/u, "") + "\n"; column = 0; lineStart = true; }
        break;
      case "concat":
        for (let index = doc.parts.length - 1; index >= 0; index -= 1) { const part = doc.parts[index]; if (part) stack.push({ doc: part, indent: command.indent, mode: command.mode }); }
        break;
      case "indent": stack.push({ doc: doc.content, indent: command.indent + doc.amount, mode: command.mode }); break;
      case "group": {
        const flat: Command = { doc: doc.content, indent: command.indent, mode: "flat" };
        stack.push(fits(width - column, [flat]) ? flat : { doc: doc.content, indent: command.indent, mode: "break" });
        break;
      }
    }
  }
  return output;
}

function fits(remaining: number, commands: readonly Command[]): boolean {
  let budget = remaining;
  const stack = [...commands];
  while (stack.length > 0 && budget >= 0) {
    const command = stack.pop();
    if (!command) continue;
    switch (command.doc.kind) {
      case "text": budget -= command.doc.value.length; break;
      case "line": if (command.mode === "flat" && !command.doc.hard) budget -= 1; else return true; break;
      case "concat": for (let i = command.doc.parts.length - 1; i >= 0; i -= 1) { const part = command.doc.parts[i]; if (part) stack.push({ ...command, doc: part }); } break;
      case "indent": stack.push({ ...command, doc: command.doc.content }); break;
      case "group": stack.push({ ...command, doc: command.doc.content, mode: "flat" }); break;
    }
  }
  return budget >= 0;
}
