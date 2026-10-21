/**
 * @fileoverview The file-aware formatting service shared between CLI and editor adapters.
 *
 * Resolves effective project and editor configuration for a given file path,
 * evaluates ignore patterns, and drives the document printer.
 */

import { extname } from "node:path";

import { resolveConfig } from "./config.mjs";
import { ConfigError, printerOptions } from "./config-registry.mjs";
import { formatSource } from "./printer.mjs";

/**
 * Format source text according to the project configuration resolved for its file path.
 *
 * Source text may originate from disk, stdin, or an in-memory editor buffer.
 *
 * @param {string} source - The raw FC source text to format.
 * @param {string} filePath - Path used for config discovery and file-type detection (.fcg or .fcc).
 * @param {object} [settings] - Optional override settings.
 * @param {ReturnType<typeof resolveConfig>} [settings.resolvedConfig] - Pre-resolved configuration.
 * @param {string} [settings.configPath] - Explicit path to a .fcfmt.json file.
 * @param {Record<string, unknown>} [settings.cliLeaves] - Command-line option overrides.
 * @returns {{
 *   output: string | null,
 *   diagnostics: readonly object[],
 *   ignored: boolean,
 *   config: ReturnType<typeof resolveConfig>
 * }}
 * @throws {ConfigError} If the file path does not have an .fcg or .fcc extension.
 */
export function formatConfiguredSource(source, filePath, settings = {}) {
  const config = settings.resolvedConfig ?? resolveConfig(filePath, settings);

  if (config.ignored) {
    return {
      output: null,
      diagnostics: [],
      ignored: true,
      config,
    };
  }

  const kind = extname(filePath).slice(1).toLowerCase();

  if (kind !== "fcg" && kind !== "fcc") {
    throw new ConfigError(`${filePath}: expected a .fcg or .fcc file`);
  }

  const result = formatSource(source, kind, printerOptions(config.leaves));

  return {
    ...result,
    ignored: false,
    config,
  };
}
