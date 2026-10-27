/**
 * @fileoverview Deterministic, zero-dependency unified diff generator.
 *
 * Produces standard Git-compatible unified diff hunks (--- a/..., +++ b/..., @@ -L,C +L,C @@)
 * to display proposed formatting changes without spawning git child processes.
 */

/**
 * Represents a single line with its line-ending bytes.
 * @typedef {{
 *   text: string,
 *   ending: string
 * }} SourceLine
 */

/**
 * Split source text into lines while preserving their exact line ending sequences.
 *
 * @param {string} source - Source text to split.
 * @returns {SourceLine[]}
 */
function linesOf(source) {
  const lines = [];
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "\n" && source[index] !== "\r") {
      continue;
    }

    const ending = source[index] === "\r" && source[index + 1] === "\n" ? "\r\n" : source[index];

    lines.push({
      text: source.slice(start, index),
      ending,
    });

    index += ending.length - 1;
    start = index + 1;
  }

  if (start < source.length) {
    lines.push({
      text: source.slice(start),
      ending: "",
    });
  }

  return lines;
}

/**
 * Test whether two lines are byte-for-byte identical, including line endings.
 *
 * @param {SourceLine} left
 * @param {SourceLine} right
 * @returns {boolean}
 */
function sameLine(left, right) {
  return left.text === right.text && left.ending === right.ending;
}

/**
 * Standard ANSI terminal escape sequences for syntax-colored diff output.
 * - Bold: diff file headers (--- a/..., +++ b/...)
 * - Red: deleted source lines (-)
 * - Green: added / formatted source lines (+)
 * - Cyan: unified diff hunk coordinates (@@ -L,C +L,C @@)
 * - Reset: restore normal terminal styling
 */
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_RED = "\x1b[31m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_CYAN = "\x1b[36m";

/** Standard git context lines included before and after each changed hunk. */
const CONTEXT_LINE_COUNT = 3;

/**
 * Format a diff line with its action prefix (' ', '-', '+') and EOL representation.
 *
 * @param {" " | "-" | "+"} prefix
 * @param {SourceLine} line
 * @param {boolean} [useColor=false]
 * @returns {string}
 */
function renderLine(prefix, line, useColor = false) {
  const visibleReturn = line.ending.startsWith("\r") ? "\r" : "";
  const missingNewline = line.ending ? "" : "\\ No newline at end of file\n";
  const raw = `${prefix}${line.text}${visibleReturn}\n${missingNewline}`;

  if (!useColor) {
    return raw;
  }

  if (prefix === "-") {
    return `${ANSI_RED}${raw}${ANSI_RESET}`;
  }

  if (prefix === "+") {
    return `${ANSI_GREEN}${raw}${ANSI_RESET}`;
  }

  return raw;
}

/**
 * Generate a unified diff hunk comparing `before` and `after` texts.
 *
 * @param {string} before - Original source code.
 * @param {string} after - Formatted source code.
 * @param {string} path - Display relative file path.
 * @param {{ color?: boolean }} [options] - Output formatting options.
 * @returns {string} Unified diff string, or empty string if inputs are identical.
 */
export function unifiedDiff(before, after, path, options = {}) {
  if (before === after) {
    return "";
  }

  const useColor = options.color ?? false;
  const oldLines = linesOf(before);
  const newLines = linesOf(after);

  // 1. Scan matching prefix lines
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && sameLine(oldLines[prefix], newLines[prefix])) {
    prefix += 1;
  }

  // 2. Scan matching suffix lines
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    sameLine(oldLines[oldLines.length - suffix - 1], newLines[newLines.length - suffix - 1])
  ) {
    suffix += 1;
  }

  // 3. Compute 3-line context boundaries
  const contextBefore = Math.max(0, prefix - CONTEXT_LINE_COUNT);
  const oldChangedEnd = oldLines.length - suffix;
  const newChangedEnd = newLines.length - suffix;
  const contextAfter = Math.min(CONTEXT_LINE_COUNT, suffix);

  const oldEnd = oldChangedEnd + contextAfter;
  const newEnd = newChangedEnd + contextAfter;

  const headerOld = `--- a/${path}\n`;
  const headerNew = `+++ b/${path}\n`;
  const hunkRange = `@@ -${contextBefore + 1},${oldEnd - contextBefore} +${contextBefore + 1},${newEnd - contextBefore} @@\n`;

  const output = [
    useColor ? `${ANSI_BOLD}${headerOld}${ANSI_RESET}` : headerOld,
    useColor ? `${ANSI_BOLD}${headerNew}${ANSI_RESET}` : headerNew,
    useColor ? `${ANSI_CYAN}${hunkRange}${ANSI_RESET}` : hunkRange,
  ];

  // Leading context
  for (let index = contextBefore; index < prefix; index += 1) {
    output.push(renderLine(" ", oldLines[index], useColor));
  }

  // Deleted lines
  for (let index = prefix; index < oldChangedEnd; index += 1) {
    output.push(renderLine("-", oldLines[index], useColor));
  }

  // Added lines
  for (let index = prefix; index < newChangedEnd; index += 1) {
    output.push(renderLine("+", newLines[index], useColor));
  }

  // Trailing context
  for (let index = 0; index < contextAfter; index += 1) {
    output.push(renderLine(" ", oldLines[oldChangedEnd + index], useColor));
  }

  return output.join("");
}

/**
 * Executes Myers' O(ND) difference algorithm on two line arrays.
 * Traverses edit graph diagonals to find the shortest edit script (SES).
 *
 * @param {SourceLine[]} a - Original line slice.
 * @param {SourceLine[]} b - Formatted line slice.
 * @returns {Array<{ oldIndex: number, newIndex: number }>} Matched line coordinates.
 */
