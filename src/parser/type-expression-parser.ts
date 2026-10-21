import { TokenId, type TokenId as TokenKind } from "../grammar/token-vocabulary.generated.js";
import type { LexResult } from "../lex/lexer.js";
import type { SourceRange } from "../lex/position.js";
import type { Token } from "../lex/token.js";
import { containsLineBreak, isTrivia } from "../lex/trivia.js";
import type {
  BinaryExpressionNode,
  CallArgumentNode,
  CallExpressionNode,
  DomainTypeNode,
  ExpressionNode,
  FunctionTypeParameterNode,
  FunctionTypeNode,
  GenericAccessExpressionNode,
  GenericTypeNode,
  LocStringExpressionNode,
  MapCompositeEntryNode,
  MapCompositeExpressionNode,
  NameNode,
  OutVarArgumentNode,
  PositionalCompositeExpressionNode,
  QualifiedNameNode,
  StructCompositeExpressionNode,
  StructCompositeFieldNode,
  SyntaxNode,
  TypeCoreNode,
} from "../syntax/nodes.js";
import { ParserCursor, type CursorToken } from "./cursor.js";
import type { ParseDiagnostic, ParseDiagnosticCode } from "./diagnostic.js";

export interface ParseResult<TNode> {
  readonly consumedThroughEof: boolean;
  readonly diagnostics: readonly ParseDiagnostic[];
  readonly node: TNode | undefined;
}

const GENERAL_IDENTIFIER_KINDS = new Set<number>([
  TokenId.ELEMENT,
  TokenId.FROM,
  TokenId.TYPE,
  TokenId.COLOR,
  TokenId.LIST,
  TokenId.MAP,
  TokenId.ENTITY,
  TokenId.IDENTIFIER,
]);

const RESERVED_SCALAR_TYPE_KINDS = new Set<number>([
  TokenId.OBJECT,
  TokenId.BOOL,
  TokenId.INT,
  TokenId.INT64,
  TokenId.FLOAT,
  TokenId.STRING,
  TokenId.VECTOR2,
  TokenId.VECTOR3,
  TokenId.QUATERNION,
  TokenId.LOC_STRING,
  TokenId.STRUCT,
  TokenId.EXPORT,
]);

const LITERAL_KINDS = new Map<number, "boolean" | "color" | "float" | "imaginary" | "integer" | "nil" | "raw-string" | "rune" | "string">([
  [TokenId.TRUE, "boolean"], [TokenId.FALSE, "boolean"], [TokenId.NIL_LIT, "nil"],
  [TokenId.DECIMAL_LIT, "integer"], [TokenId.BINARY_LIT, "integer"], [TokenId.OCTAL_LIT, "integer"], [TokenId.HEX_LIT, "integer"],
  [TokenId.FLOAT_LIT, "float"], [TokenId.DECIMAL_FLOAT_LIT, "float"], [TokenId.HEX_FLOAT_LIT, "float"],
  [TokenId.IMAGINARY_LIT, "imaginary"], [TokenId.COLOR_HEX_LIT, "color"], [TokenId.RUNE_LIT, "rune"],
  [TokenId.BYTE_VALUE, "rune"], [TokenId.OCTAL_BYTE_VALUE, "rune"], [TokenId.HEX_BYTE_VALUE, "rune"],
  [TokenId.LITTLE_U_VALUE, "rune"], [TokenId.BIG_U_VALUE, "rune"],
  [TokenId.RAW_STRING_LIT, "raw-string"], [TokenId.INTERPRETED_STRING_LIT, "string"],
]);

const BINARY_PRECEDENCE = new Map<number, number>([
  [TokenId.LOGICAL_OR, 1], [TokenId.LOGICAL_AND, 2],
  [TokenId.EQUALS, 3], [TokenId.NOT_EQUALS, 3], [TokenId.LESS, 3], [TokenId.LESS_OR_EQUALS, 3], [TokenId.GREATER, 3], [TokenId.GREATER_OR_EQUALS, 3],
  [TokenId.OR, 4], [TokenId.XOR, 5], [TokenId.AND, 6],
  [TokenId.PLUS, 8], [TokenId.MINUS, 8], [TokenId.STAR, 9], [TokenId.DIV, 9], [TokenId.MOD, 9],
]);

const GENERIC_FOLLOWERS = new Set<number>([
  TokenId.DOT, TokenId.AS, TokenId.COMMA, TokenId.R_PAREN, TokenId.R_BRACKET,
  TokenId.R_CURLY, TokenId.SEMI, TokenId.EOF,
  TokenId.ASSIGN, TokenId.PLUS_ASSIGN, TokenId.MINUS_ASSIGN, TokenId.STAR_ASSIGN,
  TokenId.DIV_ASSIGN, TokenId.MOD_ASSIGN, TokenId.AND_ASSIGN, TokenId.XOR_ASSIGN,
  TokenId.OR_ASSIGN, TokenId.RSHIFT_ASSIGN, TokenId.LSHIFT_ASSIGN,
  TokenId.LOGICAL_OR, TokenId.LOGICAL_AND, TokenId.EQUALS, TokenId.NOT_EQUALS,
  TokenId.LESS, TokenId.LESS_OR_EQUALS, TokenId.GREATER, TokenId.GREATER_OR_EQUALS,
  TokenId.OR, TokenId.XOR, TokenId.AND, TokenId.PLUS, TokenId.MINUS, TokenId.STAR,
  TokenId.DIV, TokenId.MOD,
]);

