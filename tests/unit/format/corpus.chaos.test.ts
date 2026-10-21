/**
 * @module format/corpus.chaos.test - dirty → canonical convergence for the formatter.
 *
 * Invariant: `formatSource(chaos(canonical)) === canonical` for every
 * representative snippet and for a sample of real `Assets/Scripts` files.
 * `chaos` is deterministic (seeded xorshift) so snapshots are stable across
 * CI runs. Mirrors `gofmt -r` / `prettier` dirty-input tests: the formatter
 * must converge to a single canonical form regardless of how noisy the input
 * whitespace is.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatSource } from "../../../src/format/format.js";

// ---------------------------------------------------------------------------
// Deterministic RNG (xorshift32) - one instance per call, seeded.
// ---------------------------------------------------------------------------

/**
 * Create a seeded RNG returning floats in [0,1).
 *
 * @param seed - initial seed (non-zero).
 * @returns rng function.
 */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 1;
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/**
 * Inject deterministic whitespace noise that must not affect the canonical form.
 * Only touches whitespace that the formatter normalizes (`spaceAroundOperators`,
 * `spaceInside*`, `trimTrailingWhitespace`, `endOfLine`). Never rewrites
 * identifiers/keywords and never mutates inside comments or strings.
 * Blank-line injection is avoided - normalize only collapses consecutive
 * blank lines, so inserting the *first* blank where `canonical` had none would
 * be preserved and would break `chaos(canonical) → canonical`.
 *
 * @param source - canonical source (already `formatSource`'d).
 * @param seed - deterministic seed.
 * @returns noisy source.
 */
