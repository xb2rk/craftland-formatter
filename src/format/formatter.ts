import { TokenId } from "../grammar/token-vocabulary.generated.js";
import { lex } from "../lex/lexer.js";
import { containsLineBreak, isTrivia } from "../lex/trivia.js";
import type { LexDiagnostic } from "../lex/diagnostic.js";
import type { Token } from "../lex/token.js";
import { parseGraphFile, parseHeaderFile } from "../parser/file-parser.js";
import type { ParseDiagnostic } from "../parser/diagnostic.js";
import { type AnySyntaxNode, type ExpressionNode, type BinaryExpressionNode, type NameNode, type ParenthesizedExpressionNode, type MapCompositeExpressionNode, type StructCompositeExpressionNode, astChildren, type SyntaxNode } from "../syntax/nodes.js";
import { sortHeaderImports } from "../imports/import-runs.js";
import { resolveFormatOptions, type FormatOptions, type ResolvedFormatOptions } from "./options.js";

export type { FormatOptions } from "./options.js";
export interface FormatResult { readonly code: string | undefined; readonly diagnostics: readonly (ParseDiagnostic | LexDiagnostic)[]; readonly changed: boolean; }

/** Format one validated `.fcc` or `.fcg` source. */
export function formatSource(source: string, options: FormatOptions = {}): FormatResult {
  const resolved = resolveFormatOptions(options);
  let input = source.replace(/^\uFEFF/u, "");
  let lexed = lex(input);
  if (lexed.diagnostics.length) return { code: undefined, diagnostics: lexed.diagnostics, changed: false };
  const isHeader = options.fileKind === "fcc" || (options.fileKind === undefined && options.fileName?.toLowerCase().endsWith(".fcc"));
  let parsed = isHeader ? parseHeaderFile(lexed) : parseGraphFile(lexed);
  if (parsed.diagnostics.length || !parsed.node) return { code: undefined, diagnostics: parsed.diagnostics, changed: false };
  const normalizedImports = sortHeaderImports(input, lexed.tokens, parsed.node.imports);
  if (normalizedImports !== input) {
    input = normalizedImports;
    lexed = lex(input);
    if (lexed.diagnostics.length) return { code: undefined, diagnostics: lexed.diagnostics, changed: false };
    parsed = isHeader ? parseHeaderFile(lexed) : parseGraphFile(lexed);
    if (parsed.diagnostics.length || !parsed.node) return { code: undefined, diagnostics: parsed.diagnostics, changed: false };
  }
  const code = new TokenFormatter(lexed.tokens, parsed.node, resolved).format();
  return { code, diagnostics: [], changed: code !== source };
}

interface Frame {
  kind: "paren" | "index" | "decorator" | "block" | "composite";
  broken: boolean;
  indent: number;
  parentIndent: number;
  bareCall: boolean;
  call: boolean;
  startColumn: number;
  nested: boolean;
  openOffset?: number;
}

type CallFamily = "bare" | "value";

interface LogicalHeader {
  firstIndex: number;
  lastIndex: number;
  operatorOffsets: readonly number[];
}

interface CompositeSeparatorAlignment {
  readonly keyWidth: number;
  readonly openOffset: number;
}

type InlineWriter = Readonly<{
  trim(): void;
  space(): void;
  write(value: string): void;
}>;

const COMPOSITE_NODE_KINDS = new Set([
  "positional-composite-expression",
  "map-composite-expression",
  "struct-composite-expression",
  "loc-string-expression",
]);

const BLOCK_NODE_KINDS = new Set([
  "block",
  "graph-declaration",
  "tuple-declaration",
  "component-declaration",
  "enum-declaration",
  "declare-graph",
]);

class TokenFormatter {
  private readonly significant: Token[];
  private readonly blocks = new Set<number>();
  private readonly composites = new Set<number>();
  private readonly locStrings = new Set<number>();
  private readonly genericOpens = new Set<number>();
  private readonly genericCloses = new Set<number>();
  private readonly genericCommas = new Set<number>();
  private readonly unaryOperators = new Set<number>();
  private readonly shiftLeadingTokens = new Set<number>();
  private readonly shiftTrailingTokens = new Set<number>();
  private readonly indexOpens = new Set<number>();
  private readonly decoratorOpens = new Set<number>();
  private readonly elseAfterBlockCloses = new Set<number>();
  private readonly callFamilies = new Map<number, CallFamily>();
  private readonly funcTypeParens = new Set<number>();
  private readonly callTrailingCommas = new Set<number>();
  private readonly compositeTrailingCommas = new Set<number>();
  private readonly matchingClose = new Map<number, number>();
  private readonly significantIndexByOffset = new Map<number, number>();
  private readonly significantIndexByEndOffset = new Map<number, number>();
  private readonly flatSuffixWidths = new Map<number, number>();
  /**
   * Bottom-up flat-width cache (D6 follow-up). For each matched open bracket,
   * the flat length of its inner range including the close token, computed
   * from a dummy one-char prefix so the first inner token observes the same
   * non-empty writer state as after the real open bracket. Lets
   * flatRangeWidth skip nested pairs in O(1) instead of rescanning them once
   * per enclosing level (which was O(depth x n) on nested composites).
   */
  private readonly pairInnerWidths = new Map<number, { readonly innerWidth: number; readonly closeIndex: number }>();
  private readonly logicalHeadersByStart = new Map<number, LogicalHeader>();
  private readonly breakAllLogicalOperators = new Set<number>();
  private readonly compositeSeparatorAlignments = new Map<number, CompositeSeparatorAlignment>();
  private readonly headerConditionTokens = new Set<number>();
  private readonly lineBreakBefore = new Map<number, number>();
  private readonly frames: Frame[] = [];
  private result = "";
  private previous: Token | undefined;
  private previousOffset = -1;
  private lineStart = true;
  private column = 0;
  private indent = 0;
  private activeLineIndent = 0;
  private nextLineIndent: number | undefined;
  private sourceBreak = false;