const UNARY_OPERATOR_IDS = new Set<number>([
  TokenId.EXCLAMATION,
  TokenId.BIT_NOT,
  TokenId.PLUS,
  TokenId.MINUS,
]);

const TYPE_LIKE_EXPRESSION_NAME_IDS = new Set<number>([
  TokenId.VECTOR2,
  TokenId.VECTOR3,
  TokenId.QUATERNION,
  TokenId.LOC_STRING,
]);

const VECTOR_COMPOSITE_TYPE_IDS = new Set<number>([
  TokenId.VECTOR2,
  TokenId.VECTOR3,
  TokenId.QUATERNION,
]);

/** Parses one FC expression and requires the remaining significant input to be EOF. */
export function parseExpression(lexed: LexResult): ParseResult<ExpressionNode> {
  const parser = new TypeExpressionParser(lexed.tokens);
  const node = parser.parseExpression();
  parser.reportTrailingInput();
  return parser.result(node);
}

/** Parses one FC domain type and requires the remaining significant input to be EOF. */
export function parseDomainType(lexed: LexResult): ParseResult<DomainTypeNode> {
  const parser = new TypeExpressionParser(lexed.tokens);
  const node = parser.parseDomainType();
  parser.reportTrailingInput();
  return parser.result(node);
}

/** Shared recursive-descent kernel. File parsing extends this rather than reparsing text. */
export class TypeExpressionParser {
  protected readonly cursor: ParserCursor;
  protected readonly diagnostics: ParseDiagnostic[] = [];
  private errorFenceDepth = 0;
  private errorFencedOffsets: Set<number> | undefined;

  public constructor(protected readonly tokens: readonly Token[]) {
    this.cursor = new ParserCursor(tokens);
  }

  /**
   * Runs fn with the error fence raised. While raised, report() keeps only
   * the first diagnostic per source offset, collapsing same-token cascades
   * to one error per broken token. Bracketed loops (calls, signatures,
   * generics, composites, decorator arguments) run inside the fence together
   * with their terminal closing-token check, which otherwise re-reports the
   * same stuck token. The fence always lowers, even on throw.
   */
  protected withErrorFence<T>(fn: () => T): T {
    this.errorFenceDepth += 1;
    try {
      return fn();
    } finally {
      this.errorFenceDepth -= 1;
      if (this.errorFenceDepth === 0) this.errorFencedOffsets = undefined;
    }
  }

  /** Saves fence state alongside a cursor/diagnostics checkpoint. */
  protected saveErrorFence(): { readonly depth: number; readonly offsets: Set<number> | undefined; readonly size: number } {
    return { depth: this.errorFenceDepth, offsets: this.errorFencedOffsets, size: this.errorFencedOffsets?.size ?? 0 };
  }

  /**
   * Restores fence state saved alongside a cursor/diagnostics checkpoint.
   * Offsets recorded by the aborted speculation are truncated so they can
   * never suppress errors on the retry path.
   */
  protected restoreErrorFence(saved: { readonly depth: number; readonly offsets: Set<number> | undefined; readonly size: number }): void {
    this.errorFenceDepth = saved.depth;
    const current = this.errorFencedOffsets;
    if (current !== undefined && current === saved.offsets && current.size > saved.size) {
      for (const offset of [...current].slice(saved.size)) current.delete(offset);
    } else if (current !== saved.offsets) this.errorFencedOffsets = saved.offsets;
  }

  public result<TNode>(node: TNode | undefined): ParseResult<TNode> {
    return {
      consumedThroughEof: this.cursor.at(TokenId.EOF),
      diagnostics: this.diagnostics,
      node,
    };
  }

  public reportTrailingInput(): void {
    while (!this.cursor.at(TokenId.EOF)) {
      const current = this.cursor.advance();
      this.report("unexpected-token", `Unexpected token ${JSON.stringify(current.token.text)} after complete parse.`, current.token.range);
    }
  }

  public parseDomainType(): DomainTypeNode | undefined {
    const start = this.cursor.current().index;
    let domain: NameNode | undefined;
    let dotTokenIndex: number | undefined;

    if (this.isGeneralIdentifier() && this.cursor.peek(1).token.kind === TokenId.DOT) {
      domain = this.parseName();
      dotTokenIndex = this.consume(TokenId.DOT, "expected-token", "Expected '.' after type domain.")?.index;
    }

    const type = this.parseTypeCore();
    if (!type) {
      this.report("expected-type", "Expected an FC type.", this.cursor.current().token.range);
      return undefined;
    }

    return {
      ...this.nodeSpan("domain-type", start, this.lastTokenIndex(type)),
      domain,
      dotTokenIndex,
      type,
    };
  }

