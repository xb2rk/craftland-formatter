/**
 * @module print/normalize - output hygiene kept separate from token/layout policy.
 *
 * Normalizes BOM, line endings, trailing whitespace, blank-line runs, and the
 * final newline. Multiline raw strings and block comments are treated as
 * protected regions so hygiene cannot silently change a literal's value.
 */

import type { Config } from "../format/config.js";
import {
  BOM_CHARACTER,
  CRLF_TO_LF_RE,
  LF_TO_CRLF_RE,
  MAX_CONSECUTIVE_BLANK_LINES,
  TRAILING_WHITESPACE_RE,
} from "../shared/constants.js";

/** Lexer-like state used while scanning a line for protected regions. */
type ProtectedState = "normal" | "line-comment" | "block-comment" | "double-quote" | "single-quote" | "raw-quote";

/**
 * Scan a single line starting from a protected state, returning the ending
 * state and whether the line touches a protected literal/comment.
 *
 * @param line - line text without its line terminator.
 * @param initial - protected state at the start of the line.
 * @returns ending state and whether the line is inside a protected region.
 */
function scanLine(line: string, initial: ProtectedState): { state: ProtectedState; protectedLine: boolean } {
  let state: ProtectedState = initial;
  let escaped = false;
  let protectedLine = state !== "normal";

  for (let index = 0; index < line.length; index += 1) {
    const current = line[index]!;
    const next = line[index + 1];

    // Line comments protect the remainder of the line.
    if (state === "line-comment") {
      protectedLine = true;
      continue;
    }
    // Block comments protect until the closing `*/`.
    if (state === "block-comment") {
      protectedLine = true;
      if (current === "*" && next === "/") {
        state = "normal";
        index += 1;
      }
      continue;
    }
    // Raw backtick strings protect newlines inside the literal.
    if (state === "raw-quote") {
      protectedLine = true;
      if (current === "`") {
        state = "normal";
      }
      continue;
    }
    // Quoted strings protect with escape handling.
    if (state === "double-quote" || state === "single-quote") {
      protectedLine = true;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if ((state === "double-quote" && current === '"') || (state === "single-quote" && current === "'")) {
        state = "normal";
      }
      continue;
    }

    if (current === "/" && next === "/") {
      state = "line-comment";
      protectedLine = true;
      index += 1;
    } else if (current === "/" && next === "*") {
      state = "block-comment";
      protectedLine = true;
      index += 1;
    } else if (current === '"') {
      state = "double-quote";
      protectedLine = true;
    } else if (current === "'") {
      state = "single-quote";
      protectedLine = true;
    } else if (current === "`") {
      state = "raw-quote";
      protectedLine = true;
    }
  }

  return { state, protectedLine };
}

/**
 * Strip trailing horizontal whitespace outside protected literals/comments.
 *
 * @param lines - lines split on LF.
 * @returns lines with trailing whitespace removed where safe.
 */
function stripTrailingWhitespace(lines: readonly string[]): string[] {
  let state: ProtectedState = "normal";
  return lines.map((line) => {
    const scanned = scanLine(line, state);
    // Line comments end at EOL, so reset for the next line.
    state = scanned.state === "line-comment" ? "normal" : scanned.state;
    if (scanned.protectedLine) {
      return line;
    }
    return line.replace(TRAILING_WHITESPACE_RE, "");
  });
}

/**
 * Collapse runs of blank lines to at most one preserved blank line.
 *
 * @param lines - lines split on LF.
 * @returns lines with blank runs collapsed.
 */
function collapseBlankLines(lines: readonly string[]): string[] {
  const result: string[] = [];
  let blankRun = 0;
  let state: ProtectedState = "normal";
  for (const line of lines) {
    const scanned = scanLine(line, state);
    state = scanned.state === "line-comment" ? "normal" : scanned.state;
    const isBlank = line.trim().length === 0 && !scanned.protectedLine;
    if (isBlank) {
      blankRun += 1;
      // Preserve at most MAX_CONSECUTIVE_BLANK_LINES blank lines in a row.
      if (blankRun > MAX_CONSECUTIVE_BLANK_LINES) {
        continue;
      }
    } else {
      blankRun = 0;
    }
    result.push(line);
  }
  return result;
}

/**
 * Normalize generated output without parsing or changing token contents.
 * Multiline strings and comments are treated as protected regions so output
 * hygiene cannot silently change a literal's value or comment text.
 *
 * @param text - raw printer output (may contain BOM/CRLF/trailing whitespace).
 * @param config - resolved formatter config.
 * @returns LF/CRLF-normalized text with hygiene applied.
 */
export function normalize(text: string, config: Config): string {
  const withoutBom = text.startsWith(BOM_CHARACTER) ? text.slice(1) : text;
  if (withoutBom.length === 0) {
    return "";
  }

  const lf = withoutBom.replace(CRLF_TO_LF_RE, "\n");
  let lines = lf.split("\n");
  if (config.trimTrailingWhitespace) {
    lines = stripTrailingWhitespace(lines);
  }
  if (config.collapseBlankLines) {
    lines = collapseBlankLines(lines);
  }

  // A final newline is a policy decision, not an accidental by-product of the
  // printer. Remove all existing terminal empty lines before applying it.
  while (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }
  let normalized = lines.join("\n");
  if (config.insertFinalNewline && normalized.length > 0) {
    normalized += "\n";
  }
  if (config.endOfLine === "crlf") {
    normalized = normalized.replace(LF_TO_CRLF_RE, "\r\n");
  }
  return normalized;
}
