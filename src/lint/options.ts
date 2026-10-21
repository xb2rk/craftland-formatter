/**
 * @module lint/options - normalized lint options and validation.
 */

import { DEFAULT_CONFIG, type Config } from "../format/config.js";

export interface LintOptions {
  /** Width used by the advisory `line-too-long` rule. */
  printWidth?: number;
  bracketSpacing?: Config["bracketSpacing"];
  spaceInsideParens?: boolean;
  spaceInsideBrackets?: boolean;
  spaceInsideBraces?: boolean;
  trailingComma?: Config["trailingComma"];
  callBreakStyle?: Config["callBreakStyle"];
}

export const DEFAULT_LINT_OPTIONS: Required<LintOptions> = Object.freeze({
  printWidth: DEFAULT_CONFIG.printWidth,
  bracketSpacing: DEFAULT_CONFIG.bracketSpacing,
  spaceInsideParens: DEFAULT_CONFIG.spaceInsideParens,
  spaceInsideBrackets: DEFAULT_CONFIG.spaceInsideBrackets,
  spaceInsideBraces: DEFAULT_CONFIG.spaceInsideBraces,
  trailingComma: DEFAULT_CONFIG.trailingComma,
  callBreakStyle: DEFAULT_CONFIG.callBreakStyle,
});

/**
 * Validate and normalize lint options.
 *
 * @param options - partial lint options.
 * @returns normalized options.
 * @throws {Error} when values are invalid.
 */
export function normalizeOptions(options: Partial<LintOptions> | Pick<Config, "printWidth"> = {}): Required<LintOptions> {
  const maybe = options as Partial<LintOptions>;
  const printWidth = maybe.printWidth ?? DEFAULT_LINT_OPTIONS.printWidth;
  const bracketSpacing = maybe.bracketSpacing ?? DEFAULT_LINT_OPTIONS.bracketSpacing;
  const spaceInsideParens = maybe.spaceInsideParens ?? DEFAULT_LINT_OPTIONS.spaceInsideParens;
  const spaceInsideBrackets = maybe.spaceInsideBrackets ?? DEFAULT_LINT_OPTIONS.spaceInsideBrackets;
  const spaceInsideBraces = maybe.spaceInsideBraces ?? DEFAULT_LINT_OPTIONS.spaceInsideBraces;
  const trailingComma = maybe.trailingComma ?? DEFAULT_LINT_OPTIONS.trailingComma;
  const callBreakStyle = maybe.callBreakStyle ?? DEFAULT_LINT_OPTIONS.callBreakStyle;
  if (!Number.isInteger(printWidth) || printWidth < 1) {
    throw new Error("printWidth must be a positive integer");
  }
  if (!["none", "space"].includes(bracketSpacing)) {
    throw new Error("bracketSpacing must be 'none' or 'space'");
  }
  for (const [name, value] of Object.entries({ spaceInsideParens, spaceInsideBrackets, spaceInsideBraces })) {
    if (typeof value !== "boolean") {
      throw new Error(`${name} must be boolean`);
    }
  }
  if (!["never", "multiline", "always"].includes(trailingComma)) {
    throw new Error("trailingComma must be 'never', 'multiline', or 'always'");
  }
  if (!["breakAll", "hugFirst"].includes(callBreakStyle)) {
    throw new Error("callBreakStyle must be 'breakAll' or 'hugFirst'");
  }
  return { printWidth, bracketSpacing, spaceInsideParens, spaceInsideBrackets, spaceInsideBraces, trailingComma, callBreakStyle };
}
