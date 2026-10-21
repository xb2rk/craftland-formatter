/**
 * D6 benchmark: wall-clock staging of lex / parse / format over the real
 * corpus plus synthetic nesting ladders.
 *
 * Measurement only — nothing here gates CI. Run with `npm run bench`.
 * Each input is warmed up once and then timed over several iterations;
 * the best (min) sample is reported to suppress JIT/GC noise.
 *
 * What to look for:
 *
 * - µs/token roughly flat across corpus files of different sizes
 *   => effectively linear; no action.
 * - µs/token climbing with file size, or ladder time growing faster
 *   than ladder tokens => superlinear (historically: flat-width rescans in
 *   `formatter.ts` re-scanning nested ranges; fixed by the bottom-up
 *   pair-skip cache in `precomputePairInnerWidths`). If the format stage
 *   climbs again, suspect a new rescan; if lex/parse climb, the cause is
 *   outside the formatter.
 */

import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { formatSource } from "../src/format/formatter.js";
import { lex } from "../src/lex/lexer.js";
import { parseGraphFile, parseHeaderFile } from "../src/parser/file-parser.js";
import { collectCorpusFiles } from "../tests/helpers/workspace.js";

const CORPUS_ITERATIONS = 5;
const LADDER_ITERATIONS = 7;
const LADDER_DEPTHS = [1, 2, 4, 8, 16, 32] as const;

function measureBest(fn: () => void, iterations: number): number {
  fn();
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

interface StageTiming {
  readonly label: string;
  readonly tokens: number;
  readonly lexMs: number;
  readonly parseMs: number;
  readonly fullMs: number;
}

function timeSource(label: string, source: string, isHeader: boolean, iterations: number): StageTiming | undefined {
  const lexed = lex(source);
  if (lexed.diagnostics.length > 0) {
    console.log(`skip ${label}: ${lexed.diagnostics.length} lex diagnostics`);
    return undefined;
  }
  const parsed = isHeader ? parseHeaderFile(lexed) : parseGraphFile(lexed);
  if (parsed.diagnostics.length > 0 || !parsed.node) {
    console.log(`skip ${label}: ${parsed.diagnostics.length} parse diagnostics`);
    return undefined;
  }
  const lexMs = measureBest(() => { lex(source); }, iterations);
  const parseMs = measureBest(() => {
    const fresh = lex(source);
    if (isHeader) parseHeaderFile(fresh); else parseGraphFile(fresh);
  }, iterations);
  const fullMs = measureBest(() => { formatSource(source, { fileName: label }); }, iterations);
  return { label, lexMs, parseMs, fullMs, tokens: lexed.tokens.length };
}

function padEnd(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function reportRow(timing: StageTiming): void {
  const formatMs = Math.max(0, timing.fullMs - timing.lexMs - timing.parseMs);
  const perToken = (timing.fullMs * 1000) / Math.max(1, timing.tokens);
  console.log(
    `${padEnd(timing.label, 44)} ${padStart(String(timing.tokens), 7)}t`
    + ` ${padStart(timing.lexMs.toFixed(2), 8)}ms lex`
    + ` ${padStart(timing.parseMs.toFixed(2), 8)}ms parse`
    + ` ${padStart(formatMs.toFixed(2), 8)}ms format`
    + ` ${padStart(perToken.toFixed(2), 8)}us/tok`,
  );
}

function nestedCompositeSource(depth: number): string {
  let expression = "1";
  for (let i = 0; i < depth; i += 1) expression = `List<object>{${expression}}`;
  return `graph Bench {\nfunc F() {\nvar v List<object> = ${expression};\n}\n}\n`;
}

function nestedGenericSource(depth: number): string {
  let type = "int";
  for (let i = 0; i < depth; i += 1) type = `List<${type}>`;
  return `graph Bench {\nfunc F(x ${type}) {\n}\n}\n`;
}

function main(): void {
  const files = collectCorpusFiles();
  console.log(`corpus files: ${files.length}`);
  console.log(`${padEnd("file", 44)} ${padStart("tokens", 8)} ${padStart("lex", 14)} ${padStart("parse", 16)} ${padStart("format", 16)}  per-token`);
  const timings: StageTiming[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const timing = timeSource(basename(file), source, extname(file).toLowerCase() === ".fcc", CORPUS_ITERATIONS);
    if (timing) {
      timings.push(timing);
      reportRow(timing);
    }
  }
  const totalTokens = timings.reduce((sum, timing) => sum + timing.tokens, 0);
  const totalMs = timings.reduce((sum, timing) => sum + timing.fullMs, 0);
  console.log(`total: ${totalTokens} tokens in ${totalMs.toFixed(2)}ms (${((totalMs * 1000) / Math.max(1, totalTokens)).toFixed(2)}us/tok)`);
  const slowest = [...timings].sort((a, b) => b.fullMs - a.fullMs).slice(0, 5);
  console.log("slowest 5:");
  for (const timing of slowest) reportRow(timing);

  console.log("nesting ladders (depth | tokens | lex | parse | format):");
  for (const depth of LADDER_DEPTHS) {
    const composite = nestedCompositeSource(depth);
    const compositeTiming = timeSource(`composite-depth-${depth}`, composite, false, LADDER_ITERATIONS);
    if (compositeTiming) {
      const compositeFormatMs = Math.max(0, compositeTiming.fullMs - compositeTiming.lexMs - compositeTiming.parseMs);
      console.log(`  composite ${padStart(String(depth), 3)} ${padStart(String(compositeTiming.tokens), 7)}t ${padStart(compositeTiming.lexMs.toFixed(2), 8)}ms lex ${padStart(compositeTiming.parseMs.toFixed(2), 8)}ms parse ${padStart(compositeFormatMs.toFixed(2), 8)}ms format`);
    }
    const generic = nestedGenericSource(depth);
    const genericTiming = timeSource(`generic-depth-${depth}`, generic, false, LADDER_ITERATIONS);
    if (genericTiming) {
      const genericFormatMs = Math.max(0, genericTiming.fullMs - genericTiming.lexMs - genericTiming.parseMs);
      console.log(`  generic   ${padStart(String(depth), 3)} ${padStart(String(genericTiming.tokens), 7)}t ${padStart(genericTiming.lexMs.toFixed(2), 8)}ms lex ${padStart(genericTiming.parseMs.toFixed(2), 8)}ms parse ${padStart(genericFormatMs.toFixed(2), 8)}ms format`);
    }
  }
}

main();
