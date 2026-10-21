/**
 * @module format/config - validated formatter configuration.
 *
 * The formatter has no presets. Tier 1/2 rules are fixed; only the knobs
 * defined in `FC_FORMATTER_SPEC.md` §16 are configurable. P1 exposes only the
 * few options with a settled cross-phase meaning; P3 adds each remaining knob
 * only alongside printer behavior and output tests. This deliberately avoids
 * the inert configuration surface that made v1 misleading.
 *
 * @example
 * ```ts
 * import { resolveConfig } from "./config.js";
 * const cfg = resolveConfig({ printWidth: 80, useTabs: false });
 * ```
 */

import {
  DEFAULT_PRINT_WIDTH,
  DEFAULT_TAB_WIDTH,
  TAB_WIDTH_MAX,
  TAB_WIDTH_MIN,
} from "../shared/constants.js";

/** Controls how a group responds to `printWidth`. */
export type WrapMode = "never" | "auto" | "always";
/** When to emit a trailing comma for a multi-line group. */
export type TrailingComma = "never" | "multiline" | "always";
/** Line-ending style normalized after the printer. */
export type EndOfLine = "lf" | "crlf";
/** Whether composite-brace groups include interior spacing when kept flat. */
export type BracketSpacing = "none" | "space";
/**
 * How the printer breaks a delimited call/collection when it exceeds `printWidth`.
 * - `breakAll`: every argument moves to its own indented line.
 * - `hugFirst`: the first argument stays on the opener line when it fits, remaining args break.
 */
export type CallBreakStyle = "breakAll" | "hugFirst";

/** Options with behavior implemented by the P2/P3 printer. */
export interface Config {
  /** Maximum line width before the printer tries to break (default 100). */
  printWidth: number;
  /** Spaces (or 1 tab) added for each indentation level (default 2). Prettier alias: tabWidth. */
  tabWidth: number;
  /** Use one tab per indentation level instead of spaces. */
  useTabs: boolean;
  /** Line terminator style; `"lf"` by default. Prettier alias: endOfLine. */
  endOfLine: EndOfLine;
  /** When true, keep a single blank line maximum between top-level items. */
  collapseBlankLines: boolean;
  /** Remove generated trailing spaces/tabs outside protected literals/comments. */
  trimTrailingWhitespace: boolean;
  /** Ensure one final line ending for non-empty output. */
  insertFinalNewline: boolean;
  /** Add spaces around binary and assignment operators. */
  spaceAroundOperators: boolean;
  /** Add one space inside non-block parentheses. */
  spaceInsideParens: boolean;
  /** Add one space inside brackets (index/collection). */
  spaceInsideBrackets: boolean;
  /** Add one space inside composite braces when kept flat. */
  spaceInsideBraces: boolean;
  /** Add one space after a flat comma. */
  spaceAfterComma: boolean;
  /** Composite brace attachment: `Type{}` or `Type {}`. Prettier alias: bracketSpacing. */
  bracketSpacing: BracketSpacing;
  /** How call/collection groups respond to width. */
  wrapCalls: WrapMode;
  wrapCollections: WrapMode;
  /** Placement of the first argument when a call breaks: `breakAll` = all args newline, `hugFirst` = first arg stays on opener line. */
  callBreakStyle: CallBreakStyle;
  /** Trailing comma policy for groups that break across lines. */
  trailingComma: TrailingComma;
}

/**
 * Default values for the currently implemented configuration surface.
 * Frozen to prevent accidental mutation.
 */
export const DEFAULT_CONFIG: Config = Object.freeze({
  printWidth: DEFAULT_PRINT_WIDTH,
  tabWidth: DEFAULT_TAB_WIDTH,
  useTabs: false,
  endOfLine: "lf",
  collapseBlankLines: true,
  trimTrailingWhitespace: true,
  insertFinalNewline: true,
  spaceAroundOperators: true,
  spaceInsideParens: false,
  spaceInsideBrackets: false,
  spaceInsideBraces: false,
  spaceAfterComma: true,
  bracketSpacing: "none",
  wrapCalls: "auto",
  wrapCollections: "auto",
  callBreakStyle: "breakAll",
  trailingComma: "multiline",
});

/**
 * Merge a partial user config over the defaults and validate every public
 * value. File/CLI discovery is deliberately kept in the CLI adapter.
 *
 * @param overrides - user-supplied partial options.
 * @returns a fully-resolved {@link Config}.
 * @throws {Error} when any option is out of range or wrong type.
 */
export function resolveConfig(overrides: Partial<Config> = {}): Config {
  const resolved = { ...DEFAULT_CONFIG, ...overrides };
  // Validate positive printWidth.
  if (!Number.isInteger(resolved.printWidth) || resolved.printWidth < 1) {
    throw new Error("printWidth must be a positive integer");
  }
  // Validate tabWidth within [TAB_WIDTH_MIN, TAB_WIDTH_MAX].
  if (
    !Number.isInteger(resolved.tabWidth) ||
    resolved.tabWidth < TAB_WIDTH_MIN ||
    resolved.tabWidth > TAB_WIDTH_MAX
  ) {
    throw new Error(`tabWidth must be an integer between ${TAB_WIDTH_MIN} and ${TAB_WIDTH_MAX}`);
  }
  // Validate all boolean flags.
  for (const [name, value] of Object.entries({
    useTabs: resolved.useTabs,
    collapseBlankLines: resolved.collapseBlankLines,
    trimTrailingWhitespace: resolved.trimTrailingWhitespace,
    insertFinalNewline: resolved.insertFinalNewline,
    spaceAroundOperators: resolved.spaceAroundOperators,
    spaceInsideParens: resolved.spaceInsideParens,
    spaceInsideBrackets: resolved.spaceInsideBrackets,
    spaceInsideBraces: resolved.spaceInsideBraces,
    spaceAfterComma: resolved.spaceAfterComma,
  })) {
    if (typeof value !== "boolean") {
      throw new Error(`${name} must be boolean`);
    }
  }
  if (!["lf", "crlf"].includes(resolved.endOfLine)) {
    throw new Error("endOfLine must be 'lf' or 'crlf'");
  }
  if (!["none", "space"].includes(resolved.bracketSpacing)) {
    throw new Error("bracketSpacing must be 'none' or 'space'");
  }
  if (
    !["never", "auto", "always"].includes(resolved.wrapCalls) ||
    !["never", "auto", "always"].includes(resolved.wrapCollections)
  ) {
    throw new Error("wrap mode must be 'never', 'auto', or 'always'");
  }
  if (!["breakAll", "hugFirst"].includes(resolved.callBreakStyle)) {
    throw new Error("callBreakStyle must be 'breakAll' or 'hugFirst'");
  }
  if (!["never", "multiline", "always"].includes(resolved.trailingComma)) {
    throw new Error("trailingComma must be 'never', 'multiline', or 'always'");
  }
  return resolved;
}
