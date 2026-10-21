import { TokenId, type TokenId as TokenKind } from "../grammar/token-vocabulary.generated.js";
import type { LexResult } from "../lex/lexer.js";
import type { CursorToken } from "./cursor.js";
import type {
  AggregateDeclarationNode, AliasDeclarationNode, AssignmentStatementNode, BlockNode, DecoratorNode,
  DeclareGraphNode, DefineDeclarationNode, DomainTypeNode, EnumDeclarationNode, EnumMemberNode,
  EventDeclarationNode, ExpressionNode, FieldDeclarationNode, ForStatementNode, FunctionDeclarationNode,
  GraphDeclarationNode, GraphFileNode, HeaderDeclarationNode, HeaderFileNode, IfStatementNode,
  ImportNode, NameNode, ParameterNode, SignatureNode, StatementNode, TypeCombinationNode,
  VariableStatementNode, WhileStatementNode,
} from "../syntax/nodes.js";
import { TypeExpressionParser, type ParseResult } from "./type-expression-parser.js";
import {
  AGGREGATE_FIELD_SYNC,
  BLOCK_STATEMENT_SYNC,
  DECLARE_GRAPH_MEMBER_SYNC,
  ENUM_MEMBER_SYNC,
  GRAPH_MEMBER_SYNC,
  HEADER_DECL_SYNC,
} from "./recovery.js";

const STRING_KINDS = new Set<number>([TokenId.INTERPRETED_STRING_LIT, TokenId.RAW_STRING_LIT]);
const ASSIGNMENT_KINDS = new Set<number>([
  TokenId.ASSIGN, TokenId.PLUS_ASSIGN, TokenId.MINUS_ASSIGN, TokenId.STAR_ASSIGN, TokenId.DIV_ASSIGN,
  TokenId.MOD_ASSIGN, TokenId.AND_ASSIGN, TokenId.XOR_ASSIGN, TokenId.OR_ASSIGN,
  TokenId.RSHIFT_ASSIGN, TokenId.LSHIFT_ASSIGN,
]);

/**
 * Tokens that open a new statement but can never open an FC expression. A
 * bare `return` followed by one of these is complete; attempting a return
 * value there only emits a spurious diagnostic (e.g. unreachable `var`
 * declarations after an early `return`).
 */
const RETURN_BARE_FOLLOW_KINDS = new Set<number>([
  TokenId.VAR, TokenId.IF, TokenId.WHILE, TokenId.FOR, TokenId.RETURN,
  TokenId.BREAK, TokenId.CONTINUE, TokenId.L_CURLY, TokenId.SEMI, TokenId.EOF,
]);

/** Parse a complete `.fcc` file without making formatting decisions. */
export function parseHeaderFile(lexed: LexResult): ParseResult<HeaderFileNode> {
  const parser = new FileParser(lexed.tokens);
  return parser.parseHeaderFile();
}

/** Parse a complete `.fcg` graph file, including its graph members and code blocks. */
export function parseGraphFile(lexed: LexResult): ParseResult<GraphFileNode> {
  const parser = new FileParser(lexed.tokens);
  return parser.parseGraphFile();
}

class FileParser extends TypeExpressionParser {
  public parseHeaderFile(): ParseResult<HeaderFileNode> {
    const start = this.cursor.current().index;
    const imports = this.parseImports();
    const declarations: HeaderDeclarationNode[] = [];
    while (!this.cursor.at(TokenId.EOF)) {
      const before = this.cursor.checkpoint();
      const decorators = this.parseDecorators();
      const declaration = this.parseHeaderDeclaration(decorators);
      if (declaration) declarations.push(declaration);
      else this.recover("Expected a header declaration.", HEADER_DECL_SYNC);
      if (this.cursor.checkpoint() === before) this.cursor.advance();
    }
    const end = this.cursor.current().index;
    return this.result({ ...this.nodeSpan("header-file", start, end), declarations, imports, kind: "header-file" });
  }

