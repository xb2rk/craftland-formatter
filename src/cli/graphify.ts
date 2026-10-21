#!/usr/bin/env node
/**
 * One-command hybrid graph rebuild: AST bridge -> merge -> graphify rebuild.
 *
 * Usage: npm run graphify -- [--repo <dir>] [--out <dir>] [--scope <dir>]
 *
 * Defaults: --repo = git toplevel (fallback: two levels above this package),
 * --out = <repo>/graphify-out, --scope = <repo>/Assets/Scripts.
 *
 * Step 1 runs in-process via the bridge. Steps 2-3 shell out to the python
 * helper scripts in scripts/graphify/, using GRAPHIFY_PYTHON when set,
 * otherwise "python" (must have the `graphify` package installed).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractGraph } from "../graphify/bridge.js";

const PACKAGE_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SCRIPTS_DIR = join(PACKAGE_DIR, "scripts", "graphify");
const FC_FILE_PATTERN = /\.(?:fcc|fcg)$/iu;
const IGNORED_DIRECTORIES = new Set([".git", "coverage", "dist", "node_modules"]);

function defaultRepo(): string {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim();
    if (top) return top;
  } catch {
    // Fall through to the package-relative layout: tools/fc-format-v3 -> repo root.
  }
  return dirname(dirname(PACKAGE_DIR));
}

function parseArgs(argv: readonly string[]): { repo: string; out: string; scope: string } {
  const repo = defaultRepo();
  const options = { repo, out: join(repo, "graphify-out"), scope: join(repo, "Assets", "Scripts") };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "-h" || argument === "--help") {
      console.log("Usage: npm run graphify -- [--repo <dir>] [--out <dir>] [--scope <dir>]");
      process.exit(0);
    }
    if (argument === "--repo" || argument === "--out" || argument === "--scope") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
      if (argument === "--repo") options.repo = value;
      else if (argument === "--out") options.out = value;
      else options.scope = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option '${argument}'.`);
  }
  return { repo: resolve(options.repo), out: resolve(options.out), scope: resolve(options.scope) };
}

async function collectFcFiles(input: string, explicit: boolean): Promise<string[]> {
  const entry = await stat(input);
  if (entry.isFile()) {
    if (FC_FILE_PATTERN.test(input)) return [input];
    if (explicit) throw new Error(`Unsupported file extension for '${input}'. Expected .fcc or .fcg.`);
    return [];
  }
  const files: string[] = [];
  for (const name of await readdir(input)) {
    if (IGNORED_DIRECTORIES.has(name)) continue;
    files.push(...await collectFcFiles(join(input, name), false));
  }
  return files;
}

function runPython(script: string, args: readonly string[]): void {
  const python = process.env["GRAPHIFY_PYTHON"] ?? "python";
  const preflight = spawnSync(python, ["-c", "import graphify"], { encoding: "utf-8" });
  if (preflight.status !== 0) {
    throw new Error(
      `'${python}' has no 'graphify' package. Install it (pip install graphifyy) ` +
        "or point GRAPHIFY_PYTHON at a python that has it. See scripts/graphify/README.md.",
    );
  }
  const result = spawnSync(python, [script, ...args], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Script failed: ${script} (exit ${result.status}).`);
}

async function main(argv: readonly string[]): Promise<void> {
  const { repo, out, scope } = parseArgs(argv);
  console.error(`graphify: repo=${repo}`);
  console.error(`graphify: scope=${scope}`);
  console.error(`graphify: out=${out}`);

  console.error("graphify: step 1/3 - AST bridge extraction");
  const files = (await collectFcFiles(scope, true)).sort();
  if (!files.length) throw new Error(`No .fcc or .fcg files found under '${scope}'.`);
  const sources = await Promise.all(files.map(async (path) => ({ path, source: await readFile(path, "utf-8") })));
  const { extraction, findings } = extractGraph(sources, { repoRoot: repo, workspaceRoot: scope });
  await writeFile(join(out, ".graphify_ast.json"), `${JSON.stringify(extraction, null, 2)}\n`, "utf-8");
  console.error(`graphify: ${files.length} files, ${extraction.nodes.length} nodes, ${extraction.edges.length} edges, ${findings.length} findings`);

  console.error("graphify: step 2/3 - merge AST with semantic nodes");
  runPython(join(SCRIPTS_DIR, "merge_ast.py"), ["--repo", repo, "--out", out]);

  console.error("graphify: step 3/3 - graphify rebuild");
  runPython(join(SCRIPTS_DIR, "rebuild.py"), ["--repo", repo, "--out", out]);
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
