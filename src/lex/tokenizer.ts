/**
 * @module lex/tokenizer - lossless FC source scanner.
 *
 * This module recognizes lexical units only. In particular, it does not
 * synthesize ANTLR's parser-mode-dependent EOS token: physical newlines remain
 * trivia and later structural code can reason about them with full context.
 */

import { TokenId } from "./grammar.generated.js";
import { KEYWORDS, OPERATORS, PUNCTUATORS } from "./grammar.js";
import { StringReader } from "./reader.js";
import { NON_ASCII_START } from "../shared/constants.js";
import type { SourcePosition, Token } from "./tokens.js";

/**
 * Check if a character is an ASCII digit.
 *
 * @param char - single character or undefined at EOF.
 * @returns true for 0-9.
 */
function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

/**
 * Check if a character is a hexadecimal digit.
 *
 * @param char - single character or undefined at EOF.
 * @returns true for 0-9, a-f, A-F.
 */
function isHexDigit(char: string | undefined): boolean {
  return char !== undefined && /^[0-9a-f]$/i.test(char);
}

/**
 * Check if a character is a binary digit.
 *
 * @param char - single character or undefined at EOF.
 * @returns true for 0 or 1.
 */
function isBinDigit(char: string | undefined): boolean {
  return char === "0" || char === "1";
}

/**
 * Check if a character is an octal digit.
 *
 * @param char - single character or undefined at EOF.
 * @returns true for 0-7.
 */
function isOctDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "7";
}

/**
 * Check if a character may start an FC identifier.
 *
 * @param char - single character or undefined at EOF.
 * @returns true for letters, `_`, or non-ASCII (>= 0x80).
 */
