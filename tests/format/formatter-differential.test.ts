import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatSource as formatSourceV3 } from "../../../fc-format-v3/dist/format/formatter.js";
import { formatSource as formatSourceV4 } from "../../src/format/formatter.js";
import { collectCorpusFiles } from "../helpers/workspace.js";

describe("v4 vs v3 differential parity", () => {
  it("produces identical byte-exact formatting across all checked-in files", () => {
    const files = collectCorpusFiles();
    expect(files.length).toBeGreaterThan(0);
    const diffs: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const v3Result = formatSourceV3(source, { fileName: file });
      const v4Result = formatSourceV4(source, { fileName: file });

      expect(v4Result.diagnostics, file).toEqual([]);

      // V4 fixes 2 known V3 limitations:
      // 1. ConsumableActionRouter.fcg: V3 parser failed on qualified member access in map values; V4 parses and formats cleanly.
      // 2. RewardExpansion.fcg: V3 preserved non-canonical 'func (' in map type; V4 canonicalizes to 'func('.
      if (file.endsWith("ConsumableActionRouter.fcg")) {
        expect(v3Result.code).toBeUndefined(); // V3 failed
        expect(v4Result.code).toBeDefined();   // V4 succeeded
        continue;
      }
      if (file.endsWith("RewardExpansion.fcg")) {
        expect(v4Result.code).toBe(v3Result.code?.replaceAll("func (", "func("));
        continue;
      }

      if (v3Result.code !== v4Result.code) {
        diffs.push(file);
      }
    }

    expect(diffs).toEqual([]);
  }, 120_000);
});
