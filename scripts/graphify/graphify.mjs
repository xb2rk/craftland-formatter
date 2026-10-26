#!/usr/bin/env node
/**
 * @fileoverview Full high-signal Graphify rebuild pipeline for Craftland FC.
 *
 * Runs:
 * 1. AST & Event & Docs Extraction (Node.js) -> .graphify_extract.json
 * 2. Regularized Community Detection & Export (Python graphify) -> graph.html, GRAPH_REPORT.md, obsidian/
 *
 * Usage:
 *   npm run graphify -- [--repo <dir>] [--out <dir>]
 */

import { spawnSync, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { extractGraph } from "../../src/graphify/extractor.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = path.resolve(SCRIPT_DIR, "../..");

function detectRepoRoot() {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim();
    if (top) return top;
  } catch {
    // Fall back to 2 levels up from tools/fc-format
  }
  return path.resolve(TOOLS_DIR, "../..");
}

function parseArgs(args) {
  const repo = detectRepoRoot();
  const options = {
    repo,
    out: path.join(repo, "graphify-out"),
    scope: path.join(repo, "Assets", "Scripts"),
    docs: path.join(repo, "docs"),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      console.log("Usage: npm run graphify -- [--repo <dir>] [--out <dir>] [--scope <dir>]");
      process.exit(0);
    }
    if (arg === "--repo" && args[i + 1]) {
      options.repo = path.resolve(args[++i]);
    } else if (arg === "--out" && args[i + 1]) {
      options.out = path.resolve(args[++i]);
    } else if (arg === "--scope" && args[i + 1]) {
      options.scope = path.resolve(args[++i]);
    } else if (arg === "--docs" && args[i + 1]) {
      options.docs = path.resolve(args[++i]);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log(`[graphify] Repo:  ${options.repo}`);
  console.log(`[graphify] Scope: ${options.scope}`);
  console.log(`[graphify] Docs:  ${options.docs}`);
  console.log(`[graphify] Out:   ${options.out}`);

  fs.mkdirSync(options.out, { recursive: true });

  console.log("\n--- Step 1: High-Signal AST & Event & Docs Extraction ---");
  const startTime = Date.now();
  const extraction = extractGraph({
    repoRoot: options.repo,
    scopeDir: options.scope,
    docsDir: options.docs,
  });
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  const extractJsonPath = path.join(options.out, ".graphify_extract.json");
  fs.writeFileSync(extractJsonPath, JSON.stringify(extraction, null, 2), "utf8");

  console.log(`Extracted: ${extraction.nodes.length} nodes, ${extraction.edges.length} edges in ${duration}s`);
  console.log(`Saved extraction to: ${extractJsonPath}`);

  console.log("\n--- Step 2: Regularized Clustering & Report Generation ---");
  const pythonBin = process.env.GRAPHIFY_PYTHON ?? "python";
  const rebuildScript = path.join(SCRIPT_DIR, "rebuild.py");

  const pyResult = spawnSync(pythonBin, [
    rebuildScript,
    "--repo", options.repo,
    "--out", options.out,
  ], {
    stdio: "inherit",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });

  if (pyResult.status !== 0) {
    console.error(`[graphify] Python rebuild failed with exit code ${pyResult.status}`);
    process.exit(pyResult.status ?? 1);
  }

  console.log("\nGraphify pipeline completed successfully!");
}

main().catch((err) => {
  console.error("[graphify] Fatal error:", err);
  process.exit(1);
});
