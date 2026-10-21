/**
 * @module extension/config - VS Code settings → formatter config bridge.
 */

import * as vscode from "vscode";
import { resolveConfig, type Config, type LintOptions } from "../../dist/index.js";

/** Language id contributed by Craftland Studio. */
export const LANGUAGE = "ffugclanguage";

/** Debounce interval (ms) for live diagnostics. */
export const DEBOUNCE_MS = 200;

/** Priority for the language status bar item. */
export const STATUS_BAR_PRIORITY = 100;

/** Config keys forwarded from VS Code settings to `resolveConfig`. */
export const CONFIG_KEYS: (keyof Config)[] = [
  "printWidth",
  "tabWidth",
  "useTabs",
  "endOfLine",
  "collapseBlankLines",
  "trimTrailingWhitespace",
  "insertFinalNewline",
  "spaceAroundOperators",
  "spaceInsideParens",
  "spaceInsideBrackets",
  "spaceInsideBraces",
  "spaceAfterComma",
  "bracketSpacing",
  "wrapCalls",
  "wrapCollections",
  "callBreakStyle",
  "trailingComma",
];

/**
 * Read `fcFormatV2` settings and resolve to a full config.
 *
 * @returns resolved config.
 */
export function getConfig(): Config {
  const settings = vscode.workspace.getConfiguration("fcFormatV2");
  const partial: Partial<Config> = {};
  for (const key of CONFIG_KEYS) {
    const value = settings.get<Config[typeof key]>(key);
    if (value !== undefined) {
      (partial as Record<keyof Config, unknown>)[key] = value;
    }
  }
  return resolveConfig(partial);
}

/**
 * Whether lint diagnostics are enabled.
 *
 * @returns true if enabled.
 */
export function isLintEnabled(): boolean {
  return vscode.workspace.getConfiguration("fcFormatV2").get<boolean>("enableLint") ?? false;
}

/**
 * Map formatter config to lint options (subset used by the linter).
 *
 * @param cfg - resolved config.
 * @returns lint options.
 */
export function toLintOptions(cfg: Config): LintOptions {
  return {
    printWidth: cfg.printWidth,
    bracketSpacing: cfg.bracketSpacing,
    spaceInsideParens: cfg.spaceInsideParens,
    spaceInsideBrackets: cfg.spaceInsideBrackets,
    spaceInsideBraces: cfg.spaceInsideBraces,
  };
}