function myersMatches(a, b) {
  const N = a.length;
  const M = b.length;
  const max = N + M;

  if (max === 0) {
    return [];
  }

  // Offset array to center diagonal index k in [-max, max] at index [0, 2*max]
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace = [];

  v.fill(-1);
  v[offset + 1] = 0;

  for (let d = 0; d <= max; d += 1) {
    trace.push(new Int32Array(v));

    // Iterate diagonals k from -d to d in steps of 2
    for (let k = -d; k <= d; k += 2) {
      let x;

      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }

      let y = x - k;

      while (x < N && y < M && sameLineContent(a[x], b[y])) {
        x += 1;
        y += 1;
      }

      v[offset + k] = x;

      if (x >= N && y >= M) {
        return backtrackMyers(trace, a, b, d, k, offset);
      }
    }
  }

  return [];
}

/**
 * Backtracks the Myers trace matrix to collect diagonal matching line coordinates.
 *
 * @param {Int32Array[]} trace
 * @param {SourceLine[]} a
 * @param {SourceLine[]} b
 * @param {number} d
 * @param {number} k
 * @param {number} offset
 * @returns {Array<{ oldIndex: number, newIndex: number }>}
 */
function backtrackMyers(trace, a, b, d, k, offset) {
  let x = a.length;
  let y = b.length;
  let currentK = k;
  const matches = [];

  for (let step = d; step > 0; step -= 1) {
    const v = trace[step];
    const prevK = (currentK === -step || (currentK !== step && v[offset + currentK - 1] < v[offset + currentK + 1]))
      ? currentK + 1
      : currentK - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      matches.unshift({ oldIndex: x, newIndex: y });
    }

    x = prevX;
    y = prevY;
    currentK = prevK;
  }

  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    matches.unshift({ oldIndex: x, newIndex: y });
  }

  return matches;
}

/**
 * Represents a contiguous line replacement or insertion hunk between two texts.
 *
 * @typedef {Object} LineHunk
 * @property {number} oldStartLine - 0-based start line index in original text.
 * @property {number} oldLineCount - Number of lines deleted/replaced in original text.
 * @property {number} newStartLine - 0-based start line index in formatted text.
 * @property {number} newLineCount - Number of lines replacing in formatted text.
 * @property {string} newText - Replacement text including line endings.
 * @property {string} oldText - Original text being replaced.
 */

/**
 * Test whether two lines have identical content, ignoring line ending differences.
 * Used for range formatting and surgical line hunk computation.
 *
 * @param {SourceLine} left
 * @param {SourceLine} right
 * @returns {boolean}
 */
function sameLineContent(left, right) {
  return left.text === right.text;
}

/**
 * Computes line-level replacement hunks between original and formatted source code.
 *
 * Line endings are matched flexibly to prevent whole-document hunk collapse
 * when editor buffers and formatted outputs use different EOL conventions.
 *
 * @param {string} before - Original source text.
 * @param {string} after - Formatted source text.
 * @returns {LineHunk[]}
 */
export function computeLineHunks(before, after) {
  if (before === after) {
    return [];
  }

  const oldLines = linesOf(before);
  const newLines = linesOf(after);
  const targetEnding = before.includes("\r\n") ? "\r\n" : "\n";
  let prefix = 0;

  // 1. Common prefix trimming (content-based)
  while (prefix < oldLines.length && prefix < newLines.length && sameLineContent(oldLines[prefix], newLines[prefix])) {
    prefix += 1;
  }

  // 2. Common suffix trimming (content-based)
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    sameLineContent(oldLines[oldLines.length - suffix - 1], newLines[newLines.length - suffix - 1])
  ) {
    suffix += 1;
  }

  const midOld = oldLines.slice(prefix, oldLines.length - suffix);
  const midNew = newLines.slice(prefix, newLines.length - suffix);

  if (midOld.length === 0 && midNew.length === 0) {
    return [];
  }

  // 3. Myers line difference matching on the middle slice
  const matches = myersMatches(midOld, midNew);
  const hunks = [];
  let lastOld = 0;
  let lastNew = 0;

  for (const match of matches) {
    if (lastOld < match.oldIndex || lastNew < match.newIndex) {
      const sliceOld = midOld.slice(lastOld, match.oldIndex);
      const sliceNew = midNew.slice(lastNew, match.newIndex);

      hunks.push({
        oldStartLine: prefix + lastOld,
        oldLineCount: sliceOld.length,
        newStartLine: prefix + lastNew,
        newLineCount: sliceNew.length,
        newText: sliceNew.map((item) => item.text + (item.ending ? targetEnding : "")).join(""),
        oldText: sliceOld.map((item) => item.text + item.ending).join(""),
      });
    }

    lastOld = match.oldIndex + 1;
    lastNew = match.newIndex + 1;
  }

  // 4. Remaining unkept tail in the middle slice
  if (lastOld < midOld.length || lastNew < midNew.length) {
    const sliceOld = midOld.slice(lastOld);
    const sliceNew = midNew.slice(lastNew);

    hunks.push({
      oldStartLine: prefix + lastOld,
      oldLineCount: sliceOld.length,
      newStartLine: prefix + lastNew,
      newLineCount: sliceNew.length,
      newText: sliceNew.map((item) => item.text + (item.ending ? targetEnding : "")).join(""),
      oldText: sliceOld.map((item) => item.text + item.ending).join(""),
    });
  }

  return hunks;
}