function isIdentifierStart(char: string | undefined): boolean {
  return (
    char !== undefined &&
    ((char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_" || char.charCodeAt(0) >= NON_ASCII_START)
  );
}

/**
 * Check if a character may continue an identifier.
 *
 * @param char - single character or undefined at EOF.
 * @returns true for identifier start or digit.
 */
function isIdentifierPart(char: string | undefined): boolean {
  return isIdentifierStart(char) || isDigit(char);
}

/**
 * Check if a character is FC whitespace (includes NBSP U+00A0 and form-feed U+000C).
 *
 * @param char - single character or undefined at EOF.
 * @returns true for space, tab, CR, LF, NBSP, FF.
 */
function isWhitespace(char: string | undefined): boolean {
  // U+00A0 is NBSP and U+000C is form-feed - both are treated as whitespace by the FC lexer.
  return char === " " || char === "\t" || char === "\r" || char === "\n" || char === "\u00a0" || char === "\u000c";
}

/**
 * Check if trivia text contains a line break.
 *
 * @param text - trivia slice.
 * @returns true if it contains `\n`.
 */
function containsNewline(text: string): boolean {
  return text.includes("\n");
}

/**
 * Scan source into lossless raw tokens, followed by a zero-width EOF token.
 *
 * @param source - full FC source text.
 * @returns lossless token list ending with an EOF sentinel.
 */
export function tokenize(source: string): Token[] {
  const reader = new StringReader(source);
  const tokens: Token[] = [];

  const emit = (kind: TokenId, start: SourcePosition): void => {
    tokens.push({ kind, text: reader.slice(start.offset), span: reader.span(start) });
  };

  const scanWhitespace = (): void => {
    const start = reader.position;
    while (isWhitespace(reader.peek())) {
      reader.advance();
    }
    // Distinguish plain whitespace from newline-terminated whitespace (NLSEMI).
    const kind = containsNewline(reader.slice(start.offset)) ? TokenId.WS_NLSEMI : TokenId.WS;
    emit(kind, start);
  };

  const scanLineComment = (): void => {
    const start = reader.position;
    // Consume until EOL (newline itself remains trivia for the next scan).
    while (!reader.atEnd && reader.peek() !== "\n") {
      reader.advance();
    }
    emit(TokenId.LINE_COMMENT, start);
  };

  const scanBlockComment = (): void => {
    const start = reader.position;
    // Consume opening `/*`.
    reader.advance(2);
    while (!reader.atEnd) {
      if (reader.peek() === "*" && reader.peek(1) === "/") {
        reader.advance(2);
        break;
      }
      reader.advance();
    }
    // COMMENT vs COMMENT_NLSEMI mirrors FCGLexer's line-tracking mode.
    const isMultiline = reader.span(start).end.line !== start.line;
    emit(isMultiline ? TokenId.COMMENT_NLSEMI : TokenId.COMMENT, start);
  };

  const scanQuoted = (kind: TokenId, quote: string, allowNewline: boolean): void => {
    const start = reader.position;
    // Consume opening quote.
    reader.advance();
    while (!reader.atEnd) {
      const current = reader.peek();
      if (current === "\\") {
        // Escape sequence: skip both `\` and the escaped character.
        reader.advance(2);
      } else if (current === quote) {
        reader.advance();
        break;
      } else if (current === "\n" && !allowNewline) {
        // Unterminated single-line literal - stop before newline.
        break;
      } else {
        reader.advance();
      }
    }
    emit(kind, start);
  };

  const scanNumber = (): void => {
    const start = reader.position;
    let length = 0;
    const at = (offset = 0): string | undefined => reader.peek(length + offset);
    let kind: TokenId;

    // Helper: scan optional hex fraction and `p` exponent for hex floats.
    const scanHexFloatTail = (): boolean => {
      let isFloat = false;
      if (at() === ".") {
        isFloat = true;
        length += 1;
        while (isHexDigit(at()) || at() === "_") {
          length += 1;
        }
      }
      if (at() === "p" || at() === "P") {
        isFloat = true;
        length += 1;
        if (at() === "+" || at() === "-") {
          length += 1;
        }
        while (isDigit(at())) {
          length += 1;
        }
      }
      return isFloat;
    };

    // Helper: scan decimal fraction and `e` exponent for decimal floats.
    const scanDecimalFloatTail = (): boolean => {
      let isFloat = false;
      if (at() === ".") {
        isFloat = true;
        length += 1;
        while (isDigit(at()) || at() === "_") {
          length += 1;
        }
      }
      if (at() === "e" || at() === "E") {
        isFloat = true;
        length += 1;
        if (at() === "+" || at() === "-") {
          length += 1;
        }
        while (isDigit(at())) {
          length += 1;
        }
      }
      return isFloat;
    };

    if (at() === "0" && (at(1) === "x" || at(1) === "X")) {
      // Hex literal: 0x... with optional fraction and `p` exponent.
      length = 2;
      while (isHexDigit(at()) || at() === "_") {
        length += 1;
      }
      const isFloat = scanHexFloatTail();
      kind = isFloat ? TokenId.HEX_FLOAT_LIT : TokenId.HEX_LIT;
    } else if (at() === "0" && (at(1) === "b" || at(1) === "B")) {
      length = 2;
      while (isBinDigit(at()) || at() === "_") {
        length += 1;
      }
      kind = TokenId.BINARY_LIT;
    } else if (at() === "0" && (at(1) === "o" || at(1) === "O")) {
      length = 2;
      while (isOctDigit(at()) || at() === "_") {
        length += 1;
      }
      kind = TokenId.OCTAL_LIT;
    } else {
      // Decimal: digits with optional fraction, exponent, or `i` suffix.
      while (isDigit(at()) || at() === "_") {
        length += 1;
      }
      const isFloat = scanDecimalFloatTail();
      if (at() === "i") {
        length += 1;
        kind = TokenId.IMAGINARY_LIT;
      } else {
        kind = isFloat ? TokenId.FLOAT_LIT : TokenId.DECIMAL_LIT;
      }
    }

    reader.advance(length);
    emit(kind, start);
  };

  // Main dispatch: whitespace → comments → literals → numbers → identifiers → operators.
  while (!reader.atEnd) {
    const current = reader.peek()!;

    if (isWhitespace(current)) {
      scanWhitespace();
    } else if (current === "/" && reader.peek(1) === "/") {
      scanLineComment();
    } else if (current === "/" && reader.peek(1) === "*") {
      scanBlockComment();
    } else if (current === "`") {
      // Backtick raw string allows newlines.
      scanQuoted(TokenId.RAW_STRING_LIT, "`", true);
    } else if (current === '"') {
      scanQuoted(TokenId.INTERPRETED_STRING_LIT, '"', false);
    } else if (current === "'") {
      scanQuoted(TokenId.RUNE_LIT, "'", false);
    } else if (isDigit(current) || (current === "." && isDigit(reader.peek(1)))) {
      scanNumber();
    } else if (isIdentifierStart(current)) {
      const start = reader.position;
      while (isIdentifierPart(reader.peek())) {
        reader.advance();
      }
      const text = reader.slice(start.offset);
      emit(KEYWORDS[text] ?? TokenId.IDENTIFIER, start);
    } else if (current === "#" && isHexDigit(reader.peek(1))) {
      // `#` + hex digit starts a color literal (e.g. `#ff00ff`).
      const start = reader.position;
      reader.advance();
      while (isHexDigit(reader.peek())) {
        reader.advance();
      }
      emit(TokenId.COLOR_HEX_LIT, start);
    } else {
      // Longest-match operators first, then single-char punctuators.
      const operator = OPERATORS.find(([text]) => reader.peekText(text.length) === text);
      if (operator) {
        const start = reader.position;
        reader.advance(operator[0].length);
        emit(operator[1], start);
      } else {
        const punctuation = PUNCTUATORS[current];
        const start = reader.position;
        reader.advance();
        emit(punctuation ?? TokenId.OTHER, start);
      }
    }
  }

  const eof = reader.position;
  tokens.push({ kind: TokenId.EOF, text: "", span: { start: eof, end: eof } });
  return tokens;
}

export type { Token } from "./tokens.js";
