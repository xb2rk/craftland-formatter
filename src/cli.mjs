import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

import { FormatCache } from "./cache.mjs";
import { CONFIG_NAME, resolveConfig } from "./config.mjs";
import { ConfigError, defaultLeaves, nestLeaves, OPTIONS, validateLeaf } from "./config-registry.mjs";
import { unifiedDiff } from "./diff.mjs";
import { formatConfiguredSource } from "./service.mjs";

const KINDS = new Set([".fcg", ".fcc"]);
const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules", "dist", "cache"]);
const CLI_OPTIONS = new Map(OPTIONS.map((option) => [option.cli, option]));
const PATH_OPTIONS = new Map([
  ["--config", "configPath"],
  ["--stdin-filepath", "stdinPath"],
  ["--explain-config", "explainPath"],
  ["--cache-location", "cacheLocation"],
]);

/**
 * Standard POSIX-compliant exit status codes for CLI execution:
 * - 0 (EXIT_SUCCESS): Execution finished successfully, or `--check` verified code is clean.
 * - 1 (EXIT_CHECK_DIFF_FOUND): Formatting differences detected in `--check` mode.
 * - 2 (EXIT_ERROR): Operational, syntactic, configuration, or I/O failure.
 */
export const EXIT_SUCCESS = 0;
export const EXIT_CHECK_DIFF_FOUND = 1;
export const EXIT_ERROR = 2;

/** The public help uses the same registry as validation and schema generation. */
export function helpText() {
  const settings = OPTIONS.map((option) =>
    `  ${option.cli}${option.type === "boolean" ? "" : " VALUE"}  ${option.description}`);

  return [
    "Usage: fcfmt [mode] [options] FILE...",
    "       fcfmt --stdin-filepath PATH < source.fcg",
    "       fcfmt --explain-config FILE",
    "       fcfmt --init [--config PATH]",
    "",
    "Modes: --check, --diff, --check --diff, --write",
    "Without a mode, exactly one file is formatted to stdout.",
    "--write is the only format mode that changes source files.",
    "",
    "Options:",
    "  --config PATH  Select a JSON project config.",
    "  --no-final-newline  Disable the final newline.",
    "  --cache  Enable format caching to skip unchanged files.",
    "  --cache-location PATH  Path to cache file (implies --cache).",
    "  --cache-strategy STRATEGY  Validation strategy: metadata or content (default: metadata).",
    ...settings,
    "  --help  Show this help.",
    "  --version  Show the formatter version.",
    "",
  ].join("\n");
}

function takeValue(argv, index, inline, flag) {
  if (inline !== undefined) {
    return { value: inline, next: index };
  }

  if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
    throw new ConfigError(`${flag} requires a value`);
  }

  return { value: argv[index + 1], next: index + 1 };
}

export function parseArgs(argv) {
  const parsed = { paths: [], cliLeaves: {}, check: false, diff: false, write: false };
  let literalPaths = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (literalPaths || !argument.startsWith("--")) {
      parsed.paths.push(argument);
      continue;
    }

    if (argument === "--") {
      literalPaths = true;
      continue;
    }

    const equals = argument.indexOf("=");
    const flag = equals < 0 ? argument : argument.slice(0, equals);
    const inline = equals < 0 ? undefined : argument.slice(equals + 1);

    if (["--help", "--version", "--check", "--diff", "--write", "--init", "--no-final-newline", "--cache", "--color", "--no-color"].includes(flag)) {
      if (inline !== undefined) {
        throw new ConfigError(`${flag} does not accept a value`);
      }

      if (flag === "--no-final-newline") {
        parsed.cliLeaves.finalNewline = false;
      } else if (flag === "--cache") {
        parsed.cache = true;
      } else if (flag === "--color") {
        parsed.color = true;
      } else if (flag === "--no-color") {
        parsed.color = false;
      } else {
        parsed[flag.slice(2)] = true;
      }

      continue;
    }

    if (flag === "--cache-strategy") {
      const { value, next } = takeValue(argv, index, inline, flag);

      if (value !== "metadata" && value !== "content") {
        throw new ConfigError("--cache-strategy must be 'metadata' or 'content'");
      }

      parsed.cacheStrategy = value;
      index = next;
      continue;
    }

    if (PATH_OPTIONS.has(flag)) {
      const { value, next } = takeValue(argv, index, inline, flag);

      parsed[PATH_OPTIONS.get(flag)] = value;
      index = next;
      continue;
    }

    const option = CLI_OPTIONS.get(flag);

    if (!option) {
      throw new ConfigError(`unknown option ${flag}`);
    }

    const supplied = option.type === "boolean" && inline === undefined
      ? { value: "true", next: index }
      : takeValue(argv, index, inline, flag);
    let value = supplied.value;

    if (option.type === "integer") {
      value = Number(value);
    } else if (option.type === "boolean" && (value === "true" || value === "false")) {
      value = value === "true";
    }

    parsed.cliLeaves[option.path] = validateLeaf(option.path, value, flag);
    index = supplied.next;
  }

  if (parsed.help || parsed.version) {
    return parsed;
  }

  if (parsed.cacheLocation) {
    parsed.cache = true;
  }

  if (parsed.cache && (parsed.stdinPath || parsed.explainPath || parsed.init)) {
    throw new ConfigError("--cache cannot be combined with --stdin-filepath, --init, or --explain-config");
  }

  if (parsed.write && (parsed.check || parsed.diff)) {
    throw new ConfigError("--write cannot be combined with --check or --diff");
  }

  if (parsed.init && (parsed.paths.length || parsed.stdinPath || parsed.explainPath || parsed.write || parsed.check || parsed.diff)) {
    throw new ConfigError("--init accepts only --config and style overrides");
  }

  if (parsed.explainPath && (parsed.paths.length || parsed.stdinPath || parsed.write || parsed.check || parsed.diff || parsed.init)) {
    throw new ConfigError("--explain-config cannot be combined with format modes or input paths");
  }

  if (parsed.stdinPath && (parsed.paths.length || parsed.write || parsed.check || parsed.diff || parsed.init)) {
    throw new ConfigError("--stdin-filepath is a single stdout input");
  }

  if (!parsed.init && !parsed.explainPath && !parsed.stdinPath && parsed.paths.length === 0) {
    throw new ConfigError("a file path is required");
  }

  if (!parsed.init && !parsed.explainPath && !parsed.stdinPath &&
      !parsed.write && !parsed.check && !parsed.diff && parsed.paths.length !== 1) {
    throw new ConfigError("stdout mode accepts exactly one file");
  }

  return parsed;
}