  public parseExpression(minimumPrecedence = 0, stopAtOpeningBlock = false, stopAtVirtualEos = false): ExpressionNode | undefined {
    let left = this.parsePrefixExpression(stopAtOpeningBlock);
    if (!left) return undefined;

    for (; ;) {
      if (stopAtVirtualEos && this.hasVirtualBoundaryAfter(left)) return left;
      const postfixed = this.parsePostfix(left, true, stopAtVirtualEos, stopAtOpeningBlock);
      if (postfixed !== left) {
        left = postfixed;
        continue;
      }

      if (this.cursor.at(TokenId.AS) && 15 >= minimumPrecedence) {
        const asToken = this.cursor.advance();
        const type = this.parseDomainType();
        left = {
          ...this.nodeSpan("cast-expression", this.firstTokenIndex(left), type ? this.lastTokenIndex(type) : asToken.index),
          asTokenIndex: asToken.index,
          expression: left,
          kind: "cast-expression",
          type,
        };
        continue;
      }

      const operator = this.peekBinaryOperator();
      if (!operator || operator.precedence < minimumPrecedence) return left;
      const operatorTokens = operator.consume();
      const right = this.parseExpression(operator.precedence + 1, stopAtOpeningBlock, stopAtVirtualEos);
      left = {
        ...this.nodeSpan("binary-expression", this.firstTokenIndex(left), right ? this.lastTokenIndex(right) : operatorTokens.at(-1)?.index ?? this.lastTokenIndex(left)),
        kind: "binary-expression",
        left,
        operator: operator.kind,
        operatorTokenIndices: operatorTokens.map((token) => token.index),
        right,
      } satisfies BinaryExpressionNode;
    }
  }

  private parseTypeCore(): TypeCoreNode | undefined {
    const current = this.cursor.current();
    if (RESERVED_SCALAR_TYPE_KINDS.has(current.token.kind)) {
      const name = this.nameFrom(this.cursor.advance());
      return { ...this.nodeSpan("scalar-type", name.tokenIndex, name.tokenIndex), kind: "scalar-type", name, reserved: true };
    }
    if (current.token.kind === TokenId.LIST || current.token.kind === TokenId.MAP || current.token.kind === TokenId.ENTITY) {
      // Bare `entity` is a valid type (e.g. `data entity`); only List/Map always require arguments.
      if (current.token.kind === TokenId.ENTITY && this.cursor.peek(1).token.kind !== TokenId.LESS) {
        const name = this.nameFrom(this.cursor.advance());
        return { ...this.nodeSpan("scalar-type", name.tokenIndex, name.tokenIndex), kind: "scalar-type", name, reserved: false };
      }
      return this.parseGenericType();
    }
    if (current.token.kind === TokenId.FUNC) return this.parseFunctionType();
    if (this.isGeneralIdentifier()) {
      const name = this.parseName();
      if (!name) return undefined;
      return { ...this.nodeSpan("scalar-type", name.tokenIndex, name.tokenIndex), kind: "scalar-type", name, reserved: false };
    }
    return undefined;
  }

  private parseGenericType(): GenericTypeNode {
    const constructorName = this.nameFrom(this.cursor.advance());
    const openAngleTokenIndex = this.consume(TokenId.LESS, "expected-token", "Expected '<' after generic type name.")?.index;
    const arguments_: DomainTypeNode[] = [];
    const commaTokenIndices: number[] = [];

    let closeAngleTokenIndex: number | undefined;
    this.withErrorFence(() => {
      if (openAngleTokenIndex !== undefined) {
        const first = this.parseDomainType();
        if (first) arguments_.push(first);
        while (this.cursor.at(TokenId.COMMA)) {
          commaTokenIndices.push(this.cursor.advance().index);
          const argument = this.parseDomainType();
          if (argument) arguments_.push(argument);
          else break;
        }
      }

      closeAngleTokenIndex = this.consume(TokenId.GREATER, "expected-token", "Expected '>' to close generic type.")?.index;
    });
    const end = closeAngleTokenIndex ?? this.lastTokenIndex(arguments_.at(-1) ?? constructorName);
    return {
      ...this.nodeSpan("generic-type", constructorName.tokenIndex, end),
      arguments: arguments_,
      closeAngleTokenIndex,
      commaTokenIndices,
      constructorName,
      kind: "generic-type",
      openAngleTokenIndex,
    };
  }

