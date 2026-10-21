#!/usr/bin/env node

/**
 * @fileoverview Standalone CLI runner for the Craftland FC Linter.
 *
 * Scans `.fcg` and `.fcc` files, checks for code safety, logic bugs,
 * and style violations, and reports diagnostics in stylish or JSON format.
 */

import * as fs from "node:fs";
import { resolve } from "node:path";
import { discoverFiles } from "../src/cli.mjs";
import { lintSource } from "../src/lint/engine.mjs";

function printHelp() {
  console.log(`
Usage: fclint [options] <file|dir...>

Options:
  --format <stylish|json>   Output format (default: stylish)
  --max-warnings <number>   Number of warnings to trigger non-zero exit code (default: unlimited)
  --help                    Show this help message
  --version                 Show version
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(args.length === 0 ? 2 : 0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    console.log(`fclint v${pkg.version}`);
    process.exit(0);
  }

  let format = "stylish";
  let maxWarnings = -1;
  const paths = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--format") {
      format = args[++i];
    } else if (arg.startsWith("--format=")) {
      format = arg.slice("--format=".length);
    } else if (arg === "--max-warnings") {
      maxWarnings = parseInt(args[++i], 10);
    } else if (arg.startsWith("--max-warnings=")) {
      maxWarnings = parseInt(arg.slice("--max-warnings=".length), 10);
    } else if (!arg.startsWith("--")) {
      paths.push(arg);
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(2);
    }
  }

  if (paths.length === 0) {
    console.error("Error: At least one file or directory path is required.");
    process.exit(2);
  }

  let files = [];
  try {
    files = discoverFiles(paths, true);
  } catch (err) {
    console.error(`Discovery error: ${err.message}`);
    process.exit(2);
  }

  if (files.length === 0) {
    console.error("No .fcg or .fcc files found in the specified paths.");
    process.exit(0);
  }

  const results = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const file of files) {
    try {
      const source = fs.readFileSync(file, "utf8");
      const { lintResult } = lintSource(source, {}, file);

      if (lintResult.diagnostics.length > 0) {
        results.push({
          filePath: file,
          diagnostics: lintResult.diagnostics,
          errorCount: lintResult.errorCount,
          warningCount: lintResult.warningCount,
        });
        totalErrors += lintResult.errorCount;
        totalWarnings += lintResult.warningCount;
      }
    } catch (err) {
      console.error(`Error reading ${file}: ${err.message}`);
      process.exit(2);
    }
  }

  if (format === "json") {
    console.log(JSON.stringify(results, null, 2));
  } else {
    // Stylish format
    for (const res of results) {
      console.log(`\n${res.filePath}`);
      for (const diag of res.diagnostics) {
        const pos = `${diag.line}:${diag.column}`.padEnd(8);
        const sev = diag.severity === "error" ? "\x1b[31merror\x1b[0m" : "\x1b[33mwarning\x1b[0m";
        const rule = `\x1b[90m${diag.ruleId}\x1b[0m`;
        console.log(`  ${pos} ${sev.padEnd(16)} ${diag.message}  ${rule}`);
      }
    }

    const totalProblems = totalErrors + totalWarnings;
    if (totalProblems > 0) {
      const errStr = `${totalErrors} error${totalErrors === 1 ? "" : "s"}`;
      const warnStr = `${totalWarnings} warning${totalWarnings === 1 ? "" : "s"}`;
      console.log(`\n\x1b[31m✖ ${totalProblems} problem${totalProblems === 1 ? "" : "s"} (${errStr}, ${warnStr})\x1b[0m`);
    } else {
      console.log(`\x1b[32m✔ No lint issues found across ${files.length} file${files.length === 1 ? "" : "s"}.\x1b[0m`);
    }
  }

  if (totalErrors > 0) {
    process.exit(1);
  }

  if (maxWarnings >= 0 && totalWarnings > maxWarnings) {
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