  public parseGraphFile(): ParseResult<GraphFileNode> {
    const start = this.cursor.current().index;
    const imports = this.parseImports();
    const decorators = this.parseDecorators();
    const graph = this.cursor.at(TokenId.EOF) ? undefined : this.parseGraphDeclaration(decorators);
    if (!graph && !this.cursor.at(TokenId.EOF)) this.recover("Expected a graph declaration.");
    this.reportTrailingInput();
    const end = this.cursor.current().index;
    return this.result({ ...this.nodeSpan("graph-file", start, end), graph, imports, kind: "graph-file" });
  }

  private parseImports(): ImportNode[] {
    const imports: ImportNode[] = [];
    while (this.cursor.at(TokenId.IMPORT)) imports.push(this.parseImport());
    return imports;
  }

  private parseImport(): ImportNode {
    const importToken = this.cursor.advance();
    if (STRING_KINDS.has(this.cursor.current().token.kind)) {
      const path = this.cursor.advance();
      const asToken = this.consume(TokenId.AS, "expected-token", "Library imports require 'as Alias'.");
      const alias = this.parseName();
      return {
        ...this.nodeSpan("library-import", importToken.index, this.lastTokenIndex(alias ?? asToken ?? path)),
        alias, asTokenIndex: asToken?.index, importTokenIndex: importToken.index, kind: "library-import", pathTokenIndex: path.index,
      };
    }
    const imported = this.parseName();
    const asToken = this.cursor.at(TokenId.AS) ? this.cursor.advance() : undefined;
    const alias = asToken ? this.parseName() : undefined;
    const fromToken = this.consume(TokenId.FROM, "expected-token", "Named imports require 'from " + '"path"' + "'.");
    const path = STRING_KINDS.has(this.cursor.current().token.kind) ? this.cursor.advance() : undefined;
    if (!path) this.report("expected-token", "Expected a string import path after 'from'.", this.cursor.current().token.range);
    return {
      ...this.nodeSpan("named-import", importToken.index, this.lastTokenIndex(path ?? alias ?? fromToken ?? imported ?? importToken)),
      alias, asTokenIndex: asToken?.index, fromTokenIndex: fromToken?.index, importTokenIndex: importToken.index,
      imported, kind: "named-import", pathTokenIndex: path?.index,
    };
  }

  private parseHeaderDeclaration(decorators: readonly DecoratorNode[]): HeaderDeclarationNode | undefined {
    switch (this.cursor.current().token.kind) {
      case TokenId.DEFINE: return this.parseDefine(decorators);
      case TokenId.ALIAS: return this.parseAlias(decorators);
      case TokenId.ENUM: return this.parseEnum(decorators);
      case TokenId.TUPLE: return this.parseAggregate(decorators, "tuple-declaration");
      case TokenId.COMPONENT: return this.parseAggregate(decorators, "component-declaration");
      case TokenId.FUNC:
      case TokenId.ASYNC: return this.parseFunction(decorators, false);
      case TokenId.EVENT: return this.parseEvent(decorators, false);
      case TokenId.DECLARE: return this.parseDeclareGraph();
      default: return undefined;
    }
  }

  private parseDecorators(): DecoratorNode[] {
    const decorators: DecoratorNode[] = [];
    while (this.cursor.at(TokenId.L_BRACKET)) decorators.push(this.parseDecorator());
    return decorators;
  }

  private parseDecorator(): DecoratorNode {
    const left = this.cursor.advance();
    const name = this.parseName();
    const arguments_: DomainTypeNode[] = [];
    const commaTokenIndices: number[] = [];
    let right: CursorToken | undefined;
    this.withErrorFence(() => {
      while (!this.cursor.at(TokenId.R_BRACKET) && !this.cursor.at(TokenId.EOF)) {
        const argument = this.parseDomainType();
        if (argument) arguments_.push(argument); else break;
        if (!this.cursor.at(TokenId.COMMA)) break;
        commaTokenIndices.push(this.cursor.advance().index);
      }
      right = this.consume(TokenId.R_BRACKET, "expected-token", "Expected ']' after decorator.");
    });
    return {
      ...this.nodeSpan("decorator", left.index, this.lastTokenIndex(right ?? arguments_.at(-1) ?? name ?? left)),
      arguments: arguments_, commaTokenIndices, kind: "decorator", leftBracketTokenIndex: left.index, name, rightBracketTokenIndex: right?.index,
    };
  }