  private parseFunctionType(): FunctionTypeNode {
    const func = this.cursor.advance();
    const leftParenTokenIndex = this.consume(TokenId.L_PAREN, "expected-token", "Expected '(' after func in function type.")?.index;
    const parameters: FunctionTypeParameterNode[] = [];
    const commaTokenIndices: number[] = [];

    let rightParenTokenIndex: number | undefined;
    this.withErrorFence(() => {
      while (!this.cursor.at(TokenId.R_PAREN) && !this.cursor.at(TokenId.EOF)) {
        const parameterStart = this.cursor.current().index;
        const out = this.cursor.at(TokenId.OUT) ? this.cursor.advance() : undefined;
        const varToken = out ? this.consume(TokenId.VAR, "expected-token", "Expected 'var' after 'out'.") : undefined;
        const name = this.parseName();
        const type = this.parseDomainType();
        if (!name || !type) break;
        parameters.push({ ...this.nodeSpan("function-type-parameter", parameterStart, this.lastTokenIndex(type)), kind: "function-type-parameter", name, outTokenIndex: out?.index, type, varTokenIndex: varToken?.index });
        if (!this.cursor.at(TokenId.COMMA)) break;
        commaTokenIndices.push(this.cursor.advance().index);
      }

      rightParenTokenIndex = this.consume(TokenId.R_PAREN, "expected-token", "Expected ')' after function type parameters.")?.index;
    });
    const result = this.isTypeStart() ? this.parseDomainType() : undefined;
    const end = result ? this.lastTokenIndex(result) : rightParenTokenIndex ?? func.index;
    return {
      ...this.nodeSpan("function-type", func.index, end),
      commaTokenIndices,
      funcTokenIndex: func.index,
      kind: "function-type",
      leftParenTokenIndex,
      parameters,
      result,
      rightParenTokenIndex,
    };
  }

  private parsePrefixExpression(stopAtOpeningBlock = false): ExpressionNode | undefined {
    const current = this.cursor.current();
    if (current.token.kind === TokenId.START || current.token.kind === TokenId.WAIT) return this.parsePrefixedCall();
    if (UNARY_OPERATOR_IDS.has(current.token.kind)) {
      const operator = this.cursor.advance();
      const operand = this.parseExpression(14, stopAtOpeningBlock);
      return {
        ...this.nodeSpan("unary-expression", operator.index, operand ? this.lastTokenIndex(operand) : operator.index),
        kind: "unary-expression",
        operand,
        operator: operator.token.kind,
        operatorTokenIndex: operator.index,
      };
    }
    if (current.token.kind === TokenId.TYPEOF) return this.parseTypeofExpression();
    if (current.token.kind === TokenId.LOC_STRING && this.cursor.peek(1).token.kind === TokenId.L_CURLY) return this.parseLocStringExpression();
    if (current.token.kind === TokenId.L_CURLY) return this.parseBareComposite();
    const collection = this.tryParseTypedCollectionComposite();
    if (collection) return collection;
    if (VECTOR_COMPOSITE_TYPE_IDS.has(current.token.kind) && this.cursor.peek(1).token.kind === TokenId.L_CURLY) {
      const type = this.parseDomainType();
      if (type && this.cursor.at(TokenId.L_CURLY)) return this.parsePositionalComposite(type, this.cursor.advance());
    }
    if (!stopAtOpeningBlock && this.atStructCompositeStart()) return this.parseStructComposite();
    if (current.token.kind === TokenId.L_PAREN) return this.parseParenthesizedExpression();
    if (current.token.kind === TokenId.THISENTITY || current.token.kind === TokenId.GLOBALENTITY) {
      const token = this.cursor.advance();
      return {
        ...this.nodeSpan("entity-reference-expression", token.index, token.index),
        kind: "entity-reference-expression",
        reference: token.token.kind === TokenId.THISENTITY ? "thisEntity" : "globalEntity",
        tokenIndex: token.index,
      };
    }
    const literalKind = LITERAL_KINDS.get(current.token.kind);
    if (literalKind) {
      const token = this.cursor.advance();
      return { ...this.nodeSpan("literal-expression", token.index, token.index), kind: "literal-expression", literalKind, tokenIndex: token.index };
    }
    if (this.isExpressionName()) {
      const name = this.nameFrom(this.cursor.advance());
      return { ...this.nodeSpan("name-expression", name.tokenIndex, name.tokenIndex), kind: "name-expression", name };
    }
    this.report("expected-expression", "Expected an FC expression.", current.token.range);
    return undefined;
  }

  private hasVirtualBoundaryAfter(node: SyntaxNode): boolean {
    return this.hasVirtualBoundaryAfterToken(this.lastTokenIndex(node));
  }

  private hasVirtualBoundaryAfterToken(endTokenIndex: number): boolean {
    return this.tokens.slice(endTokenIndex + 1, this.cursor.current().index).some((token) => isTrivia(token) && containsLineBreak(token));
  }

  private parsePrefixedCall(): ExpressionNode {
    const prefix = this.cursor.advance();
    let target = this.parsePrefixExpression();
    if (target) target = this.parsePostfix(target, false);
    let call: CallExpressionNode | undefined;
    if (target && this.cursor.at(TokenId.L_PAREN)) call = this.parseCall(target);
    else this.report("expected-token", "Expected a call after start/wait.", this.cursor.current().token.range);
    const end = call ? this.lastTokenIndex(call) : target ? this.lastTokenIndex(target) : prefix.index;
    return {
      ...this.nodeSpan("prefixed-call-expression", prefix.index, end),
      call,
      kind: "prefixed-call-expression",
      prefix: prefix.token.kind === TokenId.START ? "start" : "wait",
      prefixTokenIndex: prefix.index,
      target,
    };
  }

