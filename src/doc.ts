// =============================================================================
// doc.ts - Lossless document IR + printer for fc-format.
//
// Source of truth for the FC token/rule vocabulary this formatter consumes:
//   - Token kinds: extracted from the official Craftland Studio FCG grammar
//     (FCGLexer token constants). At runtime they come from `tokenizer.ts`
//     (enum `TokenKind`). To inspect the original grammar, open the official
//     VS Code extension at:
//       %USERPROFILE%\.vscode\extensions\craftlandstudio.ffugclanguage-*/dist/server_syntax.js
//     and search for the `FCGLexer` / `FCGParser` modules (lexer ~ module 9938,
//     parser ~ module 2737). The token *names* there (e.g. `L_PAREN`,
//     `INTERPRETED_STRING_LIT`) map 1:1 to `TokenKind` in `tokenizer.ts`.
//
// Design: a Wadler/Prettier-style "doc" tree. The formatter builds a `Doc`,
// then `printDoc` renders it against `maxLineLength` using a greedy
// "does it fit?" check (the canonical Prettier algorithm). This keeps layout
// decisions declarative and isolated from token scanning, and makes every
// formatting rule easy to extend: add a helper that returns a `Doc`.
// =============================================================================

/**
 * A `Doc` is an immutable tree describing how source should be printed.
 * - `string` literal text (must not contain newlines).
 * - `softline` : break => newline, flat => nothing. Use for optional interior
 *                breaks inside delimiters (e.g. between `{` and its contents).
 * - `line`     : break => newline, flat => a single space. Use for a space that
 *                is required in flat mode (e.g. between two call arguments).
 * - `hardline` : always a newline (used for statement boundaries).
 * - `indent`   : increases indentation for every line emitted inside `contents`.
 * - `group`    : a unit that is either kept on one line (flat) or broken (each
 *                `softline`/`line` inside becomes a newline). `shouldBreak`
 *                forces the broken form.
 * - `ifBreak`  : emits `breakContents` when the enclosing group is broken,
 *                otherwise `flatContents` (used for trailing commas).
 * - `concat`   : sequence of docs.
 */
export type Doc =
  | string
  | { type: "softline" }
  | { type: "line" }
  | { type: "hardline" }
  | { type: "indent"; contents: Doc }
  | { type: "group"; contents: Doc; shouldBreak?: boolean }
  | { type: "ifBreak"; breakContents: Doc; flatContents: Doc }
  | { type: "concat"; parts: Doc[] };

export function nil(): Doc {
  return { type: "concat", parts: [] };
}

/** Wrap a literal string as a Doc. (Strings are already valid Docs, but this
 *  helper keeps call sites explicit and is handy for lint-rule text.) */
export function text(s: string): Doc {
  return s;
}

/** A required space that never turns into a newline (use `line()` only where a
 *  break is acceptable, e.g. between call arguments). */
export function space(): Doc {
  return " ";
}

export function softline(): Doc {
  return { type: "softline" };
}
export function line(): Doc {
  return { type: "line" };
}
export function hardline(): Doc {
  return { type: "hardline" };
}
export function indent(contents: Doc): Doc {
  return { type: "indent", contents };
}
export function group(contents: Doc, shouldBreak = false): Doc {
  return { type: "group", contents, shouldBreak };
}
export function ifBreak(breakContents: Doc, flatContents: Doc = ""): Doc {
  return { type: "ifBreak", breakContents, flatContents };
}
export function concat(parts: Doc[]): Doc {
  // Flatten nested concats to keep the tree shallow and the printer fast.
  const flat: Doc[] = [];
  const push = (p: Doc): void => {
    if (typeof p === "string") {
      if (p.length > 0) flat.push(p);
    } else if (p.type === "concat") {
      for (const sub of p.parts) push(sub);
    } else {
      flat.push(p);
    }
  };
  for (const p of parts) push(p);
  return flat.length === 1 ? flat[0] : { type: "concat", parts: flat };
}

export interface PrintOptions {
  maxLineLength: number;
  indentWidth: number;
  useTabs: boolean;
}

/**
 * Render a `Doc` to a string, wrapping groups to stay within `maxLineLength`.
 * `indent` is tracked as a level; each newline is prefixed with
 * `indentUnit.repeat(level)`.
 */
export function printDoc(root: Doc, opts: PrintOptions): string {
  const indentUnit = opts.useTabs ? "\t" : " ".repeat(opts.indentWidth);
  const unitLen = indentUnit.length;
  const out: string[] = [];
  let indent = 0;
  let col = 0;

  const emit = (s: string): void => {
    out.push(s);
    col += s.length;
  };
  const newline = (): void => {
    out.push("\n" + indentUnit.repeat(indent));
    col = indent * unitLen;
  };

  // Greedy fit check: can `d` be printed in `flat` mode within `width` columns
  // starting from the current column? Simulates printing without actually
  // emitting; returns false as soon as it would overflow.
  const fits = (width: number, d: Doc): boolean => {
    if (width < 0) return false;
    const stack: Array<{ d: Doc; mode: "flat" | "break" }> = [{ d, mode: "flat" }];
    while (stack.length > 0) {
      const { d, mode } = stack.pop() as { d: Doc; mode: "flat" | "break" };
      if (typeof d === "string") {
        width -= d.length;
        if (width < 0) return false;
        continue;
      }
      switch (d.type) {
        case "softline":
          if (mode === "break") return true; // breaking here is fine; stop.
          width -= 0;
          continue;
        case "line":
          if (mode === "break") return true;
          width -= 1;
          if (width < 0) return false;
          continue;
        case "hardline":
          return true; // hard break is always acceptable; stop.
        case "indent":
          stack.push({ d: d.contents, mode });
          continue;
        case "group":
          stack.push({ d: d.contents, mode: d.shouldBreak ? "break" : mode });
          continue;
        case "ifBreak":
          stack.push({ d: mode === "break" ? d.breakContents : d.flatContents, mode });
          continue;
        case "concat":
          for (let i = d.parts.length - 1; i >= 0; i--) {
            stack.push({ d: d.parts[i], mode });
          }
          continue;
      }
    }
    return true;
  };

  const walk = (d: Doc, mode: "flat" | "break"): void => {
    if (typeof d === "string") {
      emit(d);
      return;
    }
    switch (d.type) {
      case "softline":
        if (mode === "break") newline();
        // flat: nothing
        return;
      case "line":
        if (mode === "break") newline();
        else emit(" ");
        return;
      case "hardline":
        newline();
        return;
      case "indent":
        indent++;
        walk(d.contents, mode);
        indent--;
        return;
      case "group":
        if (d.shouldBreak) {
          walk(d.contents, "break");
        } else if (fits(opts.maxLineLength - col, d.contents)) {
          walk(d.contents, "flat");
        } else {
          walk(d.contents, "break");
        }
        return;
      case "ifBreak":
        walk(mode === "break" ? d.breakContents : d.flatContents, mode);
        return;
      case "concat":
        for (const p of d.parts) walk(p, mode);
        return;
    }
  };

  walk(root, "flat");
  return out.join("");
}