/** Reject symlinks so discovery and writes cannot escape through a link. */
export function discoverFiles(inputs, recursive) {
  const files = new Set();

  function visit(path, explicit) {
    const info = fs.lstatSync(path);

    if (info.isSymbolicLink()) {
      if (explicit) {
        throw new ConfigError(`${path}: symbolic-link input is not supported`);
      }

      return;
    }

    if (info.isDirectory()) {
      if (!recursive) {
        throw new ConfigError(`${path}: directory input requires --check, --diff, or --write`);
      }

      for (const name of fs.readdirSync(path).sort()) {
        if (EXCLUDED_DIRECTORIES.has(name.toLowerCase())) {
          continue;
        }

        visit(join(path, name), false);
      }

      return;
    }

    if (!info.isFile()) {
      throw new ConfigError(`${path}: expected a regular file`);
    }

    if (KINDS.has(extname(path).toLowerCase())) {
      files.add(resolve(path));
    } else if (explicit) {
      throw new ConfigError(`${path}: expected a .fcg or .fcc file`);
    }
  }

  for (const input of inputs) {
    visit(resolve(input), true);
  }

  return [...files].sort();
}

function decodeUtf8(bytes, path) {
  const source = bytes.toString("utf8");

  if (!Buffer.from(source, "utf8").equals(bytes)) {
    throw new ConfigError(`${path}: invalid UTF-8`);
  }

  return source;
}

function formatPlan(path, parsed, inputBytes) {
  const config = resolveConfig(path, { configPath: parsed.configPath, cliLeaves: nestLeaves(parsed.cliLeaves) });

  if (config.ignored) {
    return { path, ignored: true };
  }

  const bytes = inputBytes ?? fs.readFileSync(path);
  const original = decodeUtf8(bytes, path);
  const result = formatConfiguredSource(original, path, { resolvedConfig: config });

  if (result.output === null) {
    const diagnostic = result.diagnostics[0];
    throw new ConfigError(`${path}:${diagnostic?.line ?? 1}:${(diagnostic?.column ?? 0) + 1}: ` +
      `${diagnostic?.code ?? "format-error"}: ${diagnostic?.message ?? "Unable to format file"}`);
  }

  return { path, bytes, original, output: result.output, changed: result.output !== original };
}

/**
 * Replace a single file using a sibling temporary file. The caller preflights
 * the entire batch; this function also refuses to overwrite concurrent edits.
 */
export function commitFile(plan, io = fs) {
  const current = io.readFileSync(plan.path);
  const info = io.lstatSync(plan.path);

  if (!info.isFile() || info.isSymbolicLink() || !current.equals(plan.bytes)) {
    throw new ConfigError(`${plan.path}: file changed after preflight; not overwritten`);
  }

  const temporary = join(dirname(plan.path), `.${basename(plan.path)}.${randomUUID()}.fcfmt-tmp`);
  let handle;

  try {
    handle = io.openSync(temporary, "wx", info.mode);
    io.writeFileSync(handle, Buffer.from(plan.output, "utf8"));
    io.fchmodSync(handle, info.mode);
    io.fsyncSync(handle);
    io.closeSync(handle);
    handle = undefined;
    io.renameSync(temporary, plan.path);
  } finally {
    if (handle !== undefined) {
      io.closeSync(handle);
    }

    if (io.existsSync(temporary)) {
      io.unlinkSync(temporary);
    }
  }
}