  private parseParenthesizedExpression(): ExpressionNode {
    const leftParen = this.cursor.advance();
    const expression = this.parseExpression();
    const rightParen = this.consume(TokenId.R_PAREN, "expected-token", "Expected ')' after parenthesized expression.");
    return {
      ...this.nodeSpan("parenthesized-expression", leftParen.index, rightParen?.index ?? this.lastTokenIndex(expression ?? leftParen)),
      expression,
      kind: "parenthesized-expression",
      leftParenTokenIndex: leftParen.index,
      rightParenTokenIndex: rightParen?.index,
    };
  }

  private parseTypeofExpression(): ExpressionNode {
    const typeofToken = this.cursor.advance();
    const leftParen = this.consume(TokenId.L_PAREN, "expected-token", "Expected '(' after typeof.");
    const type = this.parseDomainType();
    const rightParen = this.consume(TokenId.R_PAREN, "expected-token", "Expected ')' after typeof type.");
    return {
      ...this.nodeSpan("typeof-expression", typeofToken.index, rightParen?.index ?? this.lastTokenIndex(type ?? typeofToken)),
      kind: "typeof-expression",
      leftParenTokenIndex: leftParen?.index,
      rightParenTokenIndex: rightParen?.index,
      type,
      typeofTokenIndex: typeofToken.index,
    };
  }

  private parseBareComposite(): ExpressionNode {
    const leftCurly = this.cursor.advance();
    if (this.cursor.at(TokenId.R_CURLY)) return this.finishPositionalComposite(undefined, leftCurly, []);
    const first = this.parseExpression();
    if (this.cursor.at(TokenId.COLON)) return this.parseMapComposite(undefined, leftCurly, first);
    return this.finishPositionalComposite(undefined, leftCurly, first ? [first] : []);
  }

  private tryParseTypedCollectionComposite(): ExpressionNode | undefined {
    if (this.cursor.current().token.kind !== TokenId.LIST && this.cursor.current().token.kind !== TokenId.MAP) return undefined;
    const cursorCheckpoint = this.cursor.checkpoint();
    const diagnosticCheckpoint = this.diagnostics.length;
    const fenceCheckpoint = this.saveErrorFence();
    const type = this.parseDomainType();
    if (!type || !this.cursor.at(TokenId.L_CURLY) || type.type.kind !== "generic-type") {
      this.cursor.restore(cursorCheckpoint);
      this.diagnostics.length = diagnosticCheckpoint;
      this.restoreErrorFence(fenceCheckpoint);
      return undefined;
    }
    const leftCurly = this.cursor.advance();
    return type.type.constructorName.text === "Map"
      ? this.parseMapComposite(type, leftCurly)
      : this.finishPositionalComposite(type, leftCurly, []);
  }

  private parsePositionalComposite(type: DomainTypeNode, leftCurly: CursorToken): PositionalCompositeExpressionNode {
    return this.finishPositionalComposite(type, leftCurly, []);
  }

  private finishPositionalComposite(type: DomainTypeNode | undefined, leftCurly: CursorToken, entries: ExpressionNode[]): PositionalCompositeExpressionNode {
    const commaTokenIndices: number[] = [];
    let trailingCommaTokenIndex: number | undefined;
    let rightCurly: CursorToken | undefined;
    this.withErrorFence(() => {
      while (!this.cursor.at(TokenId.R_CURLY) && !this.cursor.at(TokenId.EOF)) {
        if (entries.length > 0 || this.cursor.at(TokenId.COMMA)) {
          if (!this.cursor.at(TokenId.COMMA)) break;
          const comma = this.cursor.advance();
          commaTokenIndices.push(comma.index);
          if (this.cursor.at(TokenId.R_CURLY)) {
            trailingCommaTokenIndex = comma.index;
            break;
          }
        }
        const entry = this.parseExpression();
        if (!entry) break;
        entries.push(entry);
      }
      rightCurly = this.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after composite entries.");
    });
    const end = rightCurly?.index ?? this.lastTokenIndex(entries.at(-1) ?? leftCurly);
    return {
      ...this.nodeSpan("positional-composite-expression", type ? this.firstTokenIndex(type) : leftCurly.index, end),
      commaTokenIndices,
      entries,
      kind: "positional-composite-expression",
      leftCurlyTokenIndex: leftCurly.index,
      rightCurlyTokenIndex: rightCurly?.index,
      trailingCommaTokenIndex,
      type,
    };
  }