  private parseDefine(decorators: readonly DecoratorNode[]): DefineDeclarationNode {
    const define = this.cursor.advance();
    const name = this.parseName();
    const colon = this.cursor.at(TokenId.COLON) ? this.cursor.advance() : undefined;
    const equals = !colon && this.cursor.at(TokenId.ASSIGN) ? this.cursor.advance() : undefined;
    if (!colon && !equals) this.report("expected-token", "Expected ':' or '=' after define name.", this.cursor.current().token.range);
    const type = this.parseDomainType();
    return {
      ...this.nodeSpan("define-declaration", define.index, this.lastTokenIndex(type ?? equals ?? colon ?? name ?? define)),
      colonTokenIndex: colon?.index, decorators, defineTokenIndex: define.index, equalsTokenIndex: equals?.index, kind: "define-declaration", name, type,
    };
  }

  private parseAlias(decorators: readonly DecoratorNode[]): AliasDeclarationNode {
    const alias = this.cursor.advance();
    const name = this.parseName();
    const equals = this.consume(TokenId.ASSIGN, "expected-token", "Expected '=' after alias name.");
    const type = this.parseTypeCombination();
    return {
      ...this.nodeSpan("alias-declaration", alias.index, this.lastTokenIndex(type ?? equals ?? name ?? alias)),
      decorators, equalsTokenIndex: equals?.index, kind: "alias-declaration", name, type,
    };
  }

  private parseTypeCombination(): TypeCombinationNode | DomainTypeNode | undefined {
    let left: TypeCombinationNode | DomainTypeNode | undefined = this.parseDomainType();
    if (!left) return undefined;
    while (this.cursor.at(TokenId.AND) || this.cursor.at(TokenId.OR)) {
      const operator = this.cursor.advance();
      const right = this.parseDomainType();
      const previous: TypeCombinationNode | DomainTypeNode = left;
      left = {
        ...this.nodeSpan("type-combination", this.firstTokenIndex(previous), this.lastTokenIndex(right ?? operator)),
        kind: "type-combination", left, operator: operator.token.kind as TokenKind, operatorTokenIndex: operator.index, right,
      };
    }
    return left;
  }

  private parseEnum(decorators: readonly DecoratorNode[]): EnumDeclarationNode {
    const enumToken = this.cursor.advance();
    const name = this.parseName();
    const left = this.consume(TokenId.L_CURLY, "expected-token", "Expected '{' after enum name.");
    const members: EnumMemberNode[] = [];
    while (!this.cursor.at(TokenId.R_CURLY) && !this.cursor.at(TokenId.EOF)) {
      const memberDecorators = this.parseDecorators();
      const start = this.cursor.current();
      const memberName = this.parseName();
      const assign = this.cursor.at(TokenId.ASSIGN) ? this.cursor.advance() : undefined;
      const value = assign ? this.parseExpression(0, false, true) : undefined;
      if (!memberName) { this.recover("Expected an enum member.", ENUM_MEMBER_SYNC); continue; }
      members.push({
        ...this.nodeSpan("enum-member", start.index, this.lastTokenIndex(value ?? assign ?? memberName)),
        assignTokenIndex: assign?.index, decorators: memberDecorators, kind: "enum-member", name: memberName, value,
      });
      this.consumeOptionalSemi();
    }
    const right = this.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after enum body.");
    return {
      ...this.nodeSpan("enum-declaration", enumToken.index, this.lastTokenIndex(right ?? members.at(-1) ?? left ?? name ?? enumToken)),
      decorators, enumTokenIndex: enumToken.index, kind: "enum-declaration", leftCurlyTokenIndex: left?.index, members, name, rightCurlyTokenIndex: right?.index,
    };
  }

