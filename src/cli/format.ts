#!/usr/bin/env node

/**
 * Command-line interface for the FC v4 Language Formatter.
 *
 * Supports recursive directory formatting, in-memory stdin formatting,
 * unified diffs (`--diff`), `--check`, `--config`, and upward config discovery.
 *
 * @see ARCHITECTURE.md §CLI
 */

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFormatConfig } from "../format/config-loader.js";
import { formatSource } from "../format/formatter.js";
import type { FormatOptions } from "../format/options.js";
import { formatDiagnosticList } from "./diagnostics.js";
import { createUnifiedDiff } from "./diff.js";

/** Current CLI version. */
export const CLI_VERSION = "0.4.0";

/** Parsed command line arguments. */
export interface CliOptions {
  readonly check: boolean;
  readonly write: boolean;
  readonly diff: boolean;
  readonly configPath: string | undefined;
  readonly stdinFilepath: string | undefined;
  readonly inputs: readonly string[];
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
  "Temp",
  "Libraries",
  "Cache",
]);

/**
 * Parses CLI arguments.
 */
export function parseArgs(args: readonly string[]): CliOptions | "help" | "version" {
  let check = false;
  let write = false;
  let diff = false;
  let configPath: string | undefined;
  let stdinFilepath: string | undefined;
  const inputs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;

    if (arg === "-h" || arg === "--help") return "help";
    if (arg === "-v" || arg === "--version") return "version";

    if (arg === "-c" || arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "-w" || arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "-d" || arg === "--diff") {
      diff = true;
      continue;
    }
    if (arg === "--stdin-filepath") {
      const next = args[index + 1];
      if (!next || next.startsWith("-")) {
        throw new Error("--stdin-filepath requires a file path");
      }
      stdinFilepath = next;
      index += 1;
      continue;
    }
    if (arg === "--config") {
      const next = args[index + 1];
      if (!next || next.startsWith("-")) {
        throw new Error("--config requires a configuration file path");
      }
      configPath = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`unknown option '${arg}'`);
    }
    inputs.push(arg);
  }

  return { check, write, diff, configPath, stdinFilepath, inputs };
}

/** Returns CLI usage instructions. */
export function usage(): string {
  return [
    `fc-format-v4 v${CLI_VERSION}`,
    "",
    "Usage: fc-format-v4 [options] <file-or-directory> [...]",
    "",
    "Formats Free Fire Craftland Code (.fcc and .fcg) files in place.",
    "Directories are searched recursively.",
    "",
    "Options:",
    "  -w, --write             Write formatted output back to files in place (default behavior).",
    "  -c, --check             List files that differ from canonical formatting and exit with 1.",
    "  -d, --diff              Display unified diffs showing formatting changes.",
    "      --stdin-filepath    Read source from stdin and format as if located at the specified path.",
    "      --config <path>     Explicit path to .fcformatrc.json (defaults to upward discovery).",
    "  -v, --version           Display the version number.",
    "  -h, --help              Display this help message.",
  ].join("\n");
}

/** Checks whether a file path points to a valid FC source file. */
function isFcFile(path: string): boolean {
  return /\.(?:fcc|fcg)$/iu.test(path);
}

/**
 * Recursively collects all `.fcc` and `.fcg` files within an input path.
 */
async function collectFcFiles(input: string, explicit: boolean): Promise<string[]> {
  const info = await stat(input);
  if (info.isFile()) {
    if (!isFcFile(input)) {
      if (explicit) {
        throw new Error(`unsupported file extension: '${input}'`);
      }
      return [];
    }
    return [resolve(input)];
  }

  if (!info.isDirectory()) return [];

  const entries = await readdir(input, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
        return [];
      }
      return collectFcFiles(join(input, entry.name), false);
    }),
  );

  return nested.flat();
}

/**
 * Reads all text from standard input.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Main CLI execution entry point.
 */
export async function runCli(args: readonly string[]): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed === "help") {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (parsed === "version") {
    process.stdout.write(`${CLI_VERSION}\n`);
    return 0;
  }

  // Pre-load explicit config if provided
  let explicitConfig: FormatOptions | undefined;
  if (parsed.configPath) {
    const raw = JSON.parse(await readFile(parsed.configPath, "utf8"));
    explicitConfig = raw as FormatOptions;
  }

  // 1. Stdin piping mode: format from standard input
  if (parsed.stdinFilepath) {
    const targetFile = resolve(parsed.stdinFilepath);
    const config = explicitConfig ?? (await loadFormatConfig(dirname(targetFile))) ?? {};
    const source = await readStdin();
    const result = formatSource(source, { ...config, fileName: targetFile });

    if (result.code === undefined) {
      process.stderr.write(
        `${parsed.stdinFilepath}: cannot format source (${formatDiagnosticList(parsed.stdinFilepath, result.diagnostics)})\n`,
      );
      return 2;
    }

    if (parsed.diff) {
      const diffText = createUnifiedDiff(parsed.stdinFilepath, source, result.code);
      if (diffText) process.stdout.write(diffText);
    } else if (!parsed.check) {
      process.stdout.write(result.code);
    }

    if (parsed.check && result.changed) {
      return 1;
    }
    return 0;
  }

  // 2. File / Directory mode
  if (!parsed.inputs.length) {
    throw new Error("at least one .fcc/.fcg file or directory is required");
  }

  const startTime = Date.now();
  const fileLists = await Promise.all(parsed.inputs.map((input) => collectFcFiles(input, true)));
  const files = Array.from(new Set(fileLists.flat())).sort();

  if (!files.length) {
    throw new Error("no .fcc or .fcg files found");
  }

  let changedCount = 0;

  for (const file of files) {
    const config = explicitConfig ?? (await loadFormatConfig(dirname(file))) ?? {};
    const source = await readFile(file, "utf8");
    const result = formatSource(source, { ...config, fileName: file });

    if (result.code === undefined) {
      throw new Error(
        `${file}: cannot format source (${formatDiagnosticList(file, result.diagnostics)})`,
      );
    }

    if (!result.changed) continue;

    changedCount += 1;

    if (parsed.diff) {
      const diffText = createUnifiedDiff(file, source, result.code);
      if (diffText) process.stdout.write(diffText);
    }

    if (parsed.check) {
      if (!parsed.diff) {
        process.stdout.write(`${file}\n`);
      }
    } else {
      await writeFile(file, result.code, "utf8");
    }
  }

  const elapsed = Date.now() - startTime;

  if (parsed.check) {
    if (changedCount > 0) {
      return 1;
    }
    return 0;
  }

  return 0;
}

// Direct execution when run via node/npx
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    });
}
