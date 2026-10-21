#!/usr/bin/env node
/**
 * @module cli/cli - Node CLI adapter; all formatting policy lives in the pure core modules.
 */

import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSource } from "../format/format.js";
import { resolveConfig, type Config } from "../format/config.js";
import { lintSource, type Diagnostic } from "../lint/index.js";

/** CLI version. */
const VERSION = "0.1.0";
/** Supported source extensions. */
const SOURCE_EXTENSIONS = new Set([".fcg", ".fcc"]);
/** Directories skipped during recursive collection. */
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist", "Temp", "Cache", "Libraries"]);

interface CliOptions {
  command: "fmt" | "check" | "lint";
  paths: string[];
  write: boolean;
  stdout: boolean;
  json: boolean;
  configPath?: string;
}

/**
 * Build CLI usage text.
 *
 * @returns usage string.
 */
function usage(): string {
  return [
    "Usage: fc-format-v2 <fmt|check|lint> [options] <file-or-directory ...>",
    "",
    "Commands:",
    "  fmt       format files (writes in place unless --stdout is used)",
    "  check     fail when any selected file is not formatted",
    "  lint      run linter diagnostics",
    "",
    "Options:",
    "  --write          write formatted files (default for fmt)",
    "  --stdout         print formatted stdin/file output instead of writing",
    "  --config <path> read JSON formatter options",
    "  --json           print lint diagnostics as JSON",
    "  -h, --help       show this help",
    "  --version        print the package version",
  ].join("\n");
}

/**
 * Take a value for an option.
 *
 * @param args - argv slice.
 * @param index - index of the option.
 * @param option - option name for errors.
 * @returns value and next index.
 * @throws {Error} when missing.
 */
function takeValue(args: readonly string[], index: number, option: string): { value: string; next: number } {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${option} requires a value`);
  }
  return { value, next: index + 2 };
}

/**
 * Parse CLI arguments.
 *
 * @param argv - full argv.
 * @returns parsed options or sentinel.
 * @throws {Error} when an unknown option is encountered.
 */
function parseArgs(argv: readonly string[]): CliOptions | "help" | "version" {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    return "help";
  }
  if (args.includes("--version")) {
    return "version";
  }

  let command: CliOptions["command"] = "fmt";
  let index = 0;
  if (args[0] === "fmt" || args[0] === "check" || args[0] === "lint") {
    command = args[0];
    index = 1;
  }

  const paths: string[] = [];
  let write = false;
  let stdout = false;
  let json = false;
  let configPath: string | undefined;
  while (index < args.length) {
    const arg = args[index]!;
    if (arg === "--write") {
      write = true;
      index += 1;
    } else if (arg === "--stdout") {
      stdout = true;
      index += 1;
    } else if (arg === "--json") {
      json = true;
      index += 1;
    } else if (arg === "--config") {
      const taken = takeValue(args, index, arg);
      configPath = taken.value;
      index = taken.next;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option '${arg}'`);
    } else {
      paths.push(arg);
      index += 1;
    }
  }
  return { command, paths, write, stdout, json, configPath };
}

/**
 * Collect source files recursively.
 *
 * @param path - file or directory path.
 * @returns sorted file list.
 */
async function collectSourceFiles(path: string): Promise<string[]> {
  const info = await stat(path);
  if (info.isFile()) {
    return SOURCE_EXTENSIONS.has(extname(path).toLowerCase()) ? [path] : [];
  }
  if (!info.isDirectory()) {
    return [];
  }

  const result: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    result.push(...(await collectSourceFiles(resolve(path, entry.name))));
  }
  return result.sort((left, right) => left.localeCompare(right, "en"));
}

/**
 * Load and resolve a config file.
 *
 * @param path - optional config path.
 * @returns resolved config.
 * @throws {Error} when JSON is invalid.
 */
async function readConfig(path: string | undefined): Promise<Config> {
  if (!path) {
    return resolveConfig();
  }
  const raw = await readFile(resolve(path), "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`cannot parse config '${path}': ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`config '${path}' must contain a JSON object`);
  }
  return resolveConfig(parsed as Partial<Config>);
}

/**
 * Read all of stdin.
 *
 * @returns stdin content as string.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Execute formatting (fmt/check).
 *
 * @param options - CLI options.
 * @param config - resolved config.
 */
async function runFormat(options: CliOptions, config: Config): Promise<void> {
  const paths = options.paths.length === 0 ? ["-"] : options.paths;
  const write = options.command === "fmt" && !options.stdout;
  const files = (await Promise.all(paths.filter((path) => path !== "-").map(collectSourceFiles))).flat();
  if (paths.includes("-")) {
    files.push("-");
  }
  if (files.length === 0) {
    throw new Error("no .fcg or .fcc files matched");
  }

  let drift = false;
  for (const file of files) {
    const source = file === "-" ? await readStdin() : await readFile(file, "utf8");
    const formatted = formatSource(source, config);
    if (file === "-") {
      if (options.command === "check") {
        if (formatted !== source) {
          drift = true;
          process.stderr.write("<stdin>\n");
        }
      } else {
        process.stdout.write(formatted);
      }
      continue;
    }
    const changed = formatted !== source;
    if (options.command === "check") {
      if (changed) {
        drift = true;
        process.stderr.write(`${relative(process.cwd(), file)}\n`);
      }
    } else if (write) {
      if (changed) {
        await writeFile(file, formatted, "utf8");
      }
    } else {
      // `fmt --stdout` is a stream operation: emit the formatted document even
      // when it was already canonical. This mirrors stdin behavior and keeps
      // the flag useful in shell pipelines.
      process.stdout.write(formatted);
    }
  }
  if (options.command === "check" && drift) {
    process.exitCode = 1;
  }
}

/**
 * Execute lint.
 *
 * @param options - CLI options.
 * @param config - resolved config.
 */
async function runLint(options: CliOptions, config: Config): Promise<void> {
  const paths = options.paths.length === 0 ? ["-"] : options.paths;
  const files = (await Promise.all(paths.filter((path) => path !== "-").map(collectSourceFiles))).flat();
  if (paths.includes("-")) {
    files.push("-");
  }
  if (files.length === 0) {
    throw new Error("no .fcg or .fcc files matched");
  }

  const reports: Array<{ file: string; diagnostics: Diagnostic[] }> = [];
  let hasErrors = false;
  for (const file of files) {
    const source = file === "-" ? await readStdin() : await readFile(file, "utf8");
    const diagnostics = lintSource(source, config);
    const displayFile = file === "-" ? "<stdin>" : relative(process.cwd(), file);
    reports.push({ file: displayFile, diagnostics });
    hasErrors ||= diagnostics.some((diagnostic) => diagnostic.severity === "error");
    if (!options.json) {
      for (const diagnostic of diagnostics) {
        process.stdout.write(
          `${displayFile}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.severity} ${diagnostic.ruleId}: ${diagnostic.message}\n`,
        );
      }
    }
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
  }
  if (hasErrors) {
    process.exitCode = 1;
  }
}

/** Run the CLI without terminating the host process (friendly to tests/embedders). */
export async function main(argv: string[] = process.argv): Promise<void> {
  process.exitCode = 0;
  const parsed = parseArgs(argv);
  if (parsed === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (parsed === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const config = await readConfig(parsed.configPath);
  if (parsed.command === "lint") {
    await runLint(parsed, config);
  } else {
    await runFormat(parsed, config);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