  private parseAggregate(decorators: readonly DecoratorNode[], kind: AggregateDeclarationNode["kind"]): AggregateDeclarationNode {
    const keyword = this.cursor.advance();
    const name = this.parseName();
    const left = this.consume(TokenId.L_CURLY, "expected-token", "Expected '{' after declaration name.");
    const fields: FieldDeclarationNode[] = [];
    while (!this.cursor.at(TokenId.R_CURLY) && !this.cursor.at(TokenId.EOF)) {
      const field = this.parseField(this.parseDecorators());
      if (field) fields.push(field); else this.recover("Expected a field declaration.", AGGREGATE_FIELD_SYNC);
      this.consumeOptionalSemi();
    }
    const right = this.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after declaration body.");
    return {
      ...this.nodeSpan(kind, keyword.index, this.lastTokenIndex(right ?? fields.at(-1) ?? left ?? name ?? keyword)),
      decorators, fields, kind, keywordTokenIndex: keyword.index, leftCurlyTokenIndex: left?.index, name, rightCurlyTokenIndex: right?.index,
    };
  }

  private parseFunction(decorators: readonly DecoratorNode[], withBody: boolean): FunctionDeclarationNode {
    const asyncToken = this.cursor.at(TokenId.ASYNC) ? this.cursor.advance() : undefined;
    const func = this.consume(TokenId.FUNC, "expected-token", "Expected 'func'.");
    const name = this.parseName();
    const signature = this.parseSignature();
    const result = !asyncToken && this.isTypeStart() ? this.parseDomainType() : undefined;
    if (asyncToken && this.isTypeStart()) this.report("unexpected-token", "Async functions cannot declare a result type.", this.cursor.current().token.range);
    const body = withBody && this.cursor.at(TokenId.L_CURLY) ? this.parseBlock() : undefined;
    const start = asyncToken?.index ?? func?.index ?? name?.tokenIndex ?? this.cursor.current().index;
    return {
      ...this.nodeSpan("function-declaration", start, this.lastTokenIndex(body ?? result ?? signature ?? name ?? func ?? asyncToken ?? this.cursor.current())),
      asyncTokenIndex: asyncToken?.index, body, decorators, funcTokenIndex: func?.index ?? start, kind: "function-declaration", name, result, signature,
    };
  }

  private parseEvent(decorators: readonly DecoratorNode[], withBody: boolean): EventDeclarationNode {
    const event = this.cursor.advance();
    const name = this.parseQualifiedName();
    const signature = this.parseSignature();
    const body = withBody && this.cursor.at(TokenId.L_CURLY) ? this.parseBlock() : undefined;
    return {
      ...this.nodeSpan("event-declaration", event.index, this.lastTokenIndex(body ?? signature ?? name ?? event)),
      body, decorators, eventTokenIndex: event.index, kind: "event-declaration", name, signature,
    };
  }

  private parseSignature(): SignatureNode | undefined {
    if (!this.cursor.at(TokenId.L_PAREN)) { this.report("expected-token", "Expected '(' before parameters.", this.cursor.current().token.range); return undefined; }
    const left = this.cursor.advance();
    const parameters: ParameterNode[] = [];
    const commas: number[] = [];
    let trailingCommaTokenIndex: number | undefined;
    let right: CursorToken | undefined;
    this.withErrorFence(() => {
      while (!this.cursor.at(TokenId.R_PAREN) && !this.cursor.at(TokenId.EOF)) {
        const start = this.cursor.current();
        const out = this.cursor.at(TokenId.OUT) ? this.cursor.advance() : undefined;
        const varToken = out ? this.consume(TokenId.VAR, "expected-token", "Expected 'var' after 'out'.") : undefined;
        const name = this.parseName();
        const type = this.parseDomainType();
        if (!name || !type) break;
        parameters.push({ ...this.nodeSpan("parameter", start.index, this.lastTokenIndex(type)), kind: "parameter", name, outTokenIndex: out?.index, type, varTokenIndex: varToken?.index });
        if (!this.cursor.at(TokenId.COMMA)) break;
        const comma = this.cursor.advance(); commas.push(comma.index);
        if (this.cursor.at(TokenId.R_PAREN)) { trailingCommaTokenIndex = comma.index; break; }
      }
      right = this.consume(TokenId.R_PAREN, "expected-token", "Expected ')' after parameters.");
    });
    return {
      ...this.nodeSpan("signature", left.index, this.lastTokenIndex(right ?? parameters.at(-1) ?? left)),
      commaTokenIndices: commas, kind: "signature", leftParenTokenIndex: left.index, parameters, rightParenTokenIndex: right?.index, trailingCommaTokenIndex,
    };
  }

