#!/usr/bin/env node

import { runBaselineCompilerOracle } from "../oracle/runner.js";


/**
 * The options for the command-line interface.
 *
 * @interface CommandOptions
 * @typedef {CommandOptions}
 */
interface CommandOptions {
  compilerPath?: string;
  json: boolean;
  keepTemp: boolean;
  projectRoot?: string;
  format: boolean;
}


/**
 * Returns the usage string for the command-line interface.
 *
 * @returns {string} 
 */
function usage(): string {
  return [
    "Usage: npm run oracle -- [options]",
    "",
    "Compiles a temporary copy of the FC project (optionally formatted).",
    "",
    "Options:",
    "  --project-root <path>  Project containing Assets/ (default: repository root)",
    "  --compiler <path>      fccompile_external.exe override",
    "  --keep-temp            Preserve the staging directory for inspection",
    "  --format               Format staged FC sources before compiling",
    "  --json                 Print a machine-readable result",
    "  -h, --help             Show this help",
  ].join("\n");
}

/**
 * Takes a value from the command-line arguments.
 * And returns the next index and the value.
 * 
 * @param args - The command-line arguments.
 * @param index - The current index in the arguments.
 * @param option - The option name for error reporting.
 * @returns - An object containing the next index and the value.
 */
function takeValue(args: readonly string[], index: number, option: string): { next: number; value: string } {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${option} requires a value`);
  }
  return { next: index + 2, value };
}


/**
 * Parses the command-line arguments and returns the options.
 *
 * @param {readonly string[]} args - List of command-line arguments.
 * @returns {(CommandOptions | "help")} - The parsed options or "help" if help was requested.
 */
function parseArgs(args: readonly string[]): CommandOptions | "help" {
  const options: CommandOptions = { format: false, json: false, keepTemp: false };
  for (let index = 0; index < args.length;) {
    const arg = args[index]!;
    if (arg === "--help" || arg === "-h") {
      return "help";
    }
    if (arg === "--project-root") {
      const taken = takeValue(args, index, arg);
      options.projectRoot = taken.value;
      index = taken.next;
      continue;
    }
    if (arg === "--compiler") {
      const taken = takeValue(args, index, arg);
      options.compilerPath = taken.value;
      index = taken.next;
      continue;
    }
    if (arg === "--keep-temp") {
      options.keepTemp = true;
      index += 1;
      continue;
    }
    if (arg === "--format") {
      options.format = true;
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      index += 1;
      continue;
    }
    throw new Error(`unknown option '${arg}'`);
  }
  return options;
}

async function main(args: readonly string[]): Promise<void> {
  const options = parseArgs(args);

  // If the user requested help, print the usage and exit.
  if (options === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  // Run the baseline compiler oracle with the parsed options.
  const result = await runBaselineCompilerOracle(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`compiler: ${result.compilerPath}\n`);
    process.stdout.write(`files: ${result.sourceFiles}\n`);
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
    process.exitCode = result.exitCode;
  }
}

// Run the main function with the command-line arguments, and handle any errors.
void main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