  constructor(private readonly tokens: readonly Token[], root: AnySyntaxNode, private readonly options: ResolvedFormatOptions) {
    this.significant = tokens.filter((token) => (isCommentToken(token) || !isTrivia(token)) && token.kind !== TokenId.EOF);
    this.significant.forEach((token, index) => {
      this.significantIndexByOffset.set(token.range.start.offset, index);
      this.significantIndexByEndOffset.set(token.range.end.offset, index);
    });
    let pendingBreaks = 0;
    for (const token of tokens) {
      if (isCommentToken(token)) {
        if (pendingBreaks) this.lineBreakBefore.set(token.range.start.offset, pendingBreaks);
        // Newlines inside a block/JSDoc comment belong to the protected token;
        // only trivia after the comment separates it from the next node.
        pendingBreaks = 0;
        continue;
      }
      if (isTrivia(token)) { pendingBreaks += (token.text.match(/\n/gu) ?? []).length; continue; }
      if (token.kind !== TokenId.EOF) { if (pendingBreaks) this.lineBreakBefore.set(token.range.start.offset, pendingBreaks); pendingBreaks = 0; }
    }
    this.collect(root);
    this.collectCallFamilies(root, "value");
    this.collectMatchingDelimiters();
    this.precomputePairInnerWidths();
  }

  format(): string {
    for (const token of this.significant) this.emit(token);
    this.trim();
    if (this.options.insertFinalNewline && this.result && !this.result.endsWith("\n")) this.result += "\n";
    if (!this.options.insertFinalNewline) this.result = this.result.replace(/\n+$/u, "");
    return this.result.replace(/[ \t]+\n/gu, "\n");
  }

  private collect(node: AnySyntaxNode | readonly AnySyntaxNode[]): void {
    if (Array.isArray(node)) { for (const item of node) this.collect(item); return; }
    const n = node as AnySyntaxNode;
    const kind = n.kind;
    if ("leftCurlyTokenIndex" in n) {
      const open = n.leftCurlyTokenIndex;
      if (typeof open === "number") {
        const token = this.tokens[open];
        if (token && COMPOSITE_NODE_KINDS.has(kind)) this.composites.add(token.range.start.offset);
        if (token && BLOCK_NODE_KINDS.has(kind)) this.blocks.add(token.range.start.offset);
        if (token && kind === "loc-string-expression") this.locStrings.add(token.range.start.offset);
      }
    }
    if ("trailingCommaTokenIndex" in n && COMPOSITE_NODE_KINDS.has(kind)) {
      const trailingComma = this.tokenAt(n.trailingCommaTokenIndex);
      if (trailingComma) this.compositeTrailingCommas.add(trailingComma.range.start.offset);
    }
    if ("closeAngleTokenIndex" in n) {
      const close = this.tokenAt(n.closeAngleTokenIndex);
      if (close) this.genericCloses.add(close.range.start.offset);
    }
    if ("openAngleTokenIndex" in n) {
      const genericOpen = this.tokenAt(n.openAngleTokenIndex);
      if (genericOpen) this.genericOpens.add(genericOpen.range.start.offset);
    }
    if (kind === "generic-type") {
      for (const commaTokenIndex of n.commaTokenIndices) {
        const token = this.tokens[commaTokenIndex];
        if (token) this.genericCommas.add(token.range.start.offset);
      }
    }
    if (kind === "unary-expression") {
      const operator = this.tokens[n.operatorTokenIndex];
      if (operator) this.unaryOperators.add(operator.range.start.offset);
    }
    if (kind === "binary-expression" && n.operatorTokenIndices.length === 2) {
      const [firstIndex, secondIndex] = n.operatorTokenIndices;
      const first = typeof firstIndex === "number" ? this.tokens[firstIndex] : undefined;
      const second = typeof secondIndex === "number" ? this.tokens[secondIndex] : undefined;
      // The parser, rather than source adjacency, proves that this is a shift.
      // This deliberately repairs valid but ugly `a < < b` / `a > > b` input.
      if (first && second && first.kind === second.kind && (first.kind === TokenId.LESS || first.kind === TokenId.GREATER)) {
        this.shiftLeadingTokens.add(first.range.start.offset);
        this.shiftTrailingTokens.add(second.range.start.offset);
      }
    }
    if (kind === "index-expression" || kind === "decorator") {
      const leftBracket = this.tokens[n.leftBracketTokenIndex];
      if (leftBracket) (kind === "index-expression" ? this.indexOpens : this.decoratorOpens).add(leftBracket.range.start.offset);
    }
    if (kind === "function-type") {
      const leftParen = this.tokenAt(n.leftParenTokenIndex);
      if (leftParen) this.funcTypeParens.add(leftParen.range.start.offset);
    }
    if (kind === "if-statement" && typeof n.elseTokenIndex === "number") {
      const rightCurlyTokenIndex = n.consequent?.rightCurlyTokenIndex;
      const rightCurly = typeof rightCurlyTokenIndex === "number" ? this.tokens[rightCurlyTokenIndex] : undefined;
      if (rightCurly) this.elseAfterBlockCloses.add(rightCurly.range.start.offset);
    }
    if (kind === "if-statement" || kind === "while-statement") {
      this.collectHeaderConditionTokens(n.condition);
      this.collectLogicalHeader(n.condition);
    }
    if (kind === "map-composite-expression" || kind === "struct-composite-expression") {
      this.collectCompositeSeparatorAlignment(n);
    }
    for (const child of astChildren(n)) this.collect(child);
  }