  private parseDeclareGraph(): DeclareGraphNode {
    const declare = this.cursor.advance();
    const graph = this.consume(TokenId.GRAPH, "expected-token", "Expected 'graph' after 'declare'.");
    const name = this.parseName();
    const left = this.consume(TokenId.L_CURLY, "expected-token", "Expected '{' after declare graph name.");
    const fields: FieldDeclarationNode[] = [];
    const functions: FunctionDeclarationNode[] = [];
    while (!this.cursor.at(TokenId.R_CURLY) && !this.cursor.at(TokenId.EOF)) {
      if (this.cursor.at(TokenId.FUNC)) functions.push(this.parseFunction([], false));
      else { const field = this.parseField([]); if (field) fields.push(field); else this.recover("Expected declare graph member.", DECLARE_GRAPH_MEMBER_SYNC); }
      this.consumeOptionalSemi();
    }
    const right = this.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after declare graph body.");
    return {
      ...this.nodeSpan("declare-graph", declare.index, this.lastTokenIndex(right ?? functions.at(-1) ?? fields.at(-1) ?? left ?? name ?? graph ?? declare)),
      declareTokenIndex: declare.index, fields, functions, graphTokenIndex: graph?.index, kind: "declare-graph", leftCurlyTokenIndex: left?.index, name, rightCurlyTokenIndex: right?.index,
    };
  }

  /**
   * The reference compiler rejects decorators on graph-body functions and
   * event listeners at syntax level (only fields may carry them), so the
   * parser reports instead of staying silent. Oracle-verified: `[platform_client]`
   * and `[readonly]` on listeners plus `[platform_client]` on functions fail
   * with `extraneous input`, while `[readonly]` on fields compiles.
   */
  private reportBodyDecorators(decorators: readonly DecoratorNode[], what: string): void {
    if (decorators.length === 0) return;
    this.report("unexpected-decorator", `Decorators are not allowed on graph-body ${what}; only fields may carry decorators.`, this.cursor.current().token.range);
  }

  private parseGraphDeclaration(decorators: readonly DecoratorNode[]): GraphDeclarationNode | undefined {
    const staticToken = this.cursor.at(TokenId.STATIC) ? this.cursor.advance() : undefined;
    const graph = this.consume(TokenId.GRAPH, "expected-token", "Expected 'graph'.");
    if (!graph) return undefined;
    const name = this.parseName();
    const left = this.consume(TokenId.L_CURLY, "expected-token", "Expected '{' after graph name.");
    const members: (FieldDeclarationNode | FunctionDeclarationNode | EventDeclarationNode)[] = [];
    while (!this.cursor.at(TokenId.R_CURLY) && !this.cursor.at(TokenId.EOF)) {
      const memberDecorators = this.parseDecorators();
      let member: FieldDeclarationNode | FunctionDeclarationNode | EventDeclarationNode | undefined;
      if (this.cursor.at(TokenId.FUNC) || this.cursor.at(TokenId.ASYNC)) {
        this.reportBodyDecorators(memberDecorators, "functions");
        member = this.parseFunction(memberDecorators, true);
      } else if (this.cursor.at(TokenId.EVENT)) {
        this.reportBodyDecorators(memberDecorators, "event listeners");
        member = this.parseEvent(memberDecorators, true);
      } else member = this.parseField(memberDecorators);
      if (member) members.push(member); else this.recover("Expected a graph member.", GRAPH_MEMBER_SYNC);
      this.consumeOptionalSemi();
    }
    const right = this.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after graph body.");
    return {
      ...this.nodeSpan("graph-declaration", staticToken?.index ?? graph.index, this.lastTokenIndex(right ?? members.at(-1) ?? left ?? name ?? graph)),
      decorators, elements: undefined, graphTokenIndex: graph.index, kind: "graph-declaration", leftCurlyTokenIndex: left?.index, members, name, rightCurlyTokenIndex: right?.index, staticTokenIndex: staticToken?.index,
    };
  }