function chaos(source: string, seed: number): string {
  const rng = createRng(seed);
  let out = "";
  let inLineComment = false;
  let inBlockComment = false;
  let inRawString = false; // `...`
  let inString = false; // "..."
  let inRune = false; // '...'
  let escapeNext = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    const next = source[i + 1];

    // Track protected regions - copy verbatim while inside.
    if (!inLineComment && !inBlockComment && !inRawString && !inString && !inRune) {
      if (ch === "/" && next === "/" ) {
        inLineComment = true;
        out += ch;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        out += ch;
        continue;
      }
      if (ch === "`") {
        inRawString = true;
        out += ch;
        continue;
      }
      if (ch === '"') {
        inString = true;
        out += ch;
        continue;
      }
      if (ch === "'") {
        inRune = true;
        out += ch;
        continue;
      }
    } else if (inLineComment) {
      out += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    } else if (inBlockComment) {
      out += ch;
      if (ch === "*" && next === "/") {
        out += next!;
        i += 1;
        inBlockComment = false;
      }
      continue;
    } else if (inRawString) {
      out += ch;
      if (ch === "`") inRawString = false;
      continue;
    } else if (inString) {
      out += ch;
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === "\\") {
        escapeNext = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    } else if (inRune) {
      out += ch;
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === "\\") {
        escapeNext = true;
        continue;
      }
      if (ch === "'") inRune = false;
      continue;
    }

    // Outside protected regions - safe whitespace mutations.
    if (ch === " " && rng() < 0.3) {
      out += rng() < 0.5 ? "  " : "\t";
      continue;
    }
    if (ch === "\n" && rng() < 0.2) {
      out += "   \n"; // trailing spaces - `trimTrailingWhitespace` must strip
      continue;
    }
    if ((ch === "," || ch === ":" || ch === ";") && rng() < 0.25) {
      out += " " + ch; // `a,b` → `a ,b` - `spaceInside*`/`spaceAfterComma` must fix
      continue;
    }
    // Occasionally inject a space before operators/brackets (safe).
    if ((ch === "{" || ch === "(" || ch === "[" ) && rng() < 0.15) {
      out += " " + ch;
      continue;
    }

    // CRLF injection for normalize `endOfLine: lf` path (~10% of newlines).
    if (ch === "\n" && rng() < 0.1) {
      out += "\r\n";
      continue;
    }

    out += ch;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Representative raw snippets (one per concern, curated from `Assets/Scripts`
// patterns and `FC_FORMATTER_SPEC.md`). Hand-written whitespace may not be
// canonical - each trial derives `canonical = formatSource(raw)` first.
// ---------------------------------------------------------------------------

/** Raw snippets - canonical form is `formatSource(raw)`. */
const RAW_SNIPPETS: readonly string[] = [
  // 1. imports - bucket order, aliases
  `import "StdLibrary.fcc" as Std
import "EditorGenLib.fcc" as Editor
import "../Contracts/PlayerData.fcc" as PlayerData
import "Foo.fcc" as Foo
`,
  // 2. graph with platform
  `[platform_server]
graph PlayerGraph {
  var _Score int
  func OnTick() {
    if _Score > 0 {
      _Score = 0
    }
  }
}
`,
  // 3. enum with consistent prefix
  `enum ItemKind {
  ItemKind_None,
  ItemKind_Weapon,
  ItemKind_Consumable,
}
`,
  // 4. collections - Data/Map/Struct with trailing comma
  `var inventory = {
  "wood": 1,
  "stone": 2,
}
var lookup = Map<string, int> {
  "a": 1,
}
`,
  // 5. control flow - for/if/wait/start
  `func Update(dt float) {
  for i in range(10) {
    if i == 5 {
      continue
    }
  }
  wait 0.5
  start Foo()
}
`,
  // 6. operators and comparisons
  `func Check(a int, b int) bool {
  return a + b * 2 > 10 && a != b || a >> 1 == 0
}
`,
  // 7. comments + blank lines (max 1 blank)
  `/** Player helpers. */
func Helper(x int) int {
  // step 1
  var y = x + 1

  // step 2 - blank line above is canonical
  return y
}
`,
  // 8. vectors / indexing
  `var pos = Vector3{ 1, 2, 3 }
var arr = List<int>{ 1, 2, 3 }
var v = arr[0]
`,
];

describe("formatter dirty→canonical (chaos)", () => {
  it("converges hand-picked canonical snippets after chaos", () => {
    for (let idx = 0; idx < RAW_SNIPPETS.length; idx += 1) {
      const raw = RAW_SNIPPETS[idx]!;
      const canonical = formatSource(raw);
      // Canonical must be idempotent.
      expect(formatSource(canonical), `snippet ${idx} not idempotent`).toBe(canonical);

      for (let trial = 0; trial < 5; trial += 1) {
        const seed = 0x9e37 + idx * 100 + trial * 17;
        const noisy = chaos(canonical, seed);
        const formatted = formatSource(noisy);
        expect(formatted, `snippet ${idx} trial ${trial} seed ${seed}`).toBe(canonical);
      }
    }
  });

  it("converges sampled real files after chaos", () => {
    const sourceRoot = join(resolve(process.cwd(), "..", ".."), "Assets", "Scripts");

    let files: string[] = [];
    try {
      files = readdirSync(sourceRoot, { withFileTypes: true }).flatMap((entry) => {
        const path = join(sourceRoot, entry.name);
        if (entry.isDirectory()) {
          // One-level deep is enough for a sample; full walk lives in corpus.test.ts.
          return readdirSync(path, { withFileTypes: true })
            .filter((e) => e.isFile() && (e.name.endsWith(".fcg") || e.name.endsWith(".fcc")))
            .map((e) => join(path, e.name));
        }
        return entry.isFile() && (entry.name.endsWith(".fcg") || entry.name.endsWith(".fcc")) ? [path] : [];
      });
    } catch {
      // No corpus on CI agents - skip rather than fail.
      return;
    }
    if (files.length === 0) return;

    // Deterministic sample of 6 files.
    const sample = [...files].sort().slice(0, 6);
    for (let idx = 0; idx < sample.length; idx += 1) {
      const path = sample[idx]!;
      const canonical = formatSource(readFileSync(path, "utf8"));
      for (let trial = 0; trial < 3; trial += 1) {
        const seed = 0x517cc1 + idx * 100 + trial * 19;
        const formatted = formatSource(chaos(canonical, seed));
        expect(formatted, `${path} trial ${trial}`).toBe(canonical);
      }
    }
  });
});