  /**
   * Alignment is derived from parsed map/struct entry nodes, never from a
   * colon or equals token found by scanning text. It is only applied later if
   * this exact composite chooses multiline layout.
   */
  private collectCompositeSeparatorAlignment(node: MapCompositeExpressionNode | StructCompositeExpressionNode): void {
    const open = this.tokenAt(node.leftCurlyTokenIndex);
    if (!open) return;
    const candidates: readonly { readonly key: ExpressionNode | NameNode | undefined; readonly separatorTokenIndex: number | undefined }[] =
      node.kind === "map-composite-expression"
        ? node.entries.map((entry) => ({ key: entry.key, separatorTokenIndex: entry.colonTokenIndex }))
        : node.fields.map((field) => ({ key: field.name, separatorTokenIndex: field.assignTokenIndex }));
    const resolved = candidates.map((candidate) => ({
      keyWidth: this.flatNodeWidth(candidate.key),
      separator: this.tokenAt(candidate.separatorTokenIndex),
    }));
    if (!resolved.length || resolved.some((candidate) => !candidate.separator || !Number.isFinite(candidate.keyWidth))) return;
    const keyWidth = Math.max(...resolved.map((candidate) => candidate.keyWidth));
    for (const candidate of resolved) {
      const separator = candidate.separator;
      if (separator) this.compositeSeparatorAlignments.set(separator.range.start.offset, { keyWidth, openOffset: open.range.start.offset });
    }
  }

  private flatNodeWidth(value: SyntaxNode | undefined): number {
    if (!value) return Number.POSITIVE_INFINITY;
    const start = value.range.start.offset;
    const end = value.range.end.offset;
    const firstIndex = this.significantIndexByOffset.get(start);
    const lastIndex = this.significantIndexByEndOffset.get(end);
    return firstIndex === undefined || lastIndex === undefined ? Number.POSITIVE_INFINITY : this.flatRangeWidth(firstIndex, lastIndex);
  }

  private tokenAt(index: unknown): Token | undefined {
    return typeof index === "number" ? this.tokens[index] : undefined;
  }

  private emit(token: Token): void {
    const breakCount = this.lineBreakBefore.get(token.range.start.offset) ?? 0;
    const precedingCommentAlreadyEndedLine = breakCount === 1 && this.previous !== undefined && this.commentEndsLine(this.previous);
    this.sourceBreak = this.sourceBreak || (breakCount > 0 && !precedingCommentAlreadyEndedLine);
    if (breakCount > 1) this.sourceLineBreaks(breakCount);
    this.beginLogicalHeaderCondition(token);
    switch (token.kind) {
      case TokenId.LINE_COMMENT: case TokenId.LINE_COMMENT_NLSEMI: if (this.sourceBreak) this.newline(); this.space(); this.write(token.text); this.newline(); break;
      case TokenId.COMMENT: case TokenId.COMMENT_NLSEMI: if (this.sourceBreak) this.newline(); this.space(); this.write(token.text); if (containsLineBreak(token) || token.text.includes("\n")) this.newline(); break;
      case TokenId.L_CURLY: this.openCurly(token); break;
      case TokenId.R_CURLY: this.closeCurly(token); break;
      case TokenId.L_PAREN: if (this.sourceBreak && !this.headerConditionTokens.has(token.range.start.offset) && this.frames.at(-1)?.kind === "block") this.newline(); this.openParen(token); break;
      case TokenId.R_PAREN: this.closeParen(); break;
      case TokenId.L_BRACKET: this.openBracket(token); break;
      case TokenId.R_BRACKET: this.pop("index", "decorator"); this.trim(); this.write("]"); break;
      case TokenId.COMMA: this.comma(token); break;
      case TokenId.SEMI: this.newline(); break;
      case TokenId.DOT: this.trim(); this.write("."); break;
      case TokenId.COLON: if (!this.writeAlignedCompositeSeparator(token, ": ")) { this.trim(); this.write(": "); } break;
      case TokenId.ASSIGN: if (!this.writeAlignedCompositeSeparator(token, this.options.spaceAroundOperators ? " = " : "=")) this.wordOrOperator(token); break;
      case TokenId.LESS: if (this.genericOpens.has(token.range.start.offset)) { this.trim(); this.write("<"); } else if (this.shiftLeadingTokens.has(token.range.start.offset)) this.shiftOperator(token); else if (!this.shiftTrailingTokens.has(token.range.start.offset)) this.wordOrOperator(token); break;
      case TokenId.GREATER: if (this.genericCloses.has(token.range.start.offset)) { this.trim(); this.write(">"); } else if (this.shiftLeadingTokens.has(token.range.start.offset)) this.shiftOperator(token); else if (!this.shiftTrailingTokens.has(token.range.start.offset)) this.wordOrOperator(token); break;
      default: this.wordOrOperator(token); break;
    }
    this.previous = token; this.previousOffset = token.range.start.offset; this.sourceBreak = false;
  }

