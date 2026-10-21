/** User-configurable layout choices that preserve FC syntax and literal bytes. */
export type WrapMode = "never" | "auto" | "always";

export interface FormatOptions {
  readonly fileName?: string;
  readonly fileKind?: "fcc" | "fcg";
  readonly printWidth?: number;
  readonly tabWidth?: number;
  readonly useTabs?: boolean;
  readonly spaceAroundOperators?: boolean;
  readonly spaceAfterComma?: boolean;
  readonly wrapCalls?: WrapMode;
  readonly wrapCollections?: WrapMode;
  readonly collapseBlankLines?: boolean;
  readonly insertFinalNewline?: boolean;
}

export interface ResolvedFormatOptions {
  readonly printWidth: number;
  readonly tabWidth: number;
  readonly useTabs: boolean;
  readonly spaceAroundOperators: boolean;
  readonly spaceAfterComma: boolean;
  readonly wrapCalls: WrapMode;
  readonly wrapCollections: WrapMode;
  readonly collapseBlankLines: boolean;
  readonly insertFinalNewline: boolean;
}

export const DEFAULT_FORMAT_OPTIONS: ResolvedFormatOptions = {
  printWidth: 120,
  tabWidth: 2,
  useTabs: false,
  spaceAroundOperators: true,
  spaceAfterComma: true,
  wrapCalls: "auto",
  wrapCollections: "auto",
  collapseBlankLines: true,
  insertFinalNewline: true,
};

/** Normalizes public options so formatting has one deterministic fallback for invalid values. */
export function resolveFormatOptions(options: FormatOptions): ResolvedFormatOptions {
  return {
    printWidth: positiveInteger(options.printWidth, DEFAULT_FORMAT_OPTIONS.printWidth, 20, 1000),
    tabWidth: positiveInteger(options.tabWidth, DEFAULT_FORMAT_OPTIONS.tabWidth, 1, 16),
    useTabs: options.useTabs ?? DEFAULT_FORMAT_OPTIONS.useTabs,
    spaceAroundOperators: options.spaceAroundOperators ?? DEFAULT_FORMAT_OPTIONS.spaceAroundOperators,
    spaceAfterComma: options.spaceAfterComma ?? DEFAULT_FORMAT_OPTIONS.spaceAfterComma,
    wrapCalls: wrapMode(options.wrapCalls, DEFAULT_FORMAT_OPTIONS.wrapCalls),
    wrapCollections: wrapMode(options.wrapCollections, DEFAULT_FORMAT_OPTIONS.wrapCollections),
    collapseBlankLines: options.collapseBlankLines ?? DEFAULT_FORMAT_OPTIONS.collapseBlankLines,
    insertFinalNewline: options.insertFinalNewline ?? DEFAULT_FORMAT_OPTIONS.insertFinalNewline,
  };
}

function positiveInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return value !== undefined && Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function wrapMode(value: WrapMode | undefined, fallback: WrapMode): WrapMode {
  return value === "never" || value === "auto" || value === "always" ? value : fallback;
}
