/**
 * Independent, lossless FC lexer.
 *
 * Tokens cover the entire input in order. Trivia is not discarded: whitespace,
 * newlines and comments retain their original bytes for later printers.
 *
 * @typedef {"syntax" | "trivia" | "error"} TokenChannel
 * @typedef {{
 *   kind: string, text: string, start: number, end: number,
 *   line: number, column: number, endLine: number, endColumn: number,
 *   channel: TokenChannel
 * }} Token
 * @typedef {{
 *   phase: "lexer", code: string, message: string,
 *   start: number, end: number, line: number, column: number
 * }} LexDiagnostic
 * @typedef {{ tokens: Token[], diagnostics: LexDiagnostic[] }} LexResult
 */
import { KEYWORDS, PUNCTUATION } from "./lexicon.generated.mjs";

/** ASCII character for raw string literal boundary (`). */
const BACKTICK = "`";

/** Length of an escaped character sequence `\c` inside string literals. */
const ESCAPE_SEQUENCE_LENGTH = 2;

/** Unicode Byte Order Mark (BOM) disallowed by the FC grammar. */
const UTF8_BOM = "\uFEFF";

const NUMBER = /^(?:0[xX][0-9a-fA-F_]+(?:\.[0-9a-fA-F_]*)?(?:[pP][+-]?[0-9_]+)?|0[bB][01_]+|0[oO][0-7_]+|(?:[0-9][0-9_]*\.[0-9_]*|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9_]+)?|[0-9][0-9_]*[eE][+-]?[0-9_]+|[0-9][0-9_]*)/;
const NUMBER_STICKY = new RegExp(NUMBER.source.slice(1), "y");
const IDENT_START = /[A-Za-z_]/;
const IDENT_CONTINUE = /[A-Za-z_0-9]/;

/** Fast dispatch map for punctuation tokens grouped by their initial character. */
const PUNCTUATION_BY_FIRST = new Map();
for (const entry of PUNCTUATION) {
  const first = entry[0][0];
  let list = PUNCTUATION_BY_FIRST.get(first);
  if (!list) {
    list = [];
    PUNCTUATION_BY_FIRST.set(first, list);
  }
  list.push(entry);
}

/** Find a quoted literal's end without consuming a line break after a bad quote. */
function quotedEnd(source, start, quote) {
  let end = start + 1;

  while (end < source.length) {
    if (source[end] === "\\") {
      end += Math.min(ESCAPE_SEQUENCE_LENGTH, source.length - end);
      continue;
    }

    if (source[end] === quote) {
      return { end: end + 1, closed: true };
    }

    if (source[end] === "\n" || source[end] === "\r") {
      break;
    }

    end += 1;
  }

  return { end, closed: false };
}

/** The oracle's number token families share one spelling scanner. */
function numberKind(spelling) {
  if (/^0[xX]/.test(spelling)) {
    return /[.pP]/.test(spelling) ? "HEX_FLOAT_LIT" : "HEX_LIT";
  }

  if (/^0[bB]/.test(spelling)) {
    return "BINARY_LIT";
  }

  if (/^0[oO]/.test(spelling) || /^0[0-7_]+$/.test(spelling)) {
    return "OCTAL_LIT";
  }

  if (/[.eE]/.test(spelling)) {
    return "FLOAT_LIT";
  }

  return "DECIMAL_LIT";
}

/**
 * Scan one FC source without normalizing EOL, comments or literal contents.
 * @param {string} source
 * @returns {LexResult}
 */
