/**
 * Lightweight unified diff generator for CLI output.
 *
 * Produces standard unidiff hunks for `--diff` mode with zero runtime dependencies.
 *
 * @see ARCHITECTURE.md §CLI
 */

/** A contiguous block of changed lines surrounded by context. */
interface DiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly string[];
}

/**
 * Computes a unified diff representation comparing `original` against `formatted`.
 *
 * @param filePath Display path for the diff header.
 * @param original The unformatted or existing source text.
 * @param formatted The canonically formatted source text.
 * @param contextLines Number of surrounding context lines to include around differences (default 3).
 * @returns Unified diff text, or empty string if texts are identical.
 */
export function createUnifiedDiff(
  filePath: string,
  original: string,
  formatted: string,
  contextLines = 3,
): string {
  if (original === formatted) return "";

  const oldLines = original.split(/\r?\n/);
  const newLines = formatted.split(/\r?\n/);

  // Compute simple longest common subsequence or line-by-line diff
  const hunks = buildHunks(oldLines, newLines, contextLines);
  if (!hunks.length) return "";

  const output: string[] = [
    `--- ${filePath}`,
    `+++ ${filePath} (formatted)`,
  ];

  for (const hunk of hunks) {
    output.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    );
    output.push(...hunk.lines);
  }

  return output.join("\n") + "\n";
}

/**
 * Builds unified diff hunks using dynamic programming LCS line comparison.
 */
function buildHunks(
  oldLines: readonly string[],
  newLines: readonly string[],
  context: number,
): DiffHunk[] {
  // Line-level edit script: ' ' = context, '-' = deleted, '+' = inserted
  const edits = computeEdits(oldLines, newLines);

  const hunks: DiffHunk[] = [];
  let index = 0;

  while (index < edits.length) {
    // Find next modification
    while (index < edits.length && edits[index]!.type === " ") {
      index += 1;
    }
    if (index >= edits.length) break;

    // Determine hunk start (with leading context)
    const hunkStartIndex = Math.max(0, index - context);
    let hunkEndIndex = index;

    // Expand hunk to cover modifications within 2 * context of each other
    let lastChangeIndex = index;
    while (hunkEndIndex < edits.length) {
      if (edits[hunkEndIndex]!.type !== " ") {
        lastChangeIndex = hunkEndIndex;
      } else if (hunkEndIndex - lastChangeIndex > 2 * context) {
        break;
      }
      hunkEndIndex += 1;
    }

    const actualEndIndex = Math.min(edits.length, lastChangeIndex + context + 1);

    // Build the hunk lines and count old/new line numbers
    let oldLineCounter = 1;
    for (let i = 0; i < hunkStartIndex; i += 1) {
      if (edits[i]!.type !== "+") oldLineCounter += 1;
    }

    let newLineCounter = 1;
    for (let i = 0; i < hunkStartIndex; i += 1) {
      if (edits[i]!.type !== "-") newLineCounter += 1;
    }

    const hunkLines: string[] = [];
    let oldHunkCount = 0;
    let newHunkCount = 0;

    for (let i = hunkStartIndex; i < actualEndIndex; i += 1) {
      const edit = edits[i]!;
      if (edit.type === " ") {
        hunkLines.push(` ${edit.line}`);
        oldHunkCount += 1;
        newHunkCount += 1;
      } else if (edit.type === "-") {
        hunkLines.push(`-${edit.line}`);
        oldHunkCount += 1;
      } else {
        hunkLines.push(`+${edit.line}`);
        newHunkCount += 1;
      }
    }

    hunks.push({
      oldStart: oldLineCounter,
      oldLines: oldHunkCount,
      newStart: newLineCounter,
      newLines: newHunkCount,
      lines: hunkLines,
    });

    index = actualEndIndex;
  }

  return hunks;
}

interface Edit {
  readonly type: " " | "-" | "+";
  readonly line: string;
}

/**
 * Computes line-level edit sequence using standard Myers/LCS diff algorithm.
 */
function computeEdits(
  oldLines: readonly string[],
  newLines: readonly string[],
): Edit[] {
  const m = oldLines.length;
  const n = newLines.length;

  // Standard LCS dynamic programming table (matrix)
  // For small-to-medium files (most FC files < 1000 lines), 2D matrix is fast and reliable
  if (m * n < 1_500_000) {
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 0; i < m; i += 1) {
      for (let j = 0; j < n; j += 1) {
        if (oldLines[i] === newLines[j]) {
          dp[i + 1]![j + 1] = dp[i]![j]! + 1;
        } else {
          dp[i + 1]![j + 1] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
        }
      }
    }

    const edits: Edit[] = [];
    let i = m;
    let j = n;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        edits.push({ type: " ", line: oldLines[i - 1]! });
        i -= 1;
        j -= 1;
      } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
        edits.push({ type: "+", line: newLines[j - 1]! });
        j -= 1;
      } else if (i > 0) {
        edits.push({ type: "-", line: oldLines[i - 1]! });
        i -= 1;
      }
    }

    return edits.reverse();
  }

  // Fallback linear scan for very large files
  const edits: Edit[] = [];
  const minLen = Math.min(m, n);
  for (let idx = 0; idx < minLen; idx += 1) {
    if (oldLines[idx] === newLines[idx]) {
      edits.push({ type: " ", line: oldLines[idx]! });
    } else {
      edits.push({ type: "-", line: oldLines[idx]! });
      edits.push({ type: "+", line: newLines[idx]! });
    }
  }
  for (let idx = minLen; idx < m; idx += 1) {
    edits.push({ type: "-", line: oldLines[idx]! });
  }
  for (let idx = minLen; idx < n; idx += 1) {
    edits.push({ type: "+", line: newLines[idx]! });
  }
  return edits;
}
