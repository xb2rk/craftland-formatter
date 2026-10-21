/**
 * @fileoverview Lossless FC syntax tree and token definitions.
 *
 * These types represent the lossless concrete syntax tree (CST) and token stream
 * produced by the Craftland FC lexer and structural parser. Every token preserves
 * exact source coordinates and trivia so formatting is strictly reversible.
 */

/**
 * Channel categorization for tokens.
 * - `syntax`: Semantic language tokens (keywords, identifiers, operators, literals).
 * - `trivia`: Non-semantic tokens preserved for layout (whitespace, newlines, comments).
 * - `error`: Unrecognized or malformed byte sequences.
 */
export type TokenChannel = "syntax" | "trivia" | "error";

/**
 * Lossless source token covering an exact contiguous range in the original text.
 */
export interface Token {
  /** The grammar token family or literal category (e.g. IDENTIFIER, LINE_COMMENT). */
  readonly kind: string;

  /** The exact raw text slice from the source code. */
  readonly text: string;

  /** Zero-based start character offset in the source string. */
  readonly start: number;

  /** Zero-based exclusive end character offset in the source string. */
  readonly end: number;

  /** 1-based starting line number. */
  readonly line: number;

  /** 0-based starting column offset on the starting line. */
  readonly column: number;

  /** 1-based ending line number after scanning all newlines in this token. */
  readonly endLine: number;

  /** 0-based ending column offset on the ending line. */
  readonly endColumn: number;

  /** Whether this token participates in grammar parsing or trivia formatting. */
  readonly channel: TokenChannel;
}

/**
 * Diagnostic produced by the lexical scanner when invalid bytes or unclosed
 * literals are encountered.
 */
export interface LexDiagnostic {
  readonly phase: "lexer";

  /** Machine-readable error code (e.g. 'unterminated-comment', 'unexpected-bom'). */
  readonly code: string;

  /** Human-readable explanation of the lexical error. */
  readonly message: string;

  /** Zero-based character offset where the error begins. */
  readonly start: number;

  /** Zero-based character offset where the error ends. */
  readonly end: number;

  /** 1-based line number for user diagnostics. */
  readonly line: number;

  /** 0-based column number for user diagnostics. */
  readonly column: number;
}

/**
 * Result returned by the lossless lexer.
 */
export interface LexResult {
  /** Complete ordered array of tokens covering the entire source file. */
  readonly tokens: Token[];

  /** Any lexical errors detected during scanning. Non-empty diagnostics suppress formatting. */
  readonly diagnostics: LexDiagnostic[];
}

/**
 * Grammar roles recognized by the structural parser.
 */
export type SyntaxKind =
  | "File"
  | "Import"
  | "Graph"
  | "GraphBlock"
  | "Declaration"
  | "DeclarationBlock"
  | "Decorator"
  | "Function"
  | "EventListener"
  | "Property"
  | "Member"
  | "CodeBlock"
  | "Statement"
  | "ControlFlow"
  | "Condition"
  | "Signature"
  | "BareCall"
  | "ValueCall"
  | "Index"
  | "Collection"
  | "TypeArguments"
  | "LocalizedString"
  | "Parenthesized"
  | "FunctionTypeSignature"
  | "FunctionExpression";

/**
 * A concrete syntax node in the parsed FC document.
 */
export interface SyntaxNode {
  /** The syntactic category or role of this node. */
  readonly kind: SyntaxKind;

  /** Zero-based starting character offset in the source. */
  readonly start: number;

  /** Zero-based exclusive ending character offset in the source. */
  readonly end: number;

  /** Nested child syntax nodes in source order. */
  readonly children: readonly SyntaxNode[];

  /** The complete token stream attached to the root File node. */
  readonly tokens?: readonly Token[];
}

/**
 * Diagnostic emitted when input violates Craftland FC grammar or invariant rules.
 */
export interface ParseDiagnostic {
  readonly phase: "parser";

  /** Machine-readable diagnostic code (e.g. 'missing-import', 'unclosed-block'). */
  readonly code: string;

  /** Actionable error description. */
  readonly message: string;

  /** Zero-based start character offset. */
  readonly start: number;

  /** Zero-based end character offset. */
  readonly end: number;

  /** 1-based line number. */
  readonly line: number;

  /** 0-based column number. */
  readonly column: number;
}

/**
 * The outcome of structural parsing.
 */
export interface ParseResult {
  /** The parsed CST root node, or null if syntax errors were encountered. */
  readonly tree: (SyntaxNode & { readonly tokens: readonly Token[] }) | null;

  /** Diagnostics accumulated during lexing and parsing. Suppresses output if non-empty. */
  readonly diagnostics: readonly (ParseDiagnostic | LexDiagnostic)[];
}
