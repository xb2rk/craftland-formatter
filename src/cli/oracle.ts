/**
 * @module cli/oracle - compiler-oracle runner used by P7 verification and CI.
 */

import { cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, extname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { formatSource } from "../format/format.js";

const execFileAsync = promisify(execFile);
/** Source extensions accepted by the oracle. */
const SOURCE_EXTENSIONS = new Set([".fcg", ".fcc"]);
/** Relative path to the compiler from LOCALAPPDATA. */
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
/** Max buffer for compiler output (64 MiB). Duplicated from constants to avoid circular import in CLI. */
const ORACLE_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export interface OracleOptions {
  /** Project containing `Assets/` and `Temp/UGCLanguage/editorGen/`. */
  projectRoot?: string;
  /** Explicit compiler executable; defaults to the installed Craftland path. */
  compilerPath?: string;
  /** Keep the staging directory for post-failure inspection. */
  keepTemp?: boolean;
}

export interface OracleResult {
  compilerPath: string;
  stagingRoot?: string;
  sourceFiles: number;
  changedFiles: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Resolve the compiler path: `FC_COMPILER` env override, then LOCALAPPDATA, then fallback.
 *
 * @returns compiler path.
 */
export function defaultCompilerPath(): string {
  const configured = process.env.FC_COMPILER;
  if (configured) {
    return configured;
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    return join(localAppData, ...COMPILER_RELATIVE_PATH);
  }
  // Keep a useful Windows fallback for shells that do not expose LOCALAPPDATA.
  return join("C:\\Users", process.env.USERNAME ?? "N0BODY", "AppData", "Local", ...COMPILER_RELATIVE_PATH);
}

/**
 * Resolve the project root (three levels above built oracle module).
 *
 * @returns project root path.
 */
function defaultProjectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/**
 * Recursively collect `.fcg`/`.fcc` files under a directory (sorted).
 *
 * @param directory - root to search.
 * @returns sorted file list.
 */
async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(path)));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

/**
 * Extract stdout/stderr from a failed execFile error.
 *
 * @param error - thrown error.
 * @param field - stdout or stderr.
 * @returns output string.
 */
function errorOutput(error: unknown, field: "stdout" | "stderr"): string {
  const value = error as { [key: string]: unknown };
  const output = value[field];
  if (typeof output === "string") {
    return output;
  }
  if (output instanceof Buffer) {
    return output.toString("utf8");
  }
  return "";
}

/**
 * Extract exit code from a failed execFile error.
 *
 * @param error - thrown error.
 * @returns exit code (default 1).
 */
function errorCode(error: unknown): number {
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : 1;
}

/**
 * Format a disposable project copy and run Craftland's compiler against it.
 * The caller owns no files in the project tree: all writes happen below the
 * generated temporary staging directory.
 */
export async function runCompilerOracle(options: OracleOptions = {}): Promise<OracleResult> {
  const projectRoot = resolve(options.projectRoot ?? defaultProjectRoot());
  const compilerPath = resolve(options.compilerPath ?? defaultCompilerPath());
  const sourceAssets = join(projectRoot, "Assets");
  const sourceEditorGen = join(projectRoot, "Temp", "UGCLanguage", "editorGen");
  const compilerInfo = await stat(compilerPath).catch(() => undefined);
  if (!compilerInfo?.isFile()) {
    throw new Error(`FC compiler not found: ${compilerPath}`);
  }
  const assetsInfo = await stat(sourceAssets).catch(() => undefined);
  if (!assetsInfo?.isDirectory()) {
    throw new Error(`project Assets directory not found: ${sourceAssets}`);
  }
  const editorGenInfo = await stat(sourceEditorGen).catch(() => undefined);
  if (!editorGenInfo?.isDirectory()) {
    throw new Error(`editorGen directory not found: ${sourceEditorGen}`);
  }

  const stagingRoot = await mkdtemp(join(tmpdir(), "fc-format-v2-oracle-"));
  let preserve = options.keepTemp === true;
  try {
    await cp(sourceAssets, join(stagingRoot, "Assets"), { recursive: true });
    await cp(sourceEditorGen, join(stagingRoot, "Temp", "UGCLanguage", "editorGen"), { recursive: true });

    const stagedFiles = await collectSourceFiles(join(stagingRoot, "Assets"));
    const changedFiles: string[] = [];
    for (const path of stagedFiles) {
      const source = await readFile(path, "utf8");
      const formatted = formatSource(source);
      if (formatted !== source) {
        changedFiles.push(relative(stagingRoot, path));
      }
      await writeFile(path, formatted, "utf8");
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
    let exitCode = 0;
    let stdout = "";
    let stderr = "";
    try {
      const result = await execFileAsync(compilerPath, args, {
        cwd: stagingRoot,
        windowsHide: true,
        maxBuffer: ORACLE_MAX_BUFFER_BYTES,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      exitCode = errorCode(error);
      stdout = errorOutput(error, "stdout");
      stderr = errorOutput(error, "stderr");
    }
    return {
      compilerPath,
      stagingRoot: preserve ? stagingRoot : undefined,
      sourceFiles: stagedFiles.length,
      changedFiles,
      exitCode,
      stdout,
      stderr,
    };
  } catch (error) {
    preserve = false;
    throw error;
  } finally {
    if (!preserve) {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }
}