  private parseField(decorators: readonly DecoratorNode[]): FieldDeclarationNode | undefined {
    const start = this.cursor.current();
    const name = this.parseName();
    if (!name) return undefined;
    const colon = this.cursor.at(TokenId.COLON) ? this.cursor.advance() : undefined;
    const type = this.isTypeStart() ? this.parseDomainType() : undefined;
    const assign = this.cursor.at(TokenId.ASSIGN) ? this.cursor.advance() : undefined;
    const value = assign ? this.parseExpression(0, false, true) : undefined;
    return {
      ...this.nodeSpan("field-declaration", start.index, this.lastTokenIndex(value ?? assign ?? type ?? colon ?? name)),
      assignTokenIndex: assign?.index, colonTokenIndex: colon?.index, decorators, kind: "field-declaration", name, type, value,
    };
  }

  private parseBlock(): BlockNode {
    const left = this.cursor.advance();
    const statements: StatementNode[] = [];
    while (!this.cursor.at(TokenId.R_CURLY) && !this.cursor.at(TokenId.EOF)) {
      const before = this.cursor.checkpoint();
      const statement = this.parseStatement();
      if (statement) statements.push(statement); else this.recover("Expected a statement.", BLOCK_STATEMENT_SYNC);
      this.consumeOptionalSemi();
      if (this.cursor.checkpoint() === before) this.cursor.advance();
    }
    const right = this.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after code block.");
    return { ...this.nodeSpan("block", left.index, this.lastTokenIndex(right ?? statements.at(-1) ?? left)), kind: "block", leftCurlyTokenIndex: left.index, rightCurlyTokenIndex: right?.index, statements };
  }

  private parseStatement(): StatementNode | undefined {
    const current = this.cursor.current();
    if (current.token.kind === TokenId.RETURN) {
      const keyword = this.cursor.advance();
      const next = this.cursor.current().token.kind;
      const expression = this.cursor.at(TokenId.R_CURLY) || RETURN_BARE_FOLLOW_KINDS.has(next) ? undefined : this.parseExpression(0, false, true);
      return { ...this.nodeSpan("return-statement", keyword.index, this.lastTokenIndex(expression ?? keyword)), expression, kind: "return-statement", returnTokenIndex: keyword.index };
    }
    if (current.token.kind === TokenId.BREAK || current.token.kind === TokenId.CONTINUE) {
      const keyword = this.cursor.advance();
      return { ...this.nodeSpan(keyword.token.kind === TokenId.BREAK ? "break-statement" : "continue-statement", keyword.index, keyword.index), kind: keyword.token.kind === TokenId.BREAK ? "break-statement" : "continue-statement", keywordTokenIndex: keyword.index };
    }
    if (current.token.kind === TokenId.VAR) return this.parseVariableStatement();
    if (current.token.kind === TokenId.IF) return this.parseIfStatement();
    if (current.token.kind === TokenId.WHILE) return this.parseWhileStatement();
    if (current.token.kind === TokenId.FOR) return this.parseForStatement();
    if (current.token.kind === TokenId.L_CURLY) return this.parseBlock();
    const left = this.parseExpression(0, false, true);
    if (!left) return undefined;
    if (ASSIGNMENT_KINDS.has(this.cursor.current().token.kind)) {
      const operator = this.cursor.advance(); const right = this.parseExpression(0, false, true);
      return { ...this.nodeSpan("assignment-statement", this.firstTokenIndex(left), this.lastTokenIndex(right ?? operator)), kind: "assignment-statement", left, operator: operator.token.kind as TokenKind, operatorTokenIndex: operator.index, right } satisfies AssignmentStatementNode;
    }
    if (this.cursor.at(TokenId.PLUS_PLUS) || this.cursor.at(TokenId.MINUS_MINUS)) {
      const operator = this.cursor.advance();
      return { ...this.nodeSpan("assignment-statement", this.firstTokenIndex(left), operator.index), kind: "assignment-statement", left, operator: operator.token.kind as TokenKind, operatorTokenIndex: operator.index, right: undefined } satisfies AssignmentStatementNode;
    }
    return { ...this.nodeSpan("expression-statement", this.firstTokenIndex(left), this.lastTokenIndex(left)), expression: left, kind: "expression-statement" };
  }

