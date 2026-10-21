#!/usr/bin/env node
/**
 * @fileoverview Read-only project rollout dry run.
 *
 * Scans the game's FC codebase (`Assets/Scripts`), checks formatting differences,
 * aggregates impacted files by subsystem area, and reports potential diagnostics
 * without modifying any source files on disk.
 */

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatConfiguredSource } from "../src/service.mjs";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultTarget = existsSync(join(packageRoot, "Assets", "Scripts"))
  ? join(packageRoot, "Assets", "Scripts")
  : join(packageRoot, "tests", "fixtures");
const scriptsDirectory = resolve(process.argv[2] ?? defaultTarget);

const summary = {
  scanned: 0,
  ignored: 0,
  changed: 0,
  eolOnly: 0,
  contentChanged: 0,
  diagnostics: [],
  byArea: {},
  largestChangedFiles: [],
};

/**
 * Recursively discover all `.fcg` and `.fcc` files under a directory.
 * @param {string} directory
 * @returns {string[]}
 */
function discoverFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });

  entries.sort((a, b) => a.name.localeCompare(b.name));

  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) {
      return [];
    }

    if (entry.isDirectory()) {
      return discoverFiles(path);
    }

    const extension = extname(path).toLowerCase();
    const isFcFile = extension === ".fcg" || extension === ".fcc";

    return isFcFile ? [path] : [];
  });
}

// Execute the read-only dry run across all discovered scripts
for (const path of discoverFiles(scriptsDirectory)) {
  summary.scanned += 1;

  const relativePath = relative(scriptsDirectory, path);
  const pathComponents = relativePath.split(/[\\/]/);
  const areaName = pathComponents.length > 1 ? pathComponents[0] : "(root)";
  const areaBucket = (summary.byArea[areaName] ??= { scanned: 0, changed: 0 });

  areaBucket.scanned += 1;

  const source = readFileSync(path, "utf8");
  const result = formatConfiguredSource(source, path);

  if (result.ignored) {
    summary.ignored += 1;
    continue;
  }

  if (result.output === null) {
    summary.diagnostics.push({
      file: relative(packageRoot, path),
      diagnostics: result.diagnostics,
    });
    continue;
  }

  if (result.output === source) {
    continue;
  }

  summary.changed += 1;
  areaBucket.changed += 1;

  const isEolOnlyDifference =
    result.output.replace(/\r\n?|\n/g, "\n") === source.replace(/\r\n?|\n/g, "\n");

  if (isEolOnlyDifference) {
    summary.eolOnly += 1;
  } else {
    summary.contentChanged += 1;
    summary.largestChangedFiles.push({
      file: relative(packageRoot, path),
      inputBytes: Buffer.byteLength(source),
    });
  }
}

// Retain only top 12 largest changed files for clean summary inspection
summary.largestChangedFiles.sort((a, b) => b.inputBytes - a.inputBytes);
summary.largestChangedFiles = summary.largestChangedFiles.slice(0, 12);

console.log(JSON.stringify(summary, null, 2));

if (summary.diagnostics.length > 0) {
  process.exitCode = 1;
}
