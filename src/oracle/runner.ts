import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { formatSource } from "../format/formatter.js";

const execFileAsync = promisify(execFile);
const SOURCE_EXTENSIONS = new Set([".fcc", ".fcg"]);
const COMPILER_RELATIVE_PATH = [
  "Programs",
  "Craftland Studio",
  "resources",
  "LocalData",
  "Utilities",
  "UGCLanguage",
  "release",
  "fccompile_external.exe",
] as const;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface BaselineOracleOptions {
  projectRoot?: string;
  compilerPath?: string;
  keepTemp?: boolean;
  /** Format the staged FC sources before invoking the compiler. */
  format?: boolean;
}

export interface BaselineOracleResult {
  compilerPath: string;
  exitCode: number;
  sourceFiles: number;
  stagingRoot?: string;
  stderr: string;
  stdout: string;
}

export function defaultCompilerPath(): string {
  if (process.env.FC_COMPILER) {
    return process.env.FC_COMPILER;
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    throw new Error("FC_COMPILER or LOCALAPPDATA must be set to locate the FC compiler");
  }
  return join(localAppData, ...COMPILER_RELATIVE_PATH);
}

export function defaultProjectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(path)));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

interface ExecFailure {
  readonly code?: unknown;
  readonly stderr?: unknown;
  readonly stdout?: unknown;
}

function asExecFailure(error: unknown): ExecFailure {
  return !!error && typeof error === "object" ? (error as ExecFailure) : {};
}

function commandOutput(error: unknown, field: "stdout" | "stderr"): string {
  const value = asExecFailure(error)[field];
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Buffer) {
    return value.toString("utf8");
  }
  return "";
}

function commandExitCode(error: unknown): number {
  const code = asExecFailure(error).code;
  return typeof code === "number" ? code : 1;
}

/**
 * Compile a temporary copy of the project, optionally formatting only the
 * staged FC sources. The source project remains read-only throughout.
 *
 * The baseline proves the compiler invocation and staging boundary before the
 * formatter exists. The source project remains read-only throughout the run.
 */
export async function runBaselineCompilerOracle(
  options: BaselineOracleOptions = {},
): Promise<BaselineOracleResult> {
  const projectRoot = resolve(options.projectRoot ?? defaultProjectRoot());
  const compilerPath = resolve(options.compilerPath ?? defaultCompilerPath());
  const assetsPath = join(projectRoot, "Assets");
  const editorGenPath = join(projectRoot, "Temp", "UGCLanguage", "editorGen");

  if (!(await stat(compilerPath).catch(() => undefined))?.isFile()) {
    throw new Error(`FC compiler not found: ${compilerPath}`);
  }
  if (!(await stat(assetsPath).catch(() => undefined))?.isDirectory()) {
    throw new Error(`Assets directory not found: ${assetsPath}`);
  }
  if (!(await stat(editorGenPath).catch(() => undefined))?.isDirectory()) {
    throw new Error(`editorGen directory not found: ${editorGenPath}`);
  }

  const stagingRoot = await mkdtemp(join(tmpdir(), "fc-format-oracle-"));
  const keepTemp = options.keepTemp === true;
  try {
    await cp(assetsPath, join(stagingRoot, "Assets"), { recursive: true });
    await cp(editorGenPath, join(stagingRoot, "Temp", "UGCLanguage", "editorGen"), { recursive: true });
    const sourceFiles = await collectSourceFiles(join(stagingRoot, "Assets"));
    if (options.format) {
      for (const file of sourceFiles) {
        const source = await readFile(file, "utf8");
        const formatted = formatSource(source, { fileName: file });
        if (!formatted.code) throw new Error(`Formatter refused staged source: ${file}`);
        await writeFile(file, formatted.code, "utf8");
      }
    }
    const args = [
      "-i",
      "Assets",
      "-e",
      "Temp/UGCLanguage/editorGen",
      "-s",
      "Temp/UGCLanguage/editorGen/EditorGenSymbol.json",
      "-o",
      "Temp/UGCLanguage/compiled",
    ];

    try {
      const result = await execFileAsync(compilerPath, args, {
        cwd: stagingRoot,
        windowsHide: true,
        maxBuffer: MAX_OUTPUT_BYTES,
      });
      return {
        compilerPath,
        exitCode: 0,
        sourceFiles: sourceFiles.length,
        stagingRoot: keepTemp ? stagingRoot : undefined,
        stderr: String(result.stderr),
        stdout: String(result.stdout),
      };
    } catch (error) {
      return {
        compilerPath,
        exitCode: commandExitCode(error),
        sourceFiles: sourceFiles.length,
        stagingRoot: keepTemp ? stagingRoot : undefined,
        stderr: commandOutput(error, "stderr"),
        stdout: commandOutput(error, "stdout"),
      };
    }
  } finally {
    if (!keepTemp) {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }
}