  private parseVariableStatement(): VariableStatementNode {
    const varToken = this.cursor.advance();
    const name = this.parseName();
    const type = this.isTypeStart() ? this.parseDomainType() : undefined;
    const assign = this.cursor.at(TokenId.ASSIGN) ? this.cursor.advance() : undefined;
    const value = assign ? this.parseExpression(0, false, true) : undefined;
    return { ...this.nodeSpan("variable-statement", varToken.index, this.lastTokenIndex(value ?? assign ?? type ?? name ?? varToken)), assignTokenIndex: assign?.index, kind: "variable-statement", name, type, value, varTokenIndex: varToken.index };
  }

  private parseIfStatement(): IfStatementNode {
    const ifToken = this.cursor.advance(); const condition = this.parseExpression(0, true); const consequent = this.cursor.at(TokenId.L_CURLY) ? this.parseBlock() : undefined;
    let elseTokenIndex: number | undefined; let alternate: BlockNode | IfStatementNode | undefined;
    if (this.cursor.at(TokenId.ELSE)) { elseTokenIndex = this.cursor.advance().index; alternate = this.cursor.at(TokenId.IF) ? this.parseIfStatement() : this.cursor.at(TokenId.L_CURLY) ? this.parseBlock() : undefined; }
    return { ...this.nodeSpan("if-statement", ifToken.index, this.lastTokenIndex(alternate ?? consequent ?? condition ?? ifToken)), alternate, condition, consequent, elseTokenIndex, ifTokenIndex: ifToken.index, kind: "if-statement" };
  }

  private parseWhileStatement(): WhileStatementNode {
    const keyword = this.cursor.advance(); const condition = this.parseExpression(0, true); const body = this.cursor.at(TokenId.L_CURLY) ? this.parseBlock() : undefined;
    return { ...this.nodeSpan("while-statement", keyword.index, this.lastTokenIndex(body ?? condition ?? keyword)), body, condition, kind: "while-statement", whileTokenIndex: keyword.index };
  }

  private parseForStatement(): ForStatementNode {
    const keyword = this.cursor.advance();
    const leftParen = this.cursor.at(TokenId.L_PAREN) ? this.cursor.advance() : undefined;
    const headerStart = this.cursor.current().index;
    const headerCheckpoint = this.cursor.checkpoint();
    const firstName = this.isGeneralIdentifier() ? this.parseName() : undefined;

    if (firstName && this.cursor.at(TokenId.ASSIGN)) {
      const assign = this.cursor.advance();
      const start = this.parseExpression(0, true);
      const commas: number[] = [];
      let end: ExpressionNode | undefined;
      let step: ExpressionNode | undefined;
      if (this.cursor.at(TokenId.COMMA)) {
        commas.push(this.cursor.advance().index);
        end = this.parseExpression(0, true);
        if (this.cursor.at(TokenId.COMMA)) {
          commas.push(this.cursor.advance().index);
          step = this.parseExpression(0, true);
        }
      }
      const rightParen = leftParen ? this.consume(TokenId.R_PAREN, "expected-token", "Expected ')' after for-loop header.") : undefined;
      const body = this.cursor.at(TokenId.L_CURLY) ? this.parseBlock() : undefined;
      return {
        ...this.nodeSpan("for-index-statement", keyword.index, this.lastTokenIndex(body ?? rightParen ?? step ?? end ?? start ?? assign)),
        assignTokenIndex: assign.index,
        binding: firstName,
        body,
        commaTokenIndices: commas,
        end,
        forTokenIndex: keyword.index,
        kind: "for-index-statement",
        leftParenTokenIndex: leftParen?.index,
        rightParenTokenIndex: rightParen?.index,
        start,
        step,
      } satisfies ForStatementNode;
    }

    if (firstName && this.cursor.at(TokenId.COMMA)) {
      const comma = this.cursor.advance();
      const keyBinding = this.isGeneralIdentifier() ? this.parseName() : undefined;
      const inToken = this.consume(TokenId.IN, "expected-token", "Expected 'in' after range loop bindings.");
      const iterable = this.parseExpression(0, true);
      const rightParen = leftParen ? this.consume(TokenId.R_PAREN, "expected-token", "Expected ')' after for-loop header.") : undefined;
      const body = this.cursor.at(TokenId.L_CURLY) ? this.parseBlock() : undefined;
      return {
        ...this.nodeSpan("for-range-statement", keyword.index, this.lastTokenIndex(body ?? iterable ?? inToken ?? keyBinding ?? comma)),
        binding: firstName,
        body,
        forTokenIndex: keyword.index,
        inTokenIndex: inToken?.index,
        kind: "for-range-statement",
        keyBinding,
        iterable,
        leftParenTokenIndex: leftParen?.index,
        rightParenTokenIndex: rightParen?.index,
      } satisfies ForStatementNode;
    }

    this.cursor.restore(headerCheckpoint);
    const expression = this.parseExpression(0, true);
    const rightParen = leftParen ? this.consume(TokenId.R_PAREN, "expected-token", "Expected ')' after for-loop header.") : undefined;
    const body = this.cursor.at(TokenId.L_CURLY) ? this.parseBlock() : undefined;
    return {
      ...this.nodeSpan("for-expression-statement", keyword.index, this.lastTokenIndex(body ?? rightParen ?? expression ?? keyword)),
      body,
      expression,
      forTokenIndex: keyword.index,
      kind: "for-expression-statement",
      leftParenTokenIndex: leftParen?.index,
      rightParenTokenIndex: rightParen?.index,
    } satisfies ForStatementNode;
  }

