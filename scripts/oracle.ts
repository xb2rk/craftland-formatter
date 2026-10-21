#!/usr/bin/env node
/** Run the P7 formatter/compiler oracle in a disposable staging tree. */

import { runCompilerOracle } from "../src/oracle.js";

/**
 * Usage text.
 *
 * @returns usage.
 */
function usage(): string {
  return [
    "Usage: npm run oracle -- [options]",
    "",
    "Options:",
    "  --project-root <path>  project containing Assets/ (default: repository root)",
    "  --compiler <path>      fccompile_external.exe override",
    "  --keep-temp            keep the staging copy for inspection",
    "  --json                 print a machine-readable result",
    "  -h, --help             show this help",
  ].join("\n");
}

/**
 * Take a required option value.
 *
 * @param args - argv.
 * @param index - current index (the option itself).
 * @param option - option name.
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

async function main(argv: readonly string[]): Promise<void> {
  let projectRoot: string | undefined;
  let compilerPath: string | undefined;
  let keepTemp = false;
  let json = false;
  for (let index = 2; index < argv.length;) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    if (arg === "--project-root") {
      const taken = takeValue(argv, index, arg);
      projectRoot = taken.value;
      index = taken.next;
      continue;
    }
    if (arg === "--compiler") {
      const taken = takeValue(argv, index, arg);
      compilerPath = taken.value;
      index = taken.next;
      continue;
    }
    if (arg === "--keep-temp") {
      keepTemp = true;
      index += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
      index += 1;
      continue;
    }
    throw new Error(`unknown option '${arg}'`);
  }

  const result = await runCompilerOracle({ projectRoot, compilerPath, keepTemp });
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`compiler: ${result.compilerPath}\n`);
    process.stdout.write(`files: ${result.sourceFiles}\n`);
    process.stdout.write(`formatted in staging: ${result.changedFiles.length}\n`);
    process.stdout.write(`exit code: ${result.exitCode}\n`);
    if (result.stagingRoot) {
      process.stdout.write(`staging: ${result.stagingRoot}\n`);
    }
    if (result.stdout) {
      process.stdout.write(`\n${result.stdout}`);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
  }
  if (result.exitCode !== 0) {
    process.exitCode = 1;
  }
}

void main(process.argv).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
