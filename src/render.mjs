/** @typedef {import("./document.mjs").Doc} Doc */

/**
 * Count displayed columns. Tabs use a configured stop, combining marks use no
 * column, and common CJK/emoji code points use two. Protected text is never
 * split, even when it extends past printWidth.
 */
export function columns(value, start = 0, tabWidth = 4) {
  let column = start;

  for (const character of value) {
    const code = character.charCodeAt(0);

    if (code >= 0x20 && code <= 0x7e) {
      column += 1;
      continue;
    }

    if (character === "\t") {
      column += tabWidth - (column % tabWidth);
    } else if (/\p{Mark}/u.test(character)) {
      continue;
    } else {
      const fullCode = character.codePointAt(0);
      const wide = fullCode >= 0x1100 && (
        fullCode <= 0x115f || fullCode >= 0x2329 && fullCode <= 0x232a ||
        fullCode >= 0x2e80 && fullCode <= 0xa4cf || fullCode >= 0xac00 && fullCode <= 0xd7a3 ||
        fullCode >= 0xf900 && fullCode <= 0xfaff || fullCode >= 0xfe10 && fullCode <= 0xfe6f ||
        fullCode >= 0xff00 && fullCode <= 0xff60 || fullCode >= 0xffe0 && fullCode <= 0xffe6 ||
        fullCode >= 0x1f300 && fullCode <= 0x1faff
      );

      column += wide ? 2 : 1;
    }
  }

  return column;
}

/** @param {Doc} root @param {{ printWidth: number, indentUnit: string, eol: string, tabWidth?: number }} options */
export function render(root, options) {
  const { printWidth, indentUnit, eol, tabWidth = 4 } = options;
  const widthCache = new WeakMap();
  const output = [];
  let column = 0;
  let pendingIndent;

  /** The flat width cache prevents repeated recursive fit probes. */
  function flatWidth(doc) {
    if (widthCache.has(doc)) {
      return widthCache.get(doc);
    }

    let width;

    switch (doc.type) {
      case "text":
        width = columns(doc.value, 0, tabWidth);
        break;
      case "verbatim":
        width = /[\r\n]/.test(doc.value) ? Infinity : columns(doc.value, 0, tabWidth);
        break;
      case "line":
        width = 1;
        break;
      case "softline":
        width = 0;
        break;
      case "hardline":
        width = Infinity;
        break;
      case "concat": {
        let sum = 0;
        for (let i = 0; i < doc.parts.length; i += 1) {
          sum += flatWidth(doc.parts[i]);
        }
        width = sum;
        break;
      }
      case "group":
      case "indent":
        width = flatWidth(doc.contents);
        break;
      case "ifBreak":
        width = flatWidth(doc.flat);
        break;
      default:
        throw new TypeError("Unknown document node");
    }

    widthCache.set(doc, width);
    return width;
  }

  function write(value) {
    output.push(value);
    const lines = value.split(/\r\n|\r|\n/);

    if (lines.length > 1) {
      column = columns(lines.at(-1), 0, tabWidth);
    } else {
      column = columns(value, column, tabWidth);
    }
  }

  function writeContent(value) {
    if (!value) {
      return;
    }

    if (pendingIndent !== undefined) {
      write(indentUnit.repeat(pendingIndent));
      pendingIndent = undefined;
    }

    write(value);
  }

  const pending = [{ doc: root, mode: "break", depth: 0 }];

  while (pending.length > 0) {
    const { doc, mode, depth } = pending.pop();

    switch (doc.type) {
      case "verbatim":
        if (doc.absolute) {
          pendingIndent = undefined;
          write(doc.value);
          break;
        }
      case "text":
        writeContent(doc.value);
        break;
      case "line":
      case "softline":
      case "hardline": {
        if (mode === "flat" && doc.type !== "hardline") {
          if (doc.type === "line") {
            writeContent(" ");
          }
        } else {
          write(eol);
          pendingIndent = depth;
        }

        break;
      }
      case "concat":
        for (let index = doc.parts.length - 1; index >= 0; index -= 1) {
          pending.push({ doc: doc.parts[index], mode, depth });
        }

        break;
      case "indent":
        pending.push({ doc: doc.contents, mode, depth: depth + doc.levels });
        break;
      case "group": {
        // An explicit child break must survive a flat enclosing group.
        const effectiveColumn = pendingIndent === undefined ? column :
          columns(indentUnit.repeat(pendingIndent), column, tabWidth);
        const nextMode = doc.mode === "always" ? "break" :
          mode === "flat" || doc.mode === "never" ? "flat" :
          flatWidth(doc.contents) <= printWidth - effectiveColumn ? "flat" : "break";
        pending.push({ doc: doc.contents, mode: nextMode, depth });
        break;
      }
      case "ifBreak":
        pending.push({ doc: mode === "break" ? doc.broken : doc.flat, mode, depth });
        break;
      default:
        throw new TypeError("Unknown document node");
    }
  }

  return output.join("");
}
