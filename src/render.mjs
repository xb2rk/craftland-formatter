/** @typedef {import("./document.mjs").Doc} Doc */

const UNICODE_MARK_REGEX = /\p{Mark}/u;

/** Precomputed indent string cache by indent unit. */
const INDENT_CACHE = new Map();
function getIndentString(unit, depth) {
  let list = INDENT_CACHE.get(unit);
  if (!list) {
    list = [""];
    INDENT_CACHE.set(unit, list);
  }
  while (list.length <= depth) {
    list.push(unit.repeat(list.length));
  }
  return list[depth];
}

/** ASCII Horizontal Tab character code. */
const CHAR_TAB = 9;

/** Unicode Surrogate code unit bounds for 4-byte UTF-16 code points (emojis, rare scripts). */
const SURROGATE_HIGH_MIN = 0xd800;
const SURROGATE_HIGH_MAX = 0xdbff;

/** Unicode Emoji presentation code point bounds. */
const EMOJI_MIN = 0x1f300;
const EMOJI_MAX = 0x1faff;

/**
 * Counts displayed visual columns for a string.
 * - Standard ASCII printable characters (0x20 - 0x7E) occupy 1 column.
 * - Tab characters advance to the next tab stop.
 * - Unicode combining marks occupy 0 columns.
 * - East Asian Wide (CJK ideographs, Hangul) and Emoji code points occupy 2 columns.
 *
 * @param {string} value - Text to measure.
 * @param {number} [start=0] - Starting column offset.
 * @param {number} [tabWidth=4] - Tab stop width in spaces.
 * @returns {number} Final visual column position.
 */
export function columns(value, start = 0, tabWidth = 4) {
  let column = start;
  const len = value.length;

  for (let i = 0; i < len; i += 1) {
    const code = value.charCodeAt(i);

    // Fast path: standard printable ASCII characters occupy exactly 1 visual column
    if (code >= 0x20 && code <= 0x7e) {
      column += 1;
      continue;
    }

    if (code === CHAR_TAB) {
      column += tabWidth - (column % tabWidth);
    } else if (code >= SURROGATE_HIGH_MIN && code <= SURROGATE_HIGH_MAX && i + 1 < len) {
      // Decode 4-byte surrogate pair (e.g. Emoji symbols)
      const fullCode = value.codePointAt(i);
      i += 1;
      const wide = fullCode >= EMOJI_MIN && fullCode <= EMOJI_MAX;
      column += wide ? 2 : 1;
    } else {
      const character = value[i];
      if (UNICODE_MARK_REGEX.test(character)) {
        continue;
      }

      // Check East Asian Wide (CJK) ranges: Hangul, Han ideographs, fullwidth forms
      const wide = code >= 0x1100 && (
        code <= 0x115f ||
        (code >= 0x2329 && code <= 0x232a) ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe10 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6)
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
        const parts = doc.parts;
        for (let i = 0; i < parts.length; i += 1) {
          sum += flatWidth(parts[i]);
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
    const nl = value.lastIndexOf("\n");

    if (nl >= 0) {
      column = columns(value.slice(nl + 1), 0, tabWidth);
    } else {
      column = columns(value, column, tabWidth);
    }
  }

  function writeContent(value) {
    if (!value) {
      return;
    }

    if (pendingIndent !== undefined) {
      write(getIndentString(indentUnit, pendingIndent));
      pendingIndent = undefined;
    }

    write(value);
  }

  // Parallel arrays simulate an iterative worklist without allocating { doc, mode, depth } objects on the heap
  const pendingDocs = [root];
  const pendingModes = ["break"];
  const pendingDepths = [0];

  while (pendingDocs.length > 0) {
    const doc = pendingDocs.pop();
    const mode = pendingModes.pop();
    const depth = pendingDepths.pop();

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
      case "concat": {
        const parts = doc.parts;
        for (let index = parts.length - 1; index >= 0; index -= 1) {
          pendingDocs.push(parts[index]);
          pendingModes.push(mode);
          pendingDepths.push(depth);
        }

        break;
      }
      case "indent":
        pendingDocs.push(doc.contents);
        pendingModes.push(mode);
        pendingDepths.push(depth + doc.levels);
        break;
      case "group": {
        // An explicit child break must survive a flat enclosing group.
        const effectiveColumn = pendingIndent === undefined ? column :
          columns(getIndentString(indentUnit, pendingIndent), column, tabWidth);
        const nextMode = doc.mode === "always" ? "break" :
          mode === "flat" || doc.mode === "never" ? "flat" :
          flatWidth(doc.contents) <= printWidth - effectiveColumn ? "flat" : "break";
        pendingDocs.push(doc.contents);
        pendingModes.push(nextMode);
        pendingDepths.push(depth);
        break;
      }
      case "ifBreak":
        pendingDocs.push(mode === "break" ? doc.broken : doc.flat);
        pendingModes.push(mode);
        pendingDepths.push(depth);
        break;
      default:
        throw new TypeError("Unknown document node");
    }
  }

  return output.join("");
}
