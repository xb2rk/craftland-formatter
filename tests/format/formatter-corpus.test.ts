import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatSource } from "../../src/format/formatter.js";
import { lex } from "../../src/lex/lexer.js";
import { parseGraphFile, parseHeaderFile } from "../../src/parser/file-parser.js";
import { semanticFingerprint } from "../helpers/semantic-fingerprint.js";
import { collectCorpusFiles } from "../helpers/workspace.js";

describe("formatter corpus gate", () => {
  it("formats, reparses, and stabilizes every checked-in FC source", () => {
    const files = collectCorpusFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const originalLexed = lex(source);
      const originalParsed = file.toLowerCase().endsWith(".fcc") ? parseHeaderFile(originalLexed) : parseGraphFile(originalLexed);
      expect(originalParsed.diagnostics, file).toEqual([]);
      expect(originalParsed.consumedThroughEof, file).toBe(true);
      const result = formatSource(source, { fileName: file });
      expect(result.code, file).toBeDefined();
      const formatted = result.code!;
      const second = formatSource(formatted, { fileName: file });
      expect(second.diagnostics, file).toEqual([]);
      expect(second.code, file).toBe(formatted);
      const formattedLexed = lex(formatted);
      const parsed = file.toLowerCase().endsWith(".fcc") ? parseHeaderFile(formattedLexed) : parseGraphFile(formattedLexed);
      expect(parsed.diagnostics, file).toEqual([]);
      expect(parsed.consumedThroughEof, file).toBe(true);
      expect(parsed.node, file).toBeDefined();
      expect(originalParsed.node, file).toBeDefined();
      expect(semanticFingerprint(parsed.node, formattedLexed.tokens), file).toBe(semanticFingerprint(originalParsed.node, originalLexed.tokens));
    }
  }, 120_000);
});
