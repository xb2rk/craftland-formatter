#!/usr/bin/env node
/**
 * @fileoverview CLI tool to query Blast Radius & Dependencies using Graphify knowledge graph.
 *
 * Usage:
 *   node scripts/graphify/query.mjs <symbol-or-file> [--json] [--depth <n>]
 *   npm run graphify:query -- <symbol-or-file>
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { queryBlastRadius } from "../../src/graphify/query.mjs";
import { extractGraph } from "../../src/graphify/extractor.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = path.resolve(SCRIPT_DIR, "../..");

function detectRepoRoot() {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim();
    if (top) return top;
  } catch {
    // Fall back
  }
  return path.resolve(TOOLS_DIR, "../..");
}

function parseArgs(args) {
  const repo = detectRepoRoot();
  let queryStr = "";
  let jsonOutput = false;
  let maxDepth = 2;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--depth" && args[i + 1]) {
      maxDepth = parseInt(args[++i], 10);
    } else if (!arg.startsWith("-") && !queryStr) {
      queryStr = arg;
    }
  }

  return { repo, queryStr, jsonOutput, maxDepth };
}

async function main() {
  const { repo, queryStr, jsonOutput, maxDepth } = parseArgs(process.argv.slice(2));

  if (!queryStr) {
    console.error("Usage: npm run graphify:query -- <symbol-or-file> [--json] [--depth <n>]");
    console.error("Examples:");
    console.error("  npm run graphify:query -- Server_InventoryManager.fcg");
    console.error("  npm run graphify:query -- AddItem");
    console.error("  npm run graphify:query -- Notify_InventoryChanged");
    process.exit(1);
  }

  const extractPath = path.join(repo, "graphify-out", ".graphify_extract.json");
  let extraction = null;

  if (fs.existsSync(extractPath)) {
    extraction = JSON.parse(fs.readFileSync(extractPath, "utf8"));
  } else {
    // Run on-the-fly extraction
    console.error("[graphify:query] Extracting fresh graph in-memory...");
    extraction = extractGraph({
      repoRoot: repo,
      scopeDir: path.join(repo, "Assets", "Scripts"),
    });
  }

  const result = queryBlastRadius(extraction, queryStr, { maxDepth });

  if (result.error) {
    console.error(`[Error] ${result.error}`);
    process.exit(1);
  }

  if (result.ambiguous) {
    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }
    console.log(`\n⚠️  AMBIGUOUS SYMBOL: '${queryStr}'`);
    console.log(`Found ${result.candidates.length} matching declarations across different files.`);
    console.log(`Please re-run query using a qualified name '<Module>.<Function>':\n`);
    for (let i = 0; i < result.candidates.length; i++) {
      const c = result.candidates[i];
      console.log(`  ${i + 1}. npm run graphify:query -- ${c.label}`);
      console.log(`     ↳ File: ${c.file}`);
    }
    console.log("");
    process.exit(0);
  }

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Beautiful formatted text output
  console.log(`\n================ BLAST RADIUS REPORT ================`);
  console.log(`Target:      ${result.target.label} (${result.target.domain})`);
  console.log(`File:        ${result.target.file}`);
  console.log(`In-degree:   ${result.target.in_degree} incoming dependencies`);
  if (result.hub_suppressed) {
    console.log(`Notice:      [HUB DETECTED] Multi-hop expansion damped to prevent combinatorial explosion.`);
  }

  if (result.co_dependent_cycle.length > 0) {
    console.log(`\n⚠️  CIRCULAR IMPORT CYCLE (Coupled Subsystem - ${result.co_dependent_cycle.length} files):`);
    for (const c of result.co_dependent_cycle.slice(0, 5)) {
      console.log(`   ⇄ ${c.label} (${c.file})`);
    }
    if (result.co_dependent_cycle.length > 5) {
      console.log(`   ... and ${result.co_dependent_cycle.length - 5} more files in cycle.`);
    }
  }

  console.log(`\n📌 DIRECT CALLERS & CONSUMERS (${result.direct_dependents.length} files):`);
  if (result.direct_dependents.length === 0) {
    console.log("   (No direct consumers found)");
  } else {
    for (const d of result.direct_dependents.slice(0, 15)) {
      console.log(`   ← [${d.relation}] ${d.label} (${d.file})`);
    }
    if (result.direct_dependents.length > 15) {
      console.log(`   ... and ${result.direct_dependents.length - 15} more direct consumers.`);
    }
  }

  if (result.event_cascade.length > 0) {
    console.log(`\n⚡ EVENT BUS SUBSCRIBERS (${result.event_cascade.length} connections):`);
    for (const ec of result.event_cascade) {
      console.log(`   ⚡ [${ec.event}] -> Subscribed by ${ec.subscriber} (${ec.file})`);
    }
  }

  if (result.indirect_tier2.length > 0) {
    console.log(`\n🔍 INDIRECT TIER-2 IMPACT (${result.indirect_tier2.length} files):`);
    for (const ind of result.indirect_tier2.slice(0, 10)) {
      console.log(`   ↳ [${ind.relation}] ${ind.label} via ${ind.via}`);
    }
    if (result.indirect_tier2.length > 10) {
      console.log(`   ... and ${result.indirect_tier2.length - 10} more indirect files.`);
    }
  }

  console.log(`\nRecommended review count: ${result.summary.direct_count + result.summary.event_cascade_count} files`);
  console.log(`=====================================================\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
