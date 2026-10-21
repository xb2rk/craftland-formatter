#!/usr/bin/env node
/**
 * @fileoverview Benchmarking tool for the FC Formatter printer and parser.
 *
 * Measures warm-up and multi-iteration execution times (median, min, max)
 * on a specified FC file to quantify performance gains and detect regressions.
 */

import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { formatSource } from "../src/printer.mjs";

const input = process.argv[2];
const repetitions = Number(process.argv[3] ?? 5);

if (!input || !Number.isInteger(repetitions) || repetitions < 1) {
  throw new Error("Usage: node scripts/bench-printer.mjs <file.fcg|file.fcc> [repetitions]");
}

const path = resolve(input);
const kind = extname(path).slice(1).toLowerCase();
const source = readFileSync(path, "utf8");

// 1. Warm up module and JIT optimization paths before taking measurements
const warmup = formatSource(source, kind);

if (warmup.output === null) {
  throw new Error(`Formatter refused input: ${warmup.diagnostics[0]?.message}`);
}

// 2. Measure repeated formatting runs
const milliseconds = [];

for (let index = 0; index < repetitions; index += 1) {
  const started = performance.now();
  const result = formatSource(source, kind);
  const elapsed = performance.now() - started;

  milliseconds.push(elapsed);

  if (result.output !== warmup.output) {
    throw new Error("Benchmark result changed between repetitions (non-deterministic output)");
  }
}

// 3. Compute and display timing statistics
milliseconds.sort((a, b) => a - b);
const median = milliseconds[Math.floor(milliseconds.length / 2)];

console.log(
  JSON.stringify(
    {
      path,
      inputBytes: Buffer.byteLength(source),
      outputBytes: Buffer.byteLength(warmup.output),
      repetitions,
      medianMs: Number(median.toFixed(2)),
      minMs: Number(milliseconds[0].toFixed(2)),
      maxMs: Number(milliseconds.at(-1).toFixed(2)),
    },
    null,
    2
  )
);