  private consumeOptionalSemi(): void { if (this.cursor.at(TokenId.SEMI)) this.cursor.advance(); }

  /**
   * Reports once at the failure point, then — when a sync set is given —
   * skips forward to the next sync token so one broken construct yields one
   * diagnostic instead of one per stray token. `R_CURLY`/`EOF` always
   * terminate the skip unconsumed so the owning loop still sees its own
   * closing brace; bracket depth is tracked so the skip stops at an
   * unbalanced close rather than sailing past it. Advances by at least one
   * token unless at `EOF` or `R_CURLY`; a failure positioned exactly at
   * `}` relies on the owning loop's `checkpoint === before` backstop to
   * move past it (without that backstop the loop would retry forever), so
   * termination never depends on `recover` alone. Sites without a loop to
   * resync into (the top-level graph slot) omit `sync` and keep the legacy
   * single-step behavior.
   */
  private recover(message: string, sync?: ReadonlySet<number>): void {
    if (this.cursor.at(TokenId.EOF)) return;
    const token = this.cursor.current();
    this.report("unexpected-token", `${message} Found ${JSON.stringify(token.token.text)}.`, token.token.range);
    if (token.token.kind === TokenId.R_CURLY) return;
    this.cursor.advance();
    if (sync === undefined) return;
    // Braces define construct nesting, so only brace depth gates the
    // `R_CURLY`/sync decision; parens and brackets share a second counter
    // for their own closes. A pile of unbalanced `(`/`[` therefore cannot
    // poison resumption the way a single depth counter would.
    let curlyDepth = 0;
    let groupDepth = 0;
    while (!this.cursor.at(TokenId.EOF)) {
      const kind = this.cursor.current().token.kind;
      if (kind === TokenId.R_CURLY && curlyDepth === 0) return;
      if (curlyDepth === 0 && sync.has(kind)) return;
      if (kind === TokenId.L_CURLY) curlyDepth += 1;
      else if (kind === TokenId.R_CURLY) curlyDepth -= 1;
      else if (kind === TokenId.L_PAREN || kind === TokenId.L_BRACKET) groupDepth += 1;
      else if (kind === TokenId.R_PAREN || kind === TokenId.R_BRACKET) {
        if (groupDepth === 0) return;
        groupDepth -= 1;
      }
      this.cursor.advance();
    }
  }
}
