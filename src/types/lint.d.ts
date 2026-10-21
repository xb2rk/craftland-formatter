/**
 * @fileoverview Type definitions for the Craftland FC Linter.
 *
 * Provides type definitions for rule authors, the AST visitor engine,
 * and diagnostic reporting interfaces.
 */

import type { SyntaxNode, Token } from "./ast.js";

/**
 * Severity levels supported by the linter.
 * - 'off': Rule is completely disabled.
 * - 'warn': Emits a non-fatal warning diagnostic.
 * - 'error': Emits a fatal error diagnostic that fails CI checks.
 */
export type LintSeverity = "off" | "warn" | "error";

/**
 * A concrete diagnostic emitted by a lint rule.
 */
export interface LintDiagnostic {
  /** Identifier of the rule emitting this diagnostic (e.g. 'no-assignment-in-condition'). */
  readonly ruleId: string;

  /** Diagnostic severity level. */
  readonly severity: "warn" | "error";

  /** Human-readable explanation of the issue and suggested fix. */
  readonly message: string;

  /** Zero-based character start offset in the source. */
  readonly start: number;

  /** Zero-based character exclusive end offset in the source. */
  readonly end: number;

  /** 1-based starting line number. */
  readonly line: number;

  /** 0-based starting column offset. */
  readonly column: number;

  /** Optional automated fix instruction. */
  readonly fix?: {
    readonly start: number;
    readonly end: number;
    readonly text: string;
  };
}

/**
 * Descriptor passed to `context.report()` by rules.
 */
export interface ReportDescriptor {
  /** Syntax node or token to attach this diagnostic to. */
  readonly node?: { readonly start: number; readonly end: number; readonly line?: number; readonly column?: number };
  /** Explicit token target. */
  readonly token?: Token;
  /** Explicit start offset if node/token not provided. */
  readonly start?: number;
  /** Explicit end offset if node/token not provided. */
  readonly end?: number;
  /** Explicit line number (1-based). */
  readonly line?: number;
  /** Explicit column number (0-based). */
  readonly column?: number;
  /** Human-readable message explaining the violation. */
  readonly message: string;
  /** Optional automated text replacement. */
  readonly fix?: {
    readonly start: number;
    readonly end: number;
    readonly text: string;
  };
}

/**
 * Contextual utilities and information provided to each rule instance.
 */
export interface LintContext {
  /** Path to the file being linted, if available. */
  readonly filePath?: string;

  /** The complete raw source code text. */
  readonly sourceText: string;

  /** All tokens in the document, including trivia comments and whitespace. */
  readonly tokens: readonly Token[];

  /** Root syntax node of the document. */
  readonly tree: SyntaxNode;

  /** Report a rule violation diagnostic. */
  report(descriptor: ReportDescriptor): void;
}

/**
 * Visitor mapping node kind to handler function.
 */
export type NodeVisitorMap = {
  [K in import("./ast.js").SyntaxKind | string]?: (node: SyntaxNode) => void;
};

/**
 * Complete specification of an FC lint rule.
 */
export interface LintRule {
  /** Unique hyphen-cased rule identifier (e.g. 'no-self-compare'). */
  readonly id: string;

  /** Short English summary of what the rule checks and prevents. */
  readonly description: string;

  /** Default severity when not explicitly overridden in configuration. */
  readonly defaultSeverity: LintSeverity;

  /** Instantiates rule visitors for the given lint context. */
  create(context: LintContext): NodeVisitorMap;
}

/**
 * Configuration options for linting a file or project.
 */
export interface LintOptions {
  /** Map of rule IDs to their configured severity. */
  readonly rules?: Record<string, LintSeverity>;
}

/**
 * The outcome of linting a parsed FC document.
 */
export interface LintResult {
  /** Diagnostics emitted by all active rules. */
  readonly diagnostics: readonly LintDiagnostic[];

  /** Count of warnings emitted. */
  readonly warningCount: number;

  /** Count of errors emitted. */
  readonly errorCount: number;
}
