#!/usr/bin/env node
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { extractGraph } from "../graphify/bridge.js";

interface CliOptions {
  inputs: string[];
  out: string | undefined;
  repoRoot: string;
  workspaceRoot: string | undefined;
}

const IGNORED_DIRECTORIES = new Set([".git", "coverage", "dist", "node_modules"]);
const FC_FILE_PATTERN = /\.(?:fcc|fcg)$/iu;

function usage(): string {
  return [
    "Usage: npm run bridge -- [--out <file>] [--repo-root <dir>] [--root <dir>] <file-or-directory> [...]",
    "",
    "Emit graphify extraction JSON (nodes/edges) for FC sources using the",
    "workspace index, binder-visible declarations, and cross-file call resolution.",
    "Defaults to stdout when --out is omitted.",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { inputs: [], out: undefined, repoRoot: process.cwd(), workspaceRoot: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "-h" || argument === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (argument === "--out" || argument === "--repo-root" || argument === "--root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
      if (argument === "--out") options.out = value;
      else if (argument === "--repo-root") options.repoRoot = value;
      else options.workspaceRoot = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--")) throw new Error(`Unknown option '${argument}'.`);
    options.inputs.push(argument);
  }
  return options;
}

async function collectFcFiles(input: string, explicit: boolean): Promise<string[]> {
  const target = resolve(input);
  const entry = await stat(target);
  if (entry.isFile()) {
    if (FC_FILE_PATTERN.test(target)) return [target];
    if (explicit) throw new Error(`Unsupported file extension for '${input}'. Expected .fcc or .fcg.`);
    return [];
  }
  const files: string[] = [];
  for (const name of await readdir(target)) {
    if (IGNORED_DIRECTORIES.has(name)) continue;
    files.push(...await collectFcFiles(join(target, name), false));
  }
  return files;
}

async function main(argv: readonly string[]): Promise<void> {
  const options = parseArgs(argv);
  if (!options.inputs.length) throw new Error(`Missing input. ${usage()}`);
  const files = (await Promise.all(options.inputs.map((input) => collectFcFiles(input, true)))).flat().sort();
  if (!files.length) throw new Error("No .fcc or .fcg files found.");
  const firstInputStat = await stat(resolve(options.inputs[0]!));
  const workspaceRoot = options.workspaceRoot
    ?? (options.inputs.length === 1 && firstInputStat.isDirectory() ? resolve(options.inputs[0]!) : resolve(options.repoRoot));
  const sources = await Promise.all(files.map(async (path) => ({ path, source: await readFile(path, "utf-8") })));
  const { extraction, findings } = extractGraph(sources, { repoRoot: resolve(options.repoRoot), workspaceRoot });
  const payload = `${JSON.stringify(extraction, null, 2)}\n`;
  if (options.out) await writeFile(resolve(options.out), payload, "utf-8");
  else process.stdout.write(payload);
  if (findings.length) {
    const summary = new Map<string, number>();
    for (const finding of findings) summary.set(finding.kind, (summary.get(finding.kind) ?? 0) + 1);
    console.error(`bridge: ${files.length} files, ${extraction.nodes.length} nodes, ${extraction.edges.length} edges`);
    for (const [kind, count] of [...summary.entries()].sort()) console.error(`bridge: finding ${kind}: showing ${count} (capped at 25 per kind)`);
    for (const finding of findings) console.error(`bridge: [${finding.kind}] ${finding.file}: ${finding.detail}`);
  } else {
    console.error(`bridge: ${files.length} files, ${extraction.nodes.length} nodes, ${extraction.edges.length} edges, no findings`);
  }
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
