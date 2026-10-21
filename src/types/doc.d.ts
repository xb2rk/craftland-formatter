/**
 * @fileoverview Immutable document IR nodes and rendering options for the FC Formatter.
 *
 * The Document IR models formatting decisions abstractly using a tree of Doc nodes
 * inspired by Prettier's Wadler-Leijen layout engine. Formatting logic generates Docs,
 * while the single renderer evaluates group fitting, indentation, and column wrapping.
 */

/**
 * Break mode for a Doc group:
 * - `auto`: Breaks only if its flat width exceeds the remaining print width on the current line.
 * - `always`: Always breaks across multiple lines regardless of width.
 * - `never`: Never breaks optionally; only hardline breaks inside will split lines.
 */
export type DocMode = "auto" | "always" | "never";

/**
 * Plain text document node. Must not contain literal newlines.
 */
export interface DocText {
  readonly type: "text";

  /** The string content to render on a single line. */
  readonly value: string;
}

/**
 * Verbatim text node that preserves protected source bytes (e.g. raw strings, comments).
 * May contain its own internal newlines.
 */
export interface DocVerbatim {
  readonly type: "verbatim";

  /** Preserved source slice. */
  readonly value: string;

  /** If true, clears any pending indentation on its first line. */
  readonly absolute?: boolean;
}

/**
 * Line break node.
 * - In broken mode: renders as a newline (EOL) followed by the current indentation.
 * - In flat mode:
 *   - `line`: renders as a single space " ".
 *   - `softline`: renders as empty string "".
 *   - `hardline`: always forces a newline even inside a flat group.
 */
export interface DocLine {
  readonly type: "line" | "softline" | "hardline";
}

/**
 * Sequence of child document nodes rendered consecutively without separator.
 */
export interface DocConcat {
  readonly type: "concat";

  /** Child document parts. */
  readonly parts: readonly Doc[];
}

/**
 * Layout group that attempts to fit its contents on a single line, breaking
 * all nested lines simultaneously if the content exceeds the print width.
 */
export interface DocGroup {
  readonly type: "group";

  /** Group contents to measure and render. */
  readonly contents: Doc;

  /** Layout break mode rule. */
  readonly mode: DocMode;
}

/**
 * Increases the indentation level for all line breaks inside its contents.
 */
export interface DocIndent {
  readonly type: "indent";

  /** Document subtree rendered with increased indentation. */
  readonly contents: Doc;

  /** Number of indentation units to add (default 1). */
  readonly levels: number;
}

/**
 * Conditional document node rendering different trees depending on whether
 * its enclosing group is broken or flat.
 */
export interface DocIfBreak {
  readonly type: "ifBreak";

  /** Rendered when the enclosing group breaks into multiline layout. */
  readonly broken: Doc;

  /** Rendered when the enclosing group fits on a single line. */
  readonly flat: Doc;
}

/**
 * Union of all valid immutable document nodes recognized by the renderer.
 */
export type Doc =
  | DocText
  | DocVerbatim
  | DocLine
  | DocConcat
  | DocGroup
  | DocIndent
  | DocIfBreak;

/**
 * Configuration options required by the document renderer.
 */
export interface RenderOptions {
  /** Maximum target column width before wrapping lines. */
  readonly printWidth: number;

  /** Indentation string per level (e.g. '  ' for 2 spaces, or '\t'). */
  readonly indentUnit: string;

  /** End of line sequence ('\n' or '\r\n'). */
  readonly eol: string;

  /** Column stop for tab characters (default 4). */
  readonly tabWidth?: number;
}