  private parseMapComposite(type: DomainTypeNode | undefined, leftCurly: CursorToken, firstKey?: ExpressionNode): MapCompositeExpressionNode {
    const entries: MapCompositeEntryNode[] = [];
    const commaTokenIndices: number[] = [];
    let trailingCommaTokenIndex: number | undefined;
    let pendingKey = firstKey;
    let rightCurly: CursorToken | undefined;
    this.withErrorFence(() => {
      while (!this.cursor.at(TokenId.R_CURLY) && !this.cursor.at(TokenId.EOF)) {
        const entryStart = pendingKey ? this.firstTokenIndex(pendingKey) : this.cursor.current().index;
        const key = pendingKey ?? this.parseExpression();
        pendingKey = undefined;
        const colon = this.consume(TokenId.COLON, "expected-token", "Expected ':' between map key and value.");
        const value = this.parseExpression();
        const end = this.lastTokenIndex(value ?? colon ?? key ?? this.cursor.current());
        entries.push({
          ...this.nodeSpan("map-composite-entry", entryStart, end),
          colonTokenIndex: colon?.index,
          key,
          kind: "map-composite-entry",
          value,
        });
        if (!this.cursor.at(TokenId.COMMA)) break;
        const comma = this.cursor.advance();
        commaTokenIndices.push(comma.index);
        if (this.cursor.at(TokenId.R_CURLY)) {
          trailingCommaTokenIndex = comma.index;
          break;
        }
      }
      rightCurly = this.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after map entries.");
    });
    const end = rightCurly?.index ?? this.lastTokenIndex(entries.at(-1) ?? leftCurly);
    return {
      ...this.nodeSpan("map-composite-expression", type ? this.firstTokenIndex(type) : leftCurly.index, end),
      commaTokenIndices,
      entries,
      kind: "map-composite-expression",
      leftCurlyTokenIndex: leftCurly.index,
      rightCurlyTokenIndex: rightCurly?.index,
      trailingCommaTokenIndex,
      type,
    };
  }

  private parseStructComposite(): StructCompositeExpressionNode {
    const typeName = this.parseQualifiedName();
    if (!typeName) throw new Error("Struct composite requires a type name after its lookahead.");
    const first = typeName.segments[0];
    if (!first) throw new Error("Struct composite requires a type name after its lookahead.");
    const leftCurly = this.consume(TokenId.L_CURLY, "expected-token", "Expected '{' after struct literal type.");
    if (!leftCurly) throw new Error("Struct composite lookahead lost its opening brace.");
    const fields: StructCompositeFieldNode[] = [];
    const commaTokenIndices: number[] = [];
    let trailingCommaTokenIndex: number | undefined;
    let rightCurly: CursorToken | undefined;
    this.withErrorFence(() => {
      while (!this.cursor.at(TokenId.R_CURLY) && !this.cursor.at(TokenId.EOF)) {
        const fieldStart = this.cursor.current().index;
        const name = this.parseName();
        const assign = this.consume(TokenId.ASSIGN, "expected-token", "Expected '=' after struct literal field name.");
        const value = this.parseExpression();
        const end = this.lastTokenIndex(value ?? assign ?? name ?? this.cursor.current());
        fields.push({
          ...this.nodeSpan("struct-composite-field", fieldStart, end),
          assignTokenIndex: assign?.index,
          kind: "struct-composite-field",
          name,
          value,
        });
        if (!this.cursor.at(TokenId.COMMA)) break;
        const comma = this.cursor.advance();
        commaTokenIndices.push(comma.index);
        if (this.cursor.at(TokenId.R_CURLY)) {
          trailingCommaTokenIndex = comma.index;
          break;
        }
      }
      rightCurly = this.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after struct literal fields.");
    });
    const end = rightCurly?.index ?? this.lastTokenIndex(fields.at(-1) ?? leftCurly);
    return {
      ...this.nodeSpan("struct-composite-expression", first.tokenIndex, end),
      commaTokenIndices,
      fields,
      kind: "struct-composite-expression",
      leftCurlyTokenIndex: leftCurly.index,
      rightCurlyTokenIndex: rightCurly?.index,
      trailingCommaTokenIndex,
      typeName,
    };
  }

  private parseLocStringExpression(): LocStringExpressionNode {
    const locString = this.cursor.advance();
    const leftCurly = this.consume(TokenId.L_CURLY, "expected-token", "Expected '{' after LocString.");
    const key = this.parseExpression();
    const comma = this.consume(TokenId.COMMA, "expected-token", "LocString requires a comma after its key.");
    const arguments_ = this.parseLocStringArguments();
    const rightCurly = this.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after LocString arguments.");
    const end = rightCurly?.index ?? this.lastTokenIndex(arguments_ ?? key ?? comma ?? leftCurly ?? locString);
    return {
      ...this.nodeSpan("loc-string-expression", locString.index, end),
      arguments: arguments_,
      commaTokenIndex: comma?.index,
      key,
      kind: "loc-string-expression",
      leftCurlyTokenIndex: leftCurly?.index,
      locStringTokenIndex: locString.index,
      rightCurlyTokenIndex: rightCurly?.index,
    };
  }

  private parseLocStringArguments(): PositionalCompositeExpressionNode | undefined {
    if (this.cursor.at(TokenId.L_CURLY)) {
      const bare = this.parseBareComposite();
      if (bare.kind === "positional-composite-expression") return bare;
      this.report("expected-token", "LocString arguments must be a list value, not a map value.", bare.range);
      return undefined;
    }
    const collection = this.tryParseTypedCollectionComposite();
    if (collection?.kind === "positional-composite-expression") return collection;
    if (collection) this.report("expected-token", "LocString arguments must be a list value.", collection.range);
    else this.report("expected-token", "LocString arguments must be a list value.", this.cursor.current().token.range);
    return undefined;
  }

