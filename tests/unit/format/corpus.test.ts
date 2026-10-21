/**
 * @module format/corpus.test - verifies the real `Assets/Scripts` corpus.
 *
 * Two invariants over every `.fcg`/`.fcc` file in `Assets/Scripts`:
 * (1) `tokenize→reconstructTokens` is lossless and never produces `OTHER`;
 * (2) `formatSource` is idempotent. Skipped when the corpus is absent.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatSource } from "../../../src/format/format.js";
import { TokenId } from "../../../src/lex/grammar.generated.js";
import { reconstructTokens } from "../../../src/lex/tokens.js";
import { tokenize } from "../../../src/lex/tokenizer.js";

/**
 * Recursively collect `.fcg`/`.fcc` files.
 *
 * @param directory - directory to walk.
 * @returns absolute file paths.
 */
function collectFcFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectFcFiles(path);
    return entry.isFile() && (entry.name.endsWith(".fcg") || entry.name.endsWith(".fcc")) ? [path] : [];
  });
}

const sourceRoot = join(resolve(process.cwd(), "..", ".."), "Assets", "Scripts");

describe("Assets/Scripts lexical corpus", () => {
  it("is losslessly tokenized without unknown characters", () => {
    let files: string[] = [];
    try {
      files = collectFcFiles(sourceRoot);
    } catch {
      return;
    }
    if (files.length === 0) return;

    const unknown: string[] = [];
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      const tokens = tokenize(source);
      expect(reconstructTokens(tokens), path).toBe(source);
      if (tokens.some((token) => token.kind === TokenId.OTHER)) unknown.push(path);
    }
    expect(unknown).toEqual([]);
  });

  it("is idempotently formatted", () => {
    let files: string[] = [];
    try {
      files = collectFcFiles(sourceRoot);
    } catch {
      return;
    }
    if (files.length === 0) return;
    const nonIdempotent: string[] = [];
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      const once = formatSource(source);
      const twice = formatSource(once);
      if (once !== twice) nonIdempotent.push(path);
    }
    expect(nonIdempotent).toEqual([]);
  });
});