  private openCurly(token: Token): void {
    const block = this.blocks.has(token.range.start.offset);
    const composite = this.composites.has(token.range.start.offset);
    if (!block && !composite) throw new Error(`Missing AST brace role at ${token.range.start.offset}.`);
    if (block) {
      this.space(); this.write("{"); this.newline(); this.indent += 1;
      this.frames.push({ kind: "block", broken: false, indent: this.indent, parentIndent: this.indent - 1, bareCall: false, call: false, nested: false, startColumn: this.column });
    } else {
      const nested = this.hasBreakableFrame();
      const locString = this.locStrings.has(token.range.start.offset);
      if (this.groupNeedsLeadingSpace(this.previous, token)) this.space(); else this.trim();
      this.write("{");
      const frame: Frame = { kind: "composite", broken: false, indent: this.activeLineIndent + 1, parentIndent: this.indent, bareCall: false, call: false, nested, startColumn: this.column, openOffset: token.range.start.offset };
      this.frames.push(frame);
      if (!locString && this.shouldBreakCompositeAtOpen(frame, token.range.start.offset)) {
        frame.broken = true;
        this.newline();
        this.indent = frame.indent;
      }
    }
  }

  private closeCurly(token: Token): void {
    const frame = this.pop("block", "composite");
    if (frame?.kind === "block") { if (!this.lineStart) this.newline(); this.indent = frame.parentIndent; this.write("}"); if (this.elseAfterBlockCloses.has(token.range.start.offset)) this.write(" "); else this.newline(); }
    else {
      if (frame?.broken) {
        this.trim();
        if (!/,\s*$/u.test(this.result)) this.write(",");
        this.newline();
        this.indent = frame.parentIndent;
      }
      this.trim(); this.write("}");
    }
  }

  private openParen(token: Token): void {
    const nested = this.hasBreakableFrame();
    if (this.groupNeedsLeadingSpace(this.previous, token)) this.space();
    else this.trim();
    this.write("(");
    const family = this.callFamilies.get(token.range.start.offset);
    const frame: Frame = {
      kind: "paren",
      broken: false,
      indent: this.activeLineIndent + 1,
      parentIndent: this.indent,
      bareCall: family === "bare",
      call: family !== undefined,
      nested,
      startColumn: this.column,
    };
    this.frames.push(frame);
    if (frame.call && this.shouldBreakAtOpen(frame, token.range.start.offset)) {
      frame.broken = true;
      this.newline();
      this.indent = frame.indent;
    }
  }

  private openBracket(token: Token): void {
    if (this.sourceBreak && this.previous?.kind === TokenId.R_BRACKET && (this.frames.length === 0 || this.frames.at(-1)?.kind === "block")) this.newline();
    const kind = this.indexOpens.has(token.range.start.offset) ? "index" : this.decoratorOpens.has(token.range.start.offset) ? "decorator" : undefined;
    if (!kind) throw new Error(`Missing AST bracket role at ${token.range.start.offset}.`);
    const nested = this.hasBreakableFrame();
    this.trim();
    this.write("[");
    this.frames.push({ kind, broken: false, indent: this.activeLineIndent + 1, parentIndent: this.indent, bareCall: false, call: false, nested, startColumn: this.column });
  }

  private closeParen(): void {
    const frame = this.pop("paren");
    if (frame?.broken && frame.bareCall) {
      this.trim();
      if (!/,\s*$/u.test(this.result)) this.write(",");
      this.newline();
      this.indent = frame.parentIndent;
    }
    this.trim(); this.write(")");
    if (frame) this.indent = frame.parentIndent;
  }

  private comma(token: Token): void {
    if (this.callTrailingCommas.has(token.range.start.offset) || this.compositeTrailingCommas.has(token.range.start.offset)) return;
    if (this.genericCommas.has(token.range.start.offset)) {
      this.trim(); this.write(",");
      if (this.options.spaceAfterComma) this.write(" ");
      return;
    }
    this.trim(); this.write(","); const frame = this.frames.at(-1);
    if (frame && (frame.kind === "paren" || frame.kind === "composite") && frame.broken) { this.newline(); this.indent = frame.indent; }
    else if (this.options.spaceAfterComma) this.write(" ");
  }

  private writeAlignedCompositeSeparator(token: Token, separator: string): boolean {
    const alignment = this.compositeSeparatorAlignments.get(token.range.start.offset);
    const frame = this.frames.at(-1);
    if (!alignment || frame?.kind !== "composite" || !frame.broken || frame.openOffset !== alignment.openOffset) return false;
    this.trim();
    const keyWidth = this.column - this.activeLineIndent * this.options.tabWidth;
    if (keyWidth < alignment.keyWidth) this.write(" ".repeat(alignment.keyWidth - keyWidth));
    this.write(separator);
    return true;
  }

  private wordOrOperator(token: Token): void {
    if (this.sourceBreak && this.previous && !this.headerConditionTokens.has(token.range.start.offset) && (!this.isOperator(this.previous.kind) || this.genericCloses.has(this.previous.range.start.offset) || this.previous.kind === TokenId.PLUS_PLUS || this.previous.kind === TokenId.MINUS_MINUS) && (this.frames.length === 0 || this.frames.at(-1)?.kind === "block") && !(token.kind === TokenId.ELSE && this.previous.kind === TokenId.R_CURLY)) this.newline();
    this.writeInlineToken(token, this.previous, this.previousOffset, {
      trim: () => this.trim(),
      space: () => this.space(),
      write: (value) => this.write(value),
    });
    if (this.breakAllLogicalOperators.has(token.range.start.offset)) this.newlineAtIndent(this.indent + 1);
  }