  private parsePostfix(expression: ExpressionNode, allowCall: boolean, stopAtVirtualEos = false, allowOpeningBlockFollower = false): ExpressionNode {
    let current = expression;
    for (; ;) {
      if (stopAtVirtualEos && this.hasVirtualBoundaryAfter(current)) return current;
      if (allowCall && this.cursor.at(TokenId.L_PAREN)) {
        current = this.parseCall(current);
      } else if (this.cursor.at(TokenId.L_BRACKET)) {
        current = this.parseIndex(current);
      } else if (this.cursor.at(TokenId.DOT)) {
        current = this.parseMember(current);
      } else {
        const generic = this.tryParseGenericAccess(current, allowOpeningBlockFollower);
        if (!generic) return current;
        current = generic;
      }
    }
  }

  private parseCall(callee: ExpressionNode): CallExpressionNode {
    const leftParen = this.cursor.advance();
    const arguments_: CallArgumentNode[] = [];
    const commaTokenIndices: number[] = [];
    let trailingCommaTokenIndex: number | undefined;
    let rightParen: CursorToken | undefined;
    this.withErrorFence(() => {
      while (!this.cursor.at(TokenId.R_PAREN) && !this.cursor.at(TokenId.EOF)) {
        const argument = this.cursor.at(TokenId.OUT) ? this.parseOutVarArgument() : this.parseExpression();
        if (!argument) break;
        arguments_.push(argument);
        if (!this.cursor.at(TokenId.COMMA)) break;
        const comma = this.cursor.advance();
        commaTokenIndices.push(comma.index);
        if (this.cursor.at(TokenId.R_PAREN)) {
          trailingCommaTokenIndex = comma.index;
          break;
        }
      }
      rightParen = this.consume(TokenId.R_PAREN, "expected-token", "Expected ')' after call arguments.");
    });
    return {
      ...this.nodeSpan("call-expression", this.firstTokenIndex(callee), rightParen?.index ?? this.lastTokenIndex(arguments_.at(-1) ?? callee)),
      arguments: arguments_,
      callee,
      commaTokenIndices,
      kind: "call-expression",
      leftParenTokenIndex: leftParen.index,
      rightParenTokenIndex: rightParen?.index,
      trailingCommaTokenIndex,
    };
  }

  private parseOutVarArgument(): OutVarArgumentNode {
    const out = this.cursor.advance();
    const varToken = this.consume(TokenId.VAR, "expected-token", "Expected 'var' after 'out'.");
    const name = this.parseName();
    return {
      ...this.nodeSpan("out-var-argument", out.index, this.lastTokenIndex(name ?? varToken ?? out)),
      kind: "out-var-argument",
      name,
      outTokenIndex: out.index,
      varTokenIndex: varToken?.index,
    };
  }

  private parseIndex(object: ExpressionNode): ExpressionNode {
    const leftBracket = this.cursor.advance();
    const index = this.parseExpression();
    const rightBracket = this.consume(TokenId.R_BRACKET, "expected-token", "Expected ']' after index expression.");
    return {
      ...this.nodeSpan("index-expression", this.firstTokenIndex(object), rightBracket?.index ?? this.lastTokenIndex(index ?? leftBracket)),
      index,
      kind: "index-expression",
      leftBracketTokenIndex: leftBracket.index,
      object,
      rightBracketTokenIndex: rightBracket?.index,
    };
  }

  private parseMember(object: ExpressionNode): ExpressionNode {
    const dot = this.cursor.advance();
    const member = this.parseName();
    return {
      ...this.nodeSpan("member-expression", this.firstTokenIndex(object), this.lastTokenIndex(member ?? dot)),
      dotTokenIndex: dot.index,
      kind: "member-expression",
      member,
      object,
    };
  }

  private tryParseGenericAccess(object: ExpressionNode, allowOpeningBlockFollower = false): GenericAccessExpressionNode | undefined {
    if (!this.cursor.at(TokenId.LESS)) return undefined;
    const cursorCheckpoint = this.cursor.checkpoint();
    const diagnosticCheckpoint = this.diagnostics.length;
    const fenceCheckpoint = this.saveErrorFence();
    const open = this.cursor.advance();
    const typeArgument = this.parseDomainType();
    const close = typeArgument && this.cursor.at(TokenId.GREATER) ? this.cursor.advance() : undefined;
    if (!typeArgument || !close || (!GENERIC_FOLLOWERS.has(this.cursor.current().token.kind) && !(allowOpeningBlockFollower && this.cursor.at(TokenId.L_CURLY)) && !this.hasVirtualBoundaryAfterToken(close.index))) {
      this.cursor.restore(cursorCheckpoint);
      this.diagnostics.length = diagnosticCheckpoint;
      this.restoreErrorFence(fenceCheckpoint);
      return undefined;
    }
    return {
      ...this.nodeSpan("generic-access-expression", this.firstTokenIndex(object), close.index),
      closeAngleTokenIndex: close.index,
      kind: "generic-access-expression",
      object,
      openAngleTokenIndex: open.index,
      typeArgument,
    };
  }

