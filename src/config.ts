// Formatter configuration. Every field is user-configurable (mirrored as a
// VS Code setting) except where the FC grammar itself forces a behavior.

export interface FormatConfig {
  indentWidth: number;
  useTabs: boolean;
  maxLineLength: number;
  endOfLine: "lf" | "crlf" | "auto";
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;
  trimFinalNewlines: boolean;

  braceStyle: "sameLine" | "nextLine"; // FC convention: sameLine (K&R)
  spacesAroundOperators: boolean;
  spacesInsideBraces: boolean;
  spacesInsideParens: boolean;
  spaceBeforeOpeningBrace: boolean;
  spaceAfterComma: boolean;
  spaceAfterComment: boolean;

  // Import ordering.
  importSort: {
    enabled: boolean;
    // Order of groups; each group is matched by a predicate name.
    order: ImportGroup[];
    blankLineBetweenGroups: boolean;
    relativeDepthOrder: "descending" | "ascending";
  };

  // Trailing commas.
  trailingComma: {
    multilineCalls: "always" | "never" | "preserve";
    multilineCollections: "always" | "never" | "preserve";
    // Parameter declarations have NO trailing comma (grammar-enforced); not a
    // config option.
  };

  // Blank line handling.
  blankLines: {
    collapse: boolean;
    minBetweenTopLevelDecls: number;
    maxConsecutive: number;
  };

  // Line wrapping strategy for long constructs.
  //   "fit"    - keep on one line if it fits within maxLineLength, else wrap
  //              (this is the gofmt-style default and matches what the FC
  //              toolchain expects)
  //   "always" - always wrap onto multiple lines
  //   "never"  - keep on one line even if it overflows
  wrapLongConditions: "fit" | "always" | "never";
  wrapLongSignatures: "fit" | "always" | "never";
  wrapLongCalls: "fit" | "always" | "never";
  binaryOperatorLineBreak: "afterOperator" | "beforeOperator";
}

export type ImportGroup =
  | "std"
  | "stdlib"
  | "contracts"
  | "relative";

export const defaultConfig: FormatConfig = {
  indentWidth: 2,
  useTabs: false,
  maxLineLength: 120,
  endOfLine: "lf",
  trimTrailingWhitespace: true,
  insertFinalNewline: true,
  trimFinalNewlines: true,

  braceStyle: "sameLine",
  spacesAroundOperators: true,
  spacesInsideBraces: false,
  spacesInsideParens: false,
  spaceBeforeOpeningBrace: true,
  spaceAfterComma: true,
  spaceAfterComment: true,

  importSort: {
    enabled: true,
    // std = language libs (List/Map/Math/Time...), stdlib = required toolchain
    // libs StdLibrary.fcc + EditorGenLib.fcc grouped together, contracts =
    // shared Contract/*.fcc, relative = project scripts by depth.
    order: ["std", "stdlib", "contracts", "relative"],
    blankLineBetweenGroups: true,
    relativeDepthOrder: "descending",
  },

  trailingComma: {
    // Trailing comma for multi-line calls. FC grammar `arg (COMMA arg)*`
    // forbids a trailing comma on *value* calls (result assigned/consumed); it
    // is only legal on *statement* calls (CreateTween, NotifyShowTips, wait…).
    //   "preserve" (default) : keep the source's trailing comma, never add one.
    //   "always"             : add one, but only to statement calls.
    //   "never"              : never add one.
    multilineCalls: "preserve",
    multilineCollections: "always",
  },

  blankLines: {
    collapse: true,
    minBetweenTopLevelDecls: 1,
    maxConsecutive: 2,
  },

  wrapLongConditions: "fit",
  // Parameter lists (`func`/`event`): grammar forbids a trailing comma, so they
  // default to "never" (single line) for safety. Set "fit"/"always" to wrap
  // long parameter lists (still without a trailing comma).
  wrapLongSignatures: "never",
  wrapLongCalls: "fit",
  binaryOperatorLineBreak: "afterOperator",
};

export function resolveConfig(partial: Partial<FormatConfig> = {}): FormatConfig {
  return {
    ...defaultConfig,
    ...partial,
    importSort: { ...defaultConfig.importSort, ...(partial.importSort ?? {}) },
    trailingComma: { ...defaultConfig.trailingComma, ...(partial.trailingComma ?? {}) },
    blankLines: { ...defaultConfig.blankLines, ...(partial.blankLines ?? {}) },
  };
}