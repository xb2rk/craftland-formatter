#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalWorkspacePath, createWorkspaceIndex, lintWorkspace } from "../index.js";
import { lintSource } from "../lint/linter.js";
import { LINT_RULE_IDS, type LintOptions, type LintRuleId, type RuleLevel } from "../lint/contracts.js";

interface CliOptions {
  readonly configPath: string | undefined;
  readonly inputs: readonly string[];
  readonly json: boolean;
  readonly workspace: boolean;
}

const IGNORED_DIRECTORIES = new Set([".git", "coverage", "dist", "node_modules"]);
const RULE_LEVELS = new Set<RuleLevel>(["off", "error", "warning", "information", "hint"]);

function parseArgs(args: readonly string[]): CliOptions | "help" {
  let configPath: string | undefined;
  let json = false;
  let workspace = false;
  const inputs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === "-h" || arg === "--help") return "help";
    if (arg === "--json") { json = true; continue; }
    if (arg === "--workspace") { workspace = true; continue; }
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
  return { configPath, inputs, json, workspace };
}

function usage(): string {
  return [
    "Usage: npm run lint -- [--json] [--workspace] [--config .fclintrc.json] <file-or-directory> [...]",
    "",
    "Analyzes .fcc and .fcg files without changing them. Directories are searched recursively.",
    "--workspace enables cross-file import and platform diagnostics for one directory root.",
    "Diagnostics use stable fc/* rule IDs; malformed input is reported as fc/parse.",
  ].join("\n");
}

async function main(args: readonly string[]): Promise<void> {
  const options = parseArgs(args);
  if (options === "help") { process.stdout.write(`${usage()}\n`); return; }
  if (!options.inputs.length) throw new Error("at least one .fcc/.fcg file or directory is required");
  let workspaceRoot: string | undefined;
  if (options.workspace) {
    if (options.inputs.length !== 1) throw new Error("--workspace requires exactly one directory root");
    const root = options.inputs[0]!;
    const rootInfo = await stat(root);
    if (!rootInfo.isDirectory()) throw new Error("--workspace requires a directory root");
    workspaceRoot = root;
  }
  const config = options.configPath ? await readConfig(options.configPath) : {};
  const files = (await Promise.all(options.inputs.map((input) => collectFcFiles(input, true)))).flat().sort();
  if (!files.length) throw new Error("no .fcc or .fcg files found");
  const sources = await Promise.all(files.map(async (file) => ({ path: file, source: await readFile(file, "utf8") })));
  const results = sources.map(({ path, source }) => ({
    file: workspaceRoot ? canonicalWorkspacePath(workspaceRoot, resolve(path)) : path,
    result: lintSource(source, { ...config, fileName: path }),
  }));
  const diagnostics = results.flatMap(({ file, result }) => result.diagnostics.map((diagnostic) => ({ diagnostic, file })));
  if (options.workspace) {
    const index = createWorkspaceIndex(
      sources.map(({ path, source }) => ({ path: resolve(path), source })),
      { root: workspaceRoot! },
    );
    diagnostics.push(...lintWorkspace(index, { rules: config.rules, suppressions: config.suppressions }).diagnostics
      .map((diagnostic) => ({ diagnostic, file: diagnostic.file })));
  }
  diagnostics.sort((left, right) => left.file.localeCompare(right.file, "en")
    || left.diagnostic.range.start.offset - right.diagnostic.range.start.offset
    || left.diagnostic.ruleId.localeCompare(right.diagnostic.ruleId, "en"));
  if (options.json) {
    process.stdout.write(`${JSON.stringify(diagnostics.map(({ file, diagnostic }) => ({
      file,
      code: diagnostic.ruleId,
      message: diagnostic.message,
      severity: diagnostic.severity,
      range: diagnostic.range,
    })), null, 2)}\n`);
  } else {
    for (const { file, diagnostic } of diagnostics) {
      process.stdout.write(`${file}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.column + 1} ${diagnostic.severity} ${diagnostic.ruleId} ${diagnostic.message}\n`);
    }
  }
  if (diagnostics.length) process.exitCode = 1;
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

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isRuleLevel(value: unknown): value is RuleLevel {
  return typeof value === "string" && (RULE_LEVELS as ReadonlySet<string>).has(value);
}

async function readConfig(path: string): Promise<LintOptions> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isJsonObject(value)) throw new Error(`${path}: configuration must be a JSON object`);
  const record = value;
  const allowed = new Set(["ignoredOutVariables", "suppressions", "rules"]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`${path}: unsupported lint setting '${key}'`);
  const ignoredOutVariables = record.ignoredOutVariables;
  if (ignoredOutVariables !== undefined && typeof ignoredOutVariables !== "boolean") throw new Error(`${path}: ignoredOutVariables must be boolean`);
  const suppressions = record.suppressions;
  if (suppressions !== undefined && typeof suppressions !== "boolean") throw new Error(`${path}: suppressions must be boolean`);
  const rules: Partial<Record<LintRuleId, RuleLevel>> = {};
  if (record.rules !== undefined) {
    if (!isJsonObject(record.rules)) throw new Error(`${path}: rules must be an object`);
    for (const [id, level] of Object.entries(record.rules)) {
      if (!(LINT_RULE_IDS as readonly string[]).includes(id)) throw new Error(`${path}: unknown lint rule '${id}'`);
      if (!isRuleLevel(level)) throw new Error(`${path}: invalid severity for '${id}'`);
      rules[id as LintRuleId] = level;
    }
  }
  return { ignoredOutVariables, rules, suppressions };
}

function isFcFile(path: string): boolean { return /\.(?:fcc|fcg)$/iu.test(path); }

void main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