export function lexSource(source) {
  if (typeof source !== "string") {
    throw new TypeError("FC source must be a string");
  }

  /** @type {Token[]} */
  const tokens = [];
  /** @type {LexDiagnostic[]} */
  const diagnostics = [];
  let offset = 0;
  let line = 1;
  let column = 0;

  /** @param {string} kind @param {number} end @param {TokenChannel} channel */
  function emit(kind, end, channel) {
    const start = offset;
    const startLine = line;
    const startColumn = column;

    for (let at = start; at < end; at += 1) {
      const char = source[at];

      if (char === "\r") {
        if (source[at + 1] === "\n" && at + 1 < end) {
          at += 1;
        }

        line += 1;
        column = 0;
      } else if (char === "\n") {
        line += 1;
        column = 0;
      } else {
        column += 1;
      }
    }

    tokens.push({
      kind,
      text: source.slice(start, end),
      start,
      end,
      line: startLine,
      column: startColumn,
      endLine: line,
      endColumn: column,
      channel,
    });

    offset = end;
  }

  /** @param {string} code @param {string} message @param {number} end */
  function error(code, message, end) {
    diagnostics.push({
      phase: "lexer",
      code,
      message,
      start: offset,
      end,
      line,
      column,
    });

    emit("INVALID", end, "error");
  }

  while (offset < source.length) {
    const char = source[offset];

    if (char === UTF8_BOM) {
      error("unexpected-bom", "UTF-8 BOM is not accepted by FC grammar 1.11.0", offset + 1);
      continue;
    }

    if (char === " " || char === "\t" || char === "\f" || char === "\v") {
      let end = offset + 1;

      while (end < source.length && /[ \t\f\v]/.test(source[end])) {
        end += 1;
      }

      emit("WS", end, "trivia");
      continue;
    }

    if (char === "\r" || char === "\n") {
      emit("NEWLINE", char === "\r" && source[offset + 1] === "\n" ? offset + 2 : offset + 1, "trivia");
      continue;
    }

    if (char === "/" && source[offset + 1] === "/") {
      let end = offset + 2;

      while (end < source.length && source[end] !== "\r" && source[end] !== "\n") {
        end += 1;
      }

      emit("LINE_COMMENT", end, "trivia");
      continue;
    }

    if (char === "/" && source[offset + 1] === "*") {
      const close = source.indexOf("*/", offset + 2);

      if (close < 0) {
        error("unterminated-comment", "Unterminated block comment", source.length);
      } else {
        emit("COMMENT", close + 2, "trivia");
      }

      continue;
    }

    if (char === BACKTICK) {
      const close = source.indexOf(BACKTICK, offset + 1);

      if (close < 0) {
        error("unterminated-raw-string", "Unterminated raw string", source.length);
      } else {
        emit("RAW_STRING_LIT", close + 1, "syntax");
      }

      continue;
    }

    if (char === '"' || char === "'") {
      const { end, closed } = quotedEnd(source, offset, char);

      if (!closed) {
        error("unterminated-string", "Unterminated quoted literal", end);
      } else {
        emit(char === '"' ? "INTERPRETED_STRING_LIT" : "RUNE_LIT", end, "syntax");
      }

      continue;
    }

    if (char === "#" && /[0-9a-fA-F]/.test(source[offset + 1] ?? "")) {
      let end = offset + 1;

      while (end < source.length && /[0-9a-fA-F]/.test(source[end])) {
        end += 1;
      }

      emit("COLOR_HEX_LIT", end, "syntax");
      continue;
    }

    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(source[offset + 1] ?? ""))) {
      NUMBER_STICKY.lastIndex = offset;
      const match = NUMBER_STICKY.exec(source);

      if (match) {
        const spelling = match[0];

        emit(numberKind(spelling), offset + spelling.length, "syntax");
        continue;
      }
    }

    if (IDENT_START.test(char)) {
      let end = offset + 1;

      while (end < source.length && IDENT_CONTINUE.test(source[end])) {
        end += 1;
      }

      const spelling = source.slice(offset, end);
      emit(KEYWORDS[spelling] ?? "IDENTIFIER", end, "syntax");
      continue;
    }

    const candidates = PUNCTUATION_BY_FIRST.get(char);

    if (candidates) {
      const operator = candidates.find(([spelling]) => source.startsWith(spelling, offset));

      if (operator) {
        emit(operator[1], offset + operator[0].length, "syntax");
        continue;
      }
    }

    error("unexpected-character", "Unexpected character " + JSON.stringify(char), offset + 1);
  }

  return { tokens, diagnostics };
}
