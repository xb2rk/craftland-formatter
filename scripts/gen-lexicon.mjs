#!/usr/bin/env node
/**
 * Derive only token spellings from the pinned development oracle.
 *
 * This emits data, not generated lexer/parser code. Runtime v5 imports the
 * small generated module and never loads the extension bundle.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadExtensionOracle } from "../src/grammar/extension-oracle.mjs";

const { FCGLexer, sha256 } = loadExtensionOracle();
const keywords = {};
const punctuation = {};

for (let index = 0; index < FCGLexer._LITERAL_NAMES.length; index += 1) {
  const literal = FCGLexer._LITERAL_NAMES[index];

  if (!literal) {
    continue;
  }

  if (!literal.startsWith("'") || !literal.endsWith("'")) {
    throw new Error("Unexpected literal spelling: " + literal);
  }

  const spelling = literal.slice(1, -1);
  const kind = FCGLexer._SYMBOLIC_NAMES[index];

  if (/^[A-Za-z]/.test(spelling)) {
    keywords[spelling] = kind;
  } else {
    punctuation[spelling] = kind;
  }
}

const sortedKeywords = Object.fromEntries(Object.entries(keywords).sort(([a], [b]) => a.localeCompare(b)));
const sortedPunctuation = Object.entries(punctuation).sort(
  ([a], [b]) => b.length - a.length || a.localeCompare(b),
);

const output = [
  "/**",
  " * Generated token spellings from Craftland 1.11.0.",
  " * Bundle SHA-256: " + sha256,
  " * Regenerate with node scripts/gen-lexicon.mjs.",
  " */",
  "export const KEYWORDS = Object.freeze(" + JSON.stringify(sortedKeywords, null, 2) + ");",
  "export const PUNCTUATION = Object.freeze(" + JSON.stringify(sortedPunctuation, null, 2) + ");",
  "",
].join("\n");

const path = new URL("../src/syntax/lexicon.generated.mjs", import.meta.url);

if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== output) {
    throw new Error("Generated lexicon is stale; run node scripts/gen-lexicon.mjs");
  }
  console.log("Generated lexicon is current.");
} else {
  writeFileSync(path, output, "utf8");
  console.log("Wrote " + path.pathname);
}
