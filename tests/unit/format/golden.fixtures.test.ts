/**
 * @module format/golden.fixtures.test - per-category golden fixtures.
 *
 * Each `src/format/fixtures/*.fcc` is a canonical file (already `formatSource`'d).
 * This suite proves two invariants that CI reviewers care about:
 * 1) **Idempotent** - `format(fixture) === fixture` (no drift on re-run).
 * 2) **Lossless-ish** - retokenizing never hits `OTHER` (unknown char).
 * 3) **Chaos-convergent** - whitespace noise collapses back to the same fixture
 *    (reuses the dirty→canonical logic from `corpus.chaos.test`).
 *
 * Add a new category by dropping `<name>.fcc` into `fixtures/` - no code
 * change needed. To update a golden: edit the `.fcc` in place, run
 * `node --import tsx -e "import{formatSource}from'./src/format/format.ts';..."`
 * or `npm test -- golden.fixtures --update` (future).
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatSource } from "../../../src/format/format.js";
import { TokenId } from "../../../src/lex/grammar.generated.js";
import { tokenize } from "../../../src/lex/tokenizer.js";

const packageDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(packageDir, "../../fixtures");

/**
 * List golden fixture paths (sorted, deterministic).
 *
 * @returns sorted absolute paths to `*.fcc`.
 */
function listFixtures(): string[] {
  return readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".fcc"))
    .sort()
    .map((name) => join(fixturesDir, name));
}

/**
 * Deterministic xorshift RNG for minimal chaos.
 * @param seed - non-zero seed.
 * @returns rng in [0,1).
 */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

describe("golden fixtures - per-category snapshots", () => {
  const fixtures = listFixtures();

  it("discovers fixtures", () => {
    // 8 categories: imports/graphs/enums/collections/flow/operators/comments/vectors
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
    expect(fixtures.map((p) => p.replace(/\\/g, "/").split("/").pop())).toEqual(
      expect.arrayContaining([
        "imports.fcc",
        "graphs.fcc",
        "enums.fcc",
        "collections.fcc",
        "flow.fcc",
        "operators.fcc",
        "comments.fcc",
        "vectors.fcc",
      ]),
    );
  });

  for (const path of fixtures) {
    const name = path.replace(/\\/g, "/").split("/").pop()!;

    it(`${name} is idempotent`, () => {
      const src = readFileSync(path, "utf8");
      const out = formatSource(src);
      expect(out, `${name} - edit the fixture to be canonical (run formatSource on it)`).toBe(src);
      expect(formatSource(out), `${name} not stable on second pass`).toBe(src);
    });

    it(`${name} tokenizes without OTHER`, () => {
      const src = readFileSync(path, "utf8");
      const tokens = tokenize(src);
      const unknowns = tokens.filter((t) => t.kind === TokenId.OTHER);
      expect(unknowns, `${name} has unknown characters`).toEqual([]);
    });
  }

  it("each fixture converges after whitespace chaos (3 trials)", () => {
    for (const path of fixtures) {
      const name = path.replace(/\\/g, "/").split("/").pop()!;
      const canonical = readFileSync(path, "utf8");
      for (let trial = 0; trial < 3; trial += 1) {
        const r = rng(0x71a + trial * 97 + name.length * 13);
        // Minimal chaos: double-space / trailing spaces / stray " ," - must collapse.
        let noisy = "";
        let inLine = false;
        let inBlock = false;
        for (let i = 0; i < canonical.length; i += 1) {
          const ch = canonical[i]!;
          const nx = canonical[i + 1];
          if (!inLine && !inBlock) {
            if (ch === "/" && nx === "/") {
              inLine = true;
              noisy += ch;
              continue;
            }
            if (ch === "/" && nx === "*") {
              inBlock = true;
              noisy += ch;
              continue;
            }
          } else if (inLine) {
            noisy += ch;
            if (ch === "\n") inLine = false;
            continue;
          } else if (inBlock) {
            noisy += ch;
            if (ch === "*" && nx === "/") {
              noisy += nx!;
              i += 1;
              inBlock = false;
            }
            continue;
          }
          if (ch === " " && r() < 0.25) {
            noisy += r() < 0.5 ? "  " : "\t";
            continue;
          }
          if (ch === "\n" && r() < 0.15) {
            noisy += "   \n";
            continue;
          }
          if ((ch === "," || ch === ":") && r() < 0.2) {
            noisy += " " + ch;
            continue;
          }
          noisy += ch;
        }
        const formatted = formatSource(noisy);
        expect(formatted, `${name} trial ${trial}`).toBe(canonical);
      }
    }
  });
});