async function stdinBytes() {
  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function initConfig(parsed) {
  const path = resolve(parsed.configPath ?? join(process.cwd(), CONFIG_NAME));
  const defaults = defaultLeaves();
  const example = nestLeaves({
    printWidth: defaults.printWidth,
    "indent.style": defaults["indent.style"],
    "indent.size": defaults["indent.size"],
    ...parsed.cliLeaves,
  });

  fs.writeFileSync(path, JSON.stringify(example, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(`Created ${path}\n`);
}

/** Return the documented 0/1/2 exit status; never call process.exit here. */
export async function runCli(argv) {
  try {
    const parsed = parseArgs(argv);

    if (parsed.version) {
      const metadata = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
      process.stdout.write(metadata.version + "\n");
      return EXIT_SUCCESS;
    }

    if (parsed.help) {
      process.stdout.write(helpText());
      return EXIT_SUCCESS;
    }

    if (parsed.init) {
      initConfig(parsed);
      return EXIT_SUCCESS;
    }

    if (parsed.explainPath) {
      const config = resolveConfig(parsed.explainPath, {
        configPath: parsed.configPath,
        cliLeaves: nestLeaves(parsed.cliLeaves),
      });
      process.stdout.write(JSON.stringify(config, null, 2) + "\n");
      return EXIT_SUCCESS;
    }

    if (parsed.stdinPath) {
      const plan = formatPlan(resolve(parsed.stdinPath), parsed, await stdinBytes());

      if (plan.ignored) {
        throw new ConfigError(`${parsed.stdinPath}: file is ignored`);
      }

      process.stdout.write(plan.output);
      return EXIT_SUCCESS;
    }

    let cache = null;

    if (parsed.cache) {
      const cachePath = resolve(parsed.cacheLocation ?? join(process.cwd(), ".fcfmtcache"));
      cache = FormatCache.load(cachePath, { strategy: parsed.cacheStrategy ?? "metadata" });
    }

    const paths = discoverFiles(parsed.paths, parsed.check || parsed.diff || parsed.write);
    const plans = [];
    const errors = [];

    for (const path of paths) {
      try {
        if (cache && (parsed.check || parsed.diff || parsed.write)) {
          const config = resolveConfig(path, {
            configPath: parsed.configPath,
            cliLeaves: nestLeaves(parsed.cliLeaves),
          });

          if (config.ignored) {
            plans.push({ path, ignored: true });
            continue;
          }

          if (cache.isHit(path, config.leaves)) {
            plans.push({ path, ignored: false, changed: false, cached: true });
            continue;
          }

          const plan = formatPlan(path, parsed);
          plans.push(plan);

          if (!plan.changed) {
            cache.set(path, config.leaves, plan.bytes);
          }
        } else {
          plans.push(formatPlan(path, parsed));
        }
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      if (cache) {
        cache.save();
      }

      for (const error of errors) {
        process.stderr.write(`fcfmt: ${error.message}\n`);
      }

      return EXIT_ERROR;
    }

    if (!parsed.check && !parsed.diff && !parsed.write) {
      if (plans[0]?.ignored) {
        throw new ConfigError(`${paths[0]}: file is ignored`);
      }

      process.stdout.write(plans[0].output);
      return EXIT_SUCCESS;
    }

    const changed = plans.filter((plan) => plan.changed);

    if (parsed.write) {
      const written = [];

      for (const plan of changed) {
        try {
          commitFile(plan);
          written.push(plan.path);
          process.stdout.write(`Wrote ${plan.path}\n`);

          if (cache) {
            const config = resolveConfig(plan.path, {
              configPath: parsed.configPath,
              cliLeaves: nestLeaves(parsed.cliLeaves),
            });
            cache.set(plan.path, config.leaves, Buffer.from(plan.output, "utf8"));
          }
        } catch (error) {
          process.stderr.write(`fcfmt: ${plan.path}: write failed: ${error.message}\n`);
          process.stderr.write(`fcfmt: ${written.length} file(s) written before failure\n`);
          return EXIT_ERROR;
        }
      }

      if (cache) {
        cache.save();
      }

      return EXIT_SUCCESS;
    }

    const useColor = parsed.color ?? (Boolean(process.stdout?.isTTY) && !process.env.NO_COLOR);

    for (const plan of changed) {
      if (parsed.diff) {
        const label = relative(process.cwd(), plan.path).split(sep).join("/");
        process.stdout.write(unifiedDiff(plan.original, plan.output, label, { color: useColor }));
      } else {
        process.stdout.write(`${plan.path}\n`);
      }
    }

    if (cache) {
      cache.save();
    }

    return parsed.check && changed.length > 0 ? EXIT_CHECK_DIFF_FOUND : EXIT_SUCCESS;
  } catch (error) {
    process.stderr.write(`fcfmt: ${error.message}\n`);
    return EXIT_ERROR;
  }
}
