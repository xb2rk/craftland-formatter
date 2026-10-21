/**
 * index.ts - the public API surface of `fc-format-v2`.
 *
 * Everything a consumer (CLI, golden tests, the future VS Code extension glue,
 * or the v2 linter) should be able to reach without traversing internal files
 * is re-exported here. This module deliberately has no behaviour of its own:
 * the formatting pipeline lives in `format.ts` (added in P3) and the lexer
 * details live in `tokenizer.ts` (added in P2).
 */

// Grammar / token id table (regenerated from FCGLexer).
export { GRAMMAR_PROVENANCE, TokenId } from "./lex/grammar.generated.js";
export { reconstructTokens } from "./lex/tokens.js";
export type { SourcePosition, SourceSpan, Token, TokenKind } from "./lex/tokens.js";

// Lookup tables (hand-maintained on top of the generated ids).
export { KEYWORDS, OPERATORS, PUNCTUATORS, TRIVIA_KINDS, isTrivia, keywordKind } from "./lex/grammar.js";

// Source cursor - internal but reused by tests from P2 onwards.
export { StringReader } from "./lex/reader.js";

// Lossless source pipeline and structural model.
export { tokenize } from "./lex/tokenizer.js";
export { itemize, reconstructDocument } from "./lex/items.js";
export type { Item, LexedDocument, Trivia, TriviaKind } from "./lex/items.js";
export { classify, DelimKind, isNode } from "./syntax/classifier.js";
export type { Content, Node } from "./syntax/classifier.js";
export { findTopLevelSeparator, isBlockOpen, isConditionParen, isInsideLocStringLiteral, isLocStringLiteral, isSignatureParameterList, isStatementCall, isUnary, splitSegments } from "./syntax/query.js";
export { concat, group, hardline, ifBreak, indent, join, line, nil, printDoc, softline, text } from "./print/doc.js";
export type { Doc } from "./print/doc.js";
export { emit } from "./print/emit/index.js";
export { shouldSpaceBefore } from "./syntax/spacing.js";
export { collectImports, ImportKind, renderImports } from "./format/imports.js";
export { normalize } from "./print/normalize.js";
export { formatSource } from "./format/format.js";
export { defaultCompilerPath, runCompilerOracle } from "./cli/oracle.js";
export type { OracleOptions, OracleResult } from "./cli/oracle.js";
export { DEFAULT_LINT_OPTIONS, lintDocument, lintSource } from "./lint/index.js";
export type { Diagnostic, Edit, LintOptions, Severity } from "./lint/index.js";
export { DEFAULT_CONFIG, resolveConfig } from "./format/config.js";
export type { BracketSpacing, CallBreakStyle, Config, EndOfLine, TrailingComma, WrapMode } from "./format/config.js";
export { main as runCli } from "./cli/cli.js";