  private shiftOperator(token: Token): void {
    if (this.sourceBreak && this.previous && !this.headerConditionTokens.has(token.range.start.offset) && (!this.isOperator(this.previous.kind) || this.genericCloses.has(this.previous.range.start.offset) || this.previous.kind === TokenId.PLUS_PLUS || this.previous.kind === TokenId.MINUS_MINUS) && (this.frames.length === 0 || this.frames.at(-1)?.kind === "block")) this.newline();
    this.trim();
    if (this.options.spaceAroundOperators) this.space();
    this.write(token.text + token.text);
    if (this.options.spaceAroundOperators) this.write(" ");
  }

  private isOperator(kind: number): boolean { return ([TokenId.PLUS_PLUS, TokenId.MINUS_MINUS, TokenId.DECLARE_ASSIGN, TokenId.LOGICAL_OR, TokenId.LOGICAL_AND, TokenId.EQUALS, TokenId.NOT_EQUALS, TokenId.LESS, TokenId.LESS_OR_EQUALS, TokenId.GREATER, TokenId.GREATER_OR_EQUALS, TokenId.ASSIGN, TokenId.PLUS_ASSIGN, TokenId.MINUS_ASSIGN, TokenId.STAR_ASSIGN, TokenId.DIV_ASSIGN, TokenId.MOD_ASSIGN, TokenId.AND_ASSIGN, TokenId.XOR_ASSIGN, TokenId.OR_ASSIGN, TokenId.RSHIFT_ASSIGN, TokenId.LSHIFT_ASSIGN, TokenId.OR, TokenId.DIV, TokenId.MOD, TokenId.AND, TokenId.XOR, TokenId.EXCLAMATION, TokenId.BIT_NOT, TokenId.PLUS, TokenId.MINUS, TokenId.STAR] as number[]).includes(kind); }
  private isUnaryOperator(token: Token): boolean { return this.unaryOperators.has(token.range.start.offset); }
  private previousWasUnary(token: Token | undefined): boolean { return token !== undefined && this.isUnaryOperator(token); }
  private requiresTrailingSpace(kind: number): boolean { return ([TokenId.IF, TokenId.ELSE, TokenId.FOR, TokenId.WHILE, TokenId.RETURN, TokenId.VAR, TokenId.FUNC, TokenId.EVENT, TokenId.GRAPH, TokenId.STATIC, TokenId.ASYNC, TokenId.WAIT, TokenId.START, TokenId.AS, TokenId.IN, TokenId.OUT, TokenId.IMPORT, TokenId.FROM, TokenId.DEFINE, TokenId.ALIAS, TokenId.ENUM, TokenId.TUPLE, TokenId.COMPONENT, TokenId.DECLARE] as number[]).includes(kind); }
  private needsSpaceBeforeUnary(previous: Token | undefined): boolean {
    if (!previous) return false;
    if (previous.kind === TokenId.COMMA) return this.options.spaceAfterComma;
    if (previous.kind === TokenId.COLON || this.requiresTrailingSpace(previous.kind)) return true;
    return !this.genericCloses.has(previous.range.start.offset) && this.isOperator(previous.kind) && !this.isUnaryOperator(previous)
      ? this.options.spaceAroundOperators
      : false;
  }

  /**
   * The only resolver for non-punctuation token boundaries. Both the real
   * writer and flat-width simulation use it, so wrap decisions cannot invent
   * a different spelling for unary/binary/keyword boundaries.
   */
  private writeInlineToken(token: Token, previous: Token | undefined, previousOffset: number, writer: InlineWriter): void {
    if (this.isOperator(token.kind)) {
      if (this.isUnaryOperator(token)) {
        if (this.needsSpaceBeforeUnary(previous)) writer.space(); else writer.trim();
        writer.write(token.text);
        return;
      }
      if (this.options.spaceAroundOperators) {
        writer.space();
        writer.write(token.text);
        writer.write(" ");
        return;
      }
      if (this.genericCloses.has(previousOffset) && token.text.startsWith("=")) writer.space(); else writer.trim();
      writer.write(token.text);
      return;
    }
    // A word after a spaced binary operator must retain that operator's
    // already-emitted trailing space. Only punctuation/unary boundaries ask
    // for a forced tight join; ordinary words otherwise preserve the writer.
    if (this.wordNeedsLeadingSpace(previous)) writer.space();
    writer.write(token.text);
    if (this.requiresTrailingSpace(token.kind)) writer.write(" ");
  }

  private wordNeedsLeadingSpace(previous: Token | undefined): boolean {
    if (!previous) return false;
    if (previous.kind === TokenId.COMMA) return this.options.spaceAfterComma;
    return !([TokenId.L_PAREN, TokenId.L_BRACKET, TokenId.L_CURLY, TokenId.DOT] as number[]).includes(previous.kind)
      && !this.genericOpens.has(previous.range.start.offset)
      && !this.previousWasUnary(previous)
      && !this.isOperator(previous.kind);
  }

