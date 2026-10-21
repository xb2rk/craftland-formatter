/**
 * @module shared/constants - single source for magic numbers and shared literals.
 *
 * Centralizes policy defaults and internal thresholds so call sites avoid
 * hard-coded literals. Every constant is named for auditability and re-use
 * across formatter, linter, CLI, and VS Code extension.
 */

/** Default maximum line width before the printer tries to break (mirrors Config.printWidth default). */
export const DEFAULT_PRINT_WIDTH = 100 as const;

/** Default spaces per indentation level (mirrors Config.tabWidth default). */
export const DEFAULT_TAB_WIDTH = 2 as const;

/** Minimum allowed tabWidth. */
export const TAB_WIDTH_MIN = 1 as const;

/** Maximum allowed tabWidth. */
export const TAB_WIDTH_MAX = 16 as const;

/**
 * Maximum number of consecutive blank lines preserved by the normalizer.
 * The normalizer collapses any run longer than this to exactly one blank line.
 */
export const MAX_CONSECUTIVE_BLANK_LINES = 1 as const;

/** Byte-order-mark character stripped at the start of a file. */
export const BOM_CHARACTER = "\uFEFF" as const;

/** Unicode code point threshold: at or above this value an identifier may start with any non-ASCII letter. */
export const NON_ASCII_START = 0x80 as const;

/**
 * How many items back the linter looks for a leading `/**` JSDoc.
 * Checked at call sites via `Math.max(0, index - JSDOC_LOOKBACK_ITEMS)`.
 */
export const JSDOC_LOOKBACK_ITEMS = 64 as const;

/** Regex matching trailing horizontal whitespace (spaces/tabs) at line end. */
export const TRAILING_WHITESPACE_RE = /[ \t]+$/u;

/** Regex for normalizing all CRLF/CR sequences to LF. */
export const CRLF_TO_LF_RE = /\r\n?/gu;

/** Regex for converting LF back to CRLF when `endOfLine` is `crlf`. */
export const LF_TO_CRLF_RE = /\n/gu;

/** String marker used to detect a blank line in trivia text. */
export const BLANK_LINE_MARKER = "\n\n" as const;

/** Maximum buffered bytes for the external compiler oracle stdout/stderr. */
export const ORACLE_MAX_BUFFER_BYTES = 64 * 1024 * 1024; // 64 MiB

/** Debounce interval (ms) for VS Code live diagnostics. */
export const DEBOUNCE_MS = 200;

/** Priority for the VS Code language status bar item (higher = more to the right). */
export const STATUS_BAR_PRIORITY = 100;

/** Language id contributed by Craftland Studio for FC sources. */
export const FC_LANGUAGE_ID = "ffugclanguage" as const;
