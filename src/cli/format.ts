#!/usr/bin/env node
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../format/formatter.js";
import { formatDiagnosticList } from "./diagnostics.js";
import type { FormatOptions } from "../format/options.js";

interface CliOptions {
  readonly check: boolean;
  readonly configPath: string | undefined;
  readonly inputs: readonly string[];
}

const CONFIG_KEYS = new Set<keyof Omit<FormatOptions, "fileName" | "fileKind">>([
  "printWidth", "tabWidth", "useTabs", "spaceAroundOperators", "spaceAfterComma", "wrapCalls", "wrapCollections", "collapseBlankLines", "insertFinalNewline",
]);
const IGNORED_DIRECTORIES = new Set([".git", "coverage", "dist", "node_modules"]);

function parseArgs(args: readonly string[]): CliOptions | "help" {
  let check = false;
  let configPath: string | undefined;
  const inputs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === "-h" || arg === "--help") return "help";
    if (arg === "--check") { check = true; continue; }
    if (arg === "--config") {
      const next = args[index + 1];
      if (!next || next.startsWith("-")) throw new Error("--config requires a JSON file path");
      configPath = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`unknown option '${arg}'`);
    inputs.push(arg);
  }
  return { check, configPath, inputs };
}

function usage(): string {
  return [
    "Usage: npm run format -- [--check] [--config .fcformatrc.json] <file-or-directory> [...]",
    "",
    "Formats .fcc and .fcg files in place. Directories are searched recursively.",
    "--check prints files that would change and exits with status 1.",
  ].join("\n");
}

async function main(args: readonly string[]): Promise<void> {
  const options = parseArgs(args);
  if (options === "help") { process.stdout.write(`${usage()}\n`); return; }
  if (!options.inputs.length) throw new Error("at least one .fcc/.fcg file or directory is required");
  const config = options.configPath ? await readConfig(options.configPath) : {};
  const files = (await Promise.all(options.inputs.map((input) => collectFcFiles(input, true)))).flat().sort();
  if (!files.length) throw new Error("no .fcc or .fcg files found");
  let changed = false;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const result = formatSource(source, { ...config, fileName: file });
    if (result.code === undefined) throw new Error(`${file}: cannot format source (${formatDiagnosticList(file, result.diagnostics)})`);
    if (!result.changed) continue;
    changed = true;
    if (options.check) process.stdout.write(`${file}\n`);
    else await writeFile(file, result.code, "utf8");
  }
  if (options.check && changed) process.exitCode = 1;
}

async function collectFcFiles(input: string, explicit: boolean): Promise<string[]> {
  const info = await stat(input);
  if (info.isFile()) {
    if (!isFcFile(input)) {
      if (explicit) throw new Error(`unsupported file extension: '${input}'`);
      return [];
    }
    return [input];
  }
  if (!info.isDirectory()) return [];
  const entries = await readdir(input, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) return [];
    return collectFcFiles(join(input, entry.name), false);
  }));
  return nested.flat();
}

async function readConfig(path: string): Promise<FormatOptions> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path}: configuration must be a JSON object`);
  for (const key of Object.keys(value)) if (!CONFIG_KEYS.has(key as keyof Omit<FormatOptions, "fileName" | "fileKind">)) throw new Error(`${path}: unsupported formatter setting '${key}'`);
  return value as FormatOptions;
}

function isFcFile(path: string): boolean { return /\.(?:fcc|fcg)$/iu.test(path); }

void main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