  private peekBinaryOperator(): { consume: () => readonly CursorToken[]; kind: TokenKind; precedence: number } | undefined {
    const current = this.cursor.current();
    const next = this.cursor.peek(1);
    if ((current.token.kind === TokenId.LESS && next.token.kind === TokenId.LESS) ||
      (current.token.kind === TokenId.GREATER && next.token.kind === TokenId.GREATER)) {
      return {
        consume: () => [this.cursor.advance(), this.cursor.advance()],
        kind: current.token.kind,
        precedence: 7,
      };
    }
    const precedence = BINARY_PRECEDENCE.get(current.token.kind);
    if (precedence === undefined) return undefined;
    return { consume: () => [this.cursor.advance()], kind: current.token.kind, precedence };
  }

  protected parseName(): NameNode | undefined {
    if (!this.isGeneralIdentifier()) {
      this.report("expected-name", "Expected an FC identifier-like name.", this.cursor.current().token.range);
      return undefined;
    }
    return this.nameFrom(this.cursor.advance());
  }

  protected nameFrom(token: CursorToken): NameNode {
    return {
      ...this.nodeSpan("name", token.index, token.index),
      kind: "name",
      text: token.token.text,
      tokenIndex: token.index,
    };
  }

  /**
   * Parses a dotted name (`A`, `A.B`, `A.B.C`) shared by event names and
   * struct-literal type heads. A DOT is only consumed when an
   * identifier-like segment follows, so `A.` never strands the cursor past
   * the dot on error paths. Decorator names intentionally stay
   * single-segment (see the qualified-name matrix test).
   */
  protected parseQualifiedName(): QualifiedNameNode | undefined {
    const first = this.parseName();
    if (!first) return undefined;
    const segments: NameNode[] = [first];
    const dotTokenIndices: number[] = [];
    while (this.cursor.at(TokenId.DOT) && GENERAL_IDENTIFIER_KINDS.has(this.cursor.peek(1).token.kind)) {
      dotTokenIndices.push(this.cursor.advance().index);
      const segment = this.parseName();
      if (!segment) break;
      segments.push(segment);
    }
    const last = segments.at(-1) ?? first;
    return {
      ...this.nodeSpan("qualified-name", first.tokenIndex, last.tokenIndex),
      dotTokenIndices,
      kind: "qualified-name",
      segments,
      text: segments.map((segment) => segment.text).join("."),
    } satisfies QualifiedNameNode;
  }

  protected consume(kind: number, code: ParseDiagnosticCode, message: string): CursorToken | undefined {
    if (this.cursor.at(kind)) return this.cursor.advance();
    this.report(code, message, this.cursor.current().token.range);
    return undefined;
  }

  private isExpressionName(): boolean {
    return this.isGeneralIdentifier() || TYPE_LIKE_EXPRESSION_NAME_IDS.has(this.cursor.current().token.kind);
  }

  protected isGeneralIdentifier(): boolean {
    return GENERAL_IDENTIFIER_KINDS.has(this.cursor.current().token.kind);
  }

  protected atStructCompositeStart(): boolean {
    if (!this.isGeneralIdentifier()) return false;
    let offset = 1;
    while (this.cursor.peek(offset).token.kind === TokenId.DOT) {
      if (!GENERAL_IDENTIFIER_KINDS.has(this.cursor.peek(offset + 1).token.kind)) return false;
      offset += 2;
    }
    return this.cursor.peek(offset).token.kind === TokenId.L_CURLY;
  }

  protected isTypeStart(): boolean {
    const kind = this.cursor.current().token.kind;
    return RESERVED_SCALAR_TYPE_KINDS.has(kind) || kind === TokenId.LIST || kind === TokenId.MAP || kind === TokenId.ENTITY || kind === TokenId.FUNC || GENERAL_IDENTIFIER_KINDS.has(kind);
  }

  protected firstTokenIndex(node: SyntaxNode): number {
    return node.tokenRange.start;
  }

  protected lastTokenIndex(node: SyntaxNode | CursorToken): number {
    return "token" in node ? node.index : node.tokenRange.end - 1;
  }

  protected nodeSpan<TKind extends string>(kind: TKind, start: number, end: number): Pick<SyntaxNode, "range" | "tokenRange"> & { readonly kind: TKind } {
    const startToken = this.tokenAt(start);
    const endToken = this.tokenAt(end);
    return {
      kind,
      range: { start: startToken.range.start, end: endToken.range.end },
      tokenRange: { start, end: end + 1 },
    };
  }

  protected report(code: ParseDiagnosticCode, message: string, range: SourceRange): void {
    if (this.errorFenceDepth > 0) {
      let fenced = this.errorFencedOffsets;
      if (!fenced) {
        fenced = new Set<number>();
        this.errorFencedOffsets = fenced;
      }
      const offset = range.start.offset;
      if (fenced.has(offset)) return;
      fenced.add(offset);
    }
    this.diagnostics.push({ code, message, range });
  }

  protected tokenAt(index: number): Token {
    const token = this.tokens[index];
    if (!token) throw new Error(`Missing token at index ${index}.`);
    return token;
  }
}