  private collectHeaderConditionTokens(node: ExpressionNode | undefined): void {
    if (!node) return;
    const startOffset = node.range.start.offset;
    const endOffset = node.range.end.offset;
    const firstIndex = this.significantIndexByOffset.get(startOffset);
    const lastIndex = this.significantIndexByEndOffset.get(endOffset);
    if (firstIndex === undefined || lastIndex === undefined) return;
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const token = this.significant[index];
      if (token) this.headerConditionTokens.add(token.range.start.offset);
    }
  }

  private collectLogicalHeader(condition: ExpressionNode | undefined): void {
    if (!condition) return;
    const startOffset = condition.range.start.offset;
    const endOffset = condition.range.end.offset;
    const firstIndex = this.significantIndexByOffset.get(startOffset);
    const lastIndex = this.significantIndexByEndOffset.get(endOffset);
    if (firstIndex === undefined || lastIndex === undefined) return;
    const operatorOffsets = this.directLogicalOperatorOffsets(condition, true);
    if (operatorOffsets.length) this.logicalHeadersByStart.set(this.significant[firstIndex]!.range.start.offset, { firstIndex, lastIndex, operatorOffsets });
  }

  /** Collect only the logical chain at this header level; parenthesized child groups stay independent. */
  private directLogicalOperatorOffsets(value: ExpressionNode | undefined, root = false): number[] {
    if (!value) return [];
    if (value.kind === "parenthesized-expression") return root ? this.directLogicalOperatorOffsets((value as ParenthesizedExpressionNode).expression) : [];
    if (value.kind !== "binary-expression") return [];
    const bin = value as BinaryExpressionNode;
    if (bin.operator !== TokenId.LOGICAL_AND && bin.operator !== TokenId.LOGICAL_OR) return [];
    const offsets: number[] = [];
    for (const tokenIndex of bin.operatorTokenIndices) {
      const token = this.tokens[tokenIndex];
      if (token) offsets.push(token.range.start.offset);
    }
    return [...this.directLogicalOperatorOffsets(bin.left), ...offsets, ...this.directLogicalOperatorOffsets(bin.right)];
  }

  private beginLogicalHeaderCondition(token: Token): void {
    const header = this.logicalHeadersByStart.get(token.range.start.offset);
    if (!header) return;
    // The opening block must remain on this header's final physical line, so
    // include its mandatory " {" when deciding whether a flat header fits.
    const conditionWidth = this.flatRangeWidth(header.firstIndex, header.lastIndex);
    if (!Number.isFinite(conditionWidth) || this.column + conditionWidth + 2 > this.options.printWidth) {
      for (const offset of header.operatorOffsets) this.breakAllLogicalOperators.add(offset);
    }
  }
  private collectCallFamilies(value: AnySyntaxNode | readonly AnySyntaxNode[] | undefined, family: CallFamily): void {
    if (!value) return;
    if (Array.isArray(value)) { for (const item of value) this.collectCallFamilies(item, family); return; }
    const node = value as AnySyntaxNode;
    const kind = node.kind;
    if (kind === "expression-statement") {
      const expression = (node as { expression?: ExpressionNode }).expression;
      const expressionKind = expression?.kind ?? "";
      this.collectCallFamilies(expression, expressionKind === "call-expression" || expressionKind === "prefixed-call-expression" ? "bare" : "value");
      return;
    }
    if (kind === "return-statement" || kind === "variable-statement") {
      this.collectCallFamilies((node as { expression?: ExpressionNode; value?: ExpressionNode }).expression ?? (node as { value?: ExpressionNode }).value, "value");
      return;
    }
    if (kind === "assignment-statement") {
      this.collectCallFamilies((node as { left?: ExpressionNode }).left, "value");
      this.collectCallFamilies((node as { right?: ExpressionNode }).right, "value");
      return;
    }
    if (kind === "call-expression") {
      const callNode = node as { leftParenTokenIndex?: number; trailingCommaTokenIndex?: number; callee?: ExpressionNode; arguments?: readonly AnySyntaxNode[] };
      const leftParenTokenIndex = callNode.leftParenTokenIndex;
      const leftParen = typeof leftParenTokenIndex === "number" ? this.tokens[leftParenTokenIndex] : undefined;
      if (leftParen) {
        this.callFamilies.set(leftParen.range.start.offset, family);
        const trailingCommaTokenIndex = callNode.trailingCommaTokenIndex;
        const trailingComma = typeof trailingCommaTokenIndex === "number" ? this.tokens[trailingCommaTokenIndex] : undefined;
        if (trailingComma) this.callTrailingCommas.add(trailingComma.range.start.offset);
      }
      this.collectCallFamilies(callNode.callee, "value");
      this.collectCallFamilies(callNode.arguments, "value");
      return;
    }
    if (kind === "prefixed-call-expression") {
      this.collectCallFamilies((node as { call?: AnySyntaxNode }).call, family);
      return;
    }
    for (const child of astChildren(node)) this.collectCallFamilies(child, family);
  }

  private hasBreakableFrame(): boolean {
    return this.frames.some((frame) => frame.kind === "paren" || frame.kind === "composite");
  }

  private commentEndsLine(token: Token): boolean {
    return isCommentToken(token) && (token.kind === TokenId.LINE_COMMENT || token.kind === TokenId.LINE_COMMENT_NLSEMI || containsLineBreak(token) || token.text.includes("\n"));
  }

  /**
   * Single decision point for whether an opening grouping token joins its
   * predecessor tightly or with a space. The real writer (openParen/openCurly)
   * and the flat-width simulation consult this same rule, so width estimates
   * can never drift from emitted output.
   */
  private groupNeedsLeadingSpace(previous: Token | undefined, token: Token): boolean {
    if (this.funcTypeParens.has(token.range.start.offset)) return false;
    if (token.kind === TokenId.L_CURLY && this.blocks.has(token.range.start.offset)) return true;
    return this.openingGroupNeedsLeadingSpace(previous);
  }

  private openingGroupNeedsLeadingSpace(previous: Token | undefined = this.previous): boolean {
    if (!previous) return false;
    if (previous.kind === TokenId.COMMA) return this.options.spaceAfterComma;
    if (this.requiresTrailingSpace(previous.kind)) return true;
    return !this.genericCloses.has(previous.range.start.offset) && this.isOperator(previous.kind) && !this.isUnaryOperator(previous)
      ? this.options.spaceAroundOperators
      : false;
  }

  private pop(...kinds: Frame["kind"][]): Frame | undefined { const frame = this.frames.at(-1); return frame && kinds.includes(frame.kind) ? this.frames.pop() : undefined; }
  private shouldBreakAtOpen(frame: Frame, openOffset: number): boolean {
    const mode = this.options.wrapCalls;
    if (mode === "never") return false;
    const suffixWidth = this.flatSuffixWidth(openOffset);
    if (mode === "always") return suffixWidth > 1;
    if (!Number.isFinite(suffixWidth)) return true;
    if (suffixWidth <= 1) return false;
    return frame.nested ? suffixWidth > this.options.printWidth : this.column + suffixWidth > this.options.printWidth;
  }

  private shouldBreakCompositeAtOpen(frame: Frame, openOffset: number): boolean {
    const mode = this.options.wrapCollections;
    if (mode === "never") return false;
    const suffixWidth = this.flatSuffixWidth(openOffset);
    if (mode === "always") return suffixWidth > 1;
    if (!Number.isFinite(suffixWidth)) return true;
    if (suffixWidth <= 1) return false;
    return frame.nested ? suffixWidth > this.options.printWidth : this.column + suffixWidth > this.options.printWidth;
  }

  /**
   * Bottom-up pass over matched delimiter pairs, innermost first. Each
   * pair's inner width is computed once with deeper pairs already cached,
   * so every token is directly scanned exactly once and later queries skip
   * nested pairs in O(1). Total precompute cost is O(n). Suffix widths are
   * cached in the same pass, so emit-time break decisions are pure lookups.
   */
  private precomputePairInnerWidths(): void {
    const pairs: { readonly openOffset: number; readonly openIndex: number; readonly closeIndex: number }[] = [];
    for (const [openOffset, closeOffset] of this.matchingClose) {
      const openIndex = this.significantIndexByOffset.get(openOffset);
      const closeIndex = this.significantIndexByOffset.get(closeOffset);
      if (openIndex === undefined || closeIndex === undefined) continue;
      pairs.push({ openOffset, openIndex, closeIndex });
    }
    pairs.sort((a, b) => b.openIndex - a.openIndex);
    for (const pair of pairs) {
      const open = this.significant[pair.openIndex];
      if (!open) continue;
      // Dummy one-char prefix: the first inner token then observes a
      // non-empty writer ending in a non-space char, exactly as after the
      // real open bracket, so the cached width splices exactly. Subtract the
      // dummy char back out (trim only touches the end, never the prefix).
      const rendered = this.flatRangeWidth(pair.openIndex + 1, pair.closeIndex, open, "(");
      // The inner scan covers exactly the suffix range and converges with the
      // suffix spelling after the first token (open brackets never take the
      // space branch), so innerWidth doubles as the suffix width: emit-time
      // break decisions become pure lookups with zero additional scans.
      const innerWidth = Number.isFinite(rendered) ? rendered - 1 : rendered;
      this.pairInnerWidths.set(pair.openOffset, { innerWidth, closeIndex: pair.closeIndex });
      this.flatSuffixWidths.set(pair.openOffset, innerWidth);
    }
  }

  /**
   * O(1) nested-pair skip for flatRangeWidth. Returns undefined when the
   * open bracket has no cached pair (unmatched); the caller then scans
   * normally. An infinite inner width propagates: the caller must return
   * INFINITY, matching what the scan would do at the inner comment.
   */
  private trySkipPair(open: Token): { readonly innerWidth: number; readonly close: Token; readonly closeIndex: number } | undefined {
    const cached = this.pairInnerWidths.get(open.range.start.offset);
    if (cached === undefined) return undefined;
    const close = this.significant[cached.closeIndex];
    if (!close) return undefined;
    return { innerWidth: cached.innerWidth, close, closeIndex: cached.closeIndex };
  }

  private flatSuffixWidth(openOffset: number): number {
    const cached = this.flatSuffixWidths.get(openOffset);
    if (cached !== undefined) return cached;
    const closeOffset = this.matchingClose.get(openOffset);
    const openIndex = this.significantIndexByOffset.get(openOffset);
    const closeIndex = closeOffset === undefined ? undefined : this.significantIndexByOffset.get(closeOffset);
    if (openIndex === undefined || closeIndex === undefined) return Number.POSITIVE_INFINITY;
    const width = this.flatRangeWidth(openIndex + 1, closeIndex);
    this.flatSuffixWidths.set(openOffset, width);
    return width;
  }

  private flatRangeWidth(firstIndex: number, lastIndex: number, initialPrevious?: Token, initialText = ""): number {
    let flat = initialText;
    let extra = 0;
    let previous = initialPrevious;
    let previousOffset = initialPrevious?.range.start.offset ?? -1;
    const trim = (): void => { flat = flat.replace(/[ \t]+$/u, ""); };
    const space = (): void => { if (flat && !flat.endsWith(" ")) flat += " "; };
    const write = (value: string): void => { flat += value; };
    const appendWordOrOperator = (token: Token): void => {
      this.writeInlineToken(token, previous, previousOffset, { trim, space, write });
    };
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const token = this.significant[index];
      if (!token) continue;
      if (this.callTrailingCommas.has(token.range.start.offset) || this.compositeTrailingCommas.has(token.range.start.offset)) continue;
      if (isCommentToken(token)) { if (token.text.includes("\n") || token.kind === TokenId.LINE_COMMENT || token.kind === TokenId.LINE_COMMENT_NLSEMI) return Number.POSITIVE_INFINITY; space(); write(token.text); previous = token; previousOffset = token.range.start.offset; continue; }
      switch (token.kind) {
        case TokenId.L_PAREN: {
          if (this.groupNeedsLeadingSpace(previous, token)) space(); else trim(); write("(");
          const skip = this.trySkipPair(token);
          if (skip) {
            if (!Number.isFinite(skip.innerWidth)) return Number.POSITIVE_INFINITY;
            extra += skip.innerWidth;
            previous = skip.close;
            previousOffset = skip.close.range.start.offset;
            index = skip.closeIndex;
          }
          break;
        }
        case TokenId.R_PAREN: trim(); write(")"); break;
        case TokenId.L_BRACKET: {
          trim(); write("[");
          const skip = this.trySkipPair(token);
          if (skip) {
            if (!Number.isFinite(skip.innerWidth)) return Number.POSITIVE_INFINITY;
            extra += skip.innerWidth;
            previous = skip.close;
            previousOffset = skip.close.range.start.offset;
            index = skip.closeIndex;
          }
          break;
        }
        case TokenId.R_BRACKET: trim(); write("]"); break;
        case TokenId.L_CURLY: {
          if (this.groupNeedsLeadingSpace(previous, token)) { space(); write("{"); } else { trim(); write("{"); }
          const skip = this.trySkipPair(token);
          if (skip) {
            if (!Number.isFinite(skip.innerWidth)) return Number.POSITIVE_INFINITY;
            extra += skip.innerWidth;
            previous = skip.close;
            previousOffset = skip.close.range.start.offset;
            index = skip.closeIndex;
          }
          break;
        }
        case TokenId.R_CURLY: trim(); write("}"); break;
        case TokenId.COMMA: trim(); write(","); if (this.options.spaceAfterComma) write(" "); break;
        case TokenId.DOT: trim(); write("."); break;
        case TokenId.COLON: trim(); write(": "); break;
        case TokenId.LESS: if (this.genericOpens.has(token.range.start.offset)) { trim(); write("<"); } else if (this.shiftLeadingTokens.has(token.range.start.offset)) { trim(); if (this.options.spaceAroundOperators) space(); write("<<"); if (this.options.spaceAroundOperators) write(" "); } else if (!this.shiftTrailingTokens.has(token.range.start.offset)) appendWordOrOperator(token); break;
        case TokenId.GREATER: if (this.genericCloses.has(token.range.start.offset)) { trim(); write(">"); } else if (this.shiftLeadingTokens.has(token.range.start.offset)) { trim(); if (this.options.spaceAroundOperators) space(); write(">>"); if (this.options.spaceAroundOperators) write(" "); } else if (!this.shiftTrailingTokens.has(token.range.start.offset)) appendWordOrOperator(token); break;
        default: appendWordOrOperator(token); break;
      }
      previous = token; previousOffset = token.range.start.offset;
    }
    trim();
    return flat.length + extra;
  }

  private collectMatchingDelimiters(): void {
    const stack: { kind: TokenId; offset: number }[] = [];
    const opens = new Set<number>([TokenId.L_PAREN, TokenId.L_BRACKET, TokenId.L_CURLY]);
    const closes = new Map<number, number>([[TokenId.R_PAREN, TokenId.L_PAREN], [TokenId.R_BRACKET, TokenId.L_BRACKET], [TokenId.R_CURLY, TokenId.L_CURLY]]);
    for (const token of this.significant) {
      if (opens.has(token.kind)) { stack.push({ kind: token.kind as TokenId, offset: token.range.start.offset }); continue; }
      const openingKind = closes.get(token.kind);
      if (openingKind === undefined) continue;
      const top = stack.at(-1);
      if (top?.kind !== openingKind) continue;
      stack.pop();
      this.matchingClose.set(top.offset, token.range.start.offset);
    }
  }

  private sourceLineBreaks(count: number): void { this.newline(); const desired = this.options.collapseBlankLines ? 2 : count; const trailing = this.result.match(/\n*$/u)?.[0].length ?? 0; this.result += "\n".repeat(Math.max(0, desired - trailing)); }
  private write(value: string): void { if (this.lineStart) { const lineIndent = this.nextLineIndent ?? this.indent; const prefix = (this.options.useTabs ? "\t" : " ".repeat(this.options.tabWidth)).repeat(lineIndent); this.result += prefix; this.column = lineIndent * this.options.tabWidth; this.activeLineIndent = lineIndent; this.lineStart = false; this.nextLineIndent = undefined; } this.result += value; this.column += value.length; }
  private space(): void { if (!this.lineStart && !this.result.endsWith(" ") && !this.result.endsWith("\n")) { this.result += " "; this.column += 1; } }
  private trim(): void { this.result = this.result.replace(/[ \t]+$/u, ""); }
  private newline(): void { this.trim(); if (!this.result.endsWith("\n")) this.result += "\n"; this.column = 0; this.lineStart = true; this.nextLineIndent = undefined; }
  private newlineAtIndent(indent: number): void { this.newline(); this.nextLineIndent = indent; }
}

function isCommentToken(token: Token): boolean {
  return token.kind === TokenId.COMMENT || token.kind === TokenId.COMMENT_NLSEMI || token.kind === TokenId.LINE_COMMENT || token.kind === TokenId.LINE_COMMENT_NLSEMI;
}
