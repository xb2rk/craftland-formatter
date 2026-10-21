import { TokenId } from "../grammar/token-vocabulary.generated.js";
import { assertNever } from "../syntax/nodes.js";
import type {
  AggregateDeclarationNode, AliasDeclarationNode, AssignmentStatementNode, BlockNode, CallArgumentNode,
  CallExpressionNode, DeclareGraphNode, DefineDeclarationNode, DecoratorNode, DomainTypeNode,
  EnumDeclarationNode, EventDeclarationNode, ExpressionNode, ForIndexStatementNode, ForRangeStatementNode,
  FunctionDeclarationNode, GraphFileNode, HeaderDeclarationNode, HeaderFileNode, IfStatementNode,
  ImportNode, NameNode, StatementNode, TypeCombinationNode, TypeCoreNode, VariableStatementNode,
  WhileStatementNode,
} from "../syntax/nodes.js";
import type { SourceRange } from "../lex/position.js";

export type SymbolKind = "callable" | "field" | "import" | "local" | "loop" | "parameter";
export type ReferenceKind = "call" | "declaration" | "read" | "type-use" | "unknown" | "write";

export interface BoundSymbol {
  readonly declaration: NameNode;
  readonly fromOutVar: boolean;
  readonly id: number;
  /** Index into the file import list when this symbol is an import alias. */
  readonly importIndex: number | undefined;
  /** A formal `out var` parameter is observable by the caller on return. */
  readonly isOutParameter: boolean;
  readonly kind: SymbolKind;
  readonly name: string;
  readonly owner: FunctionDeclarationNode | EventDeclarationNode | undefined;
  readonly reads: readonly BindingReference[];
  readonly scopeId: number;
  readonly writes: readonly BindingReference[];
}

export interface BindingReference {
  readonly kind: ReferenceKind;
  readonly range: SourceRange;
  readonly symbolId: number;
}

/** A name reference that is not declared in the document's lexical scopes. */
export interface UnresolvedBindingReference {
  readonly kind: Extract<ReferenceKind, "call" | "read" | "type-use">;
  readonly name: NameNode;
}

export interface DuplicateBinding {
  readonly duplicate: BoundSymbol;
  readonly original: BoundSymbol;
}

export interface BindingResult {
  readonly duplicates: readonly DuplicateBinding[];
  readonly unresolved: readonly UnresolvedBindingReference[];
  readonly symbols: readonly BoundSymbol[];
}

interface MutableSymbol {
  declaration: NameNode;
  fromOutVar: boolean;
  id: number;
  importIndex: number | undefined;
  isOutParameter: boolean;
  kind: SymbolKind;
  name: string;
  owner: FunctionDeclarationNode | EventDeclarationNode | undefined;
  reads: BindingReference[];
  scopeId: number;
  writes: BindingReference[];
}

interface Scope {
  readonly id: number;
  readonly owner: FunctionDeclarationNode | EventDeclarationNode | undefined;
  readonly parent: Scope | undefined;
  readonly symbols: Map<string, MutableSymbol>;
}

const COMPOUND_ASSIGNMENTS = new Set<number>([
  TokenId.PLUS_ASSIGN, TokenId.MINUS_ASSIGN, TokenId.STAR_ASSIGN, TokenId.DIV_ASSIGN,
  TokenId.MOD_ASSIGN, TokenId.AND_ASSIGN, TokenId.XOR_ASSIGN, TokenId.OR_ASSIGN,
  TokenId.RSHIFT_ASSIGN, TokenId.LSHIFT_ASSIGN,
]);

export function bindFile(file: HeaderFileNode | GraphFileNode): BindingResult {
  return new Binder().bind(file);
}

class Binder {
  private nextScopeId = 1;
  private nextSymbolId = 1;
  private readonly duplicates: DuplicateBinding[] = [];
  private readonly unresolved: UnresolvedBindingReference[] = [];
  private readonly symbols: MutableSymbol[] = [];

  public bind(file: HeaderFileNode | GraphFileNode): BindingResult {
    const root = this.scope(undefined, undefined);
    for (const [index, importNode] of file.imports.entries()) {
      const name = importBindingName(importNode);
      if (name) this.declare(root, name, "import", undefined, false, index);
    }
    if (file.kind === "header-file") {
      for (const declaration of file.declarations) {
        this.visitHeaderDeclaration(declaration, root);
      }
    } else if (file.graph) {
      const graphScope = this.scope(root, undefined);
      this.visitDecorators(file.graph.decorators, graphScope);
      for (const member of file.graph.members ?? []) {
        if (member.kind === "field-declaration") {
          if (member.name) this.declare(graphScope, member.name, "field", undefined, false);
          this.visitDecorators(member.decorators, graphScope);
          this.visitDomainType(member.type, graphScope);
          this.visitExpression(member.value, graphScope);
        } else if (member.kind === "function-declaration") {
          if (member.name) this.declare(graphScope, member.name, "callable", undefined, false);
          this.bindFunction(member, graphScope);
        } else {
          if (member.name?.segments[member.name.segments.length - 1]) {
            const eventName = member.name.segments[member.name.segments.length - 1];
            if (eventName) this.declare(graphScope, eventName, "callable", undefined, false);
          }
          this.visitDecorators(member.decorators, graphScope);
          this.bindEvent(member, graphScope);
        }
      }
    }
    return { duplicates: this.duplicates, symbols: this.symbols, unresolved: this.unresolved };
  }

  private visitHeaderDeclaration(declaration: HeaderDeclarationNode, parent: Scope): void {
    switch (declaration.kind) {
      case "define-declaration":
        this.visitDecorators(declaration.decorators, parent);
        this.visitDomainType(declaration.type, parent);
        return;
      case "alias-declaration":
        this.visitDecorators(declaration.decorators, parent);
        this.visitTypeCombination(declaration.type, parent);
        return;
      case "enum-declaration":
        this.visitDecorators(declaration.decorators, parent);
        this.visitEnum(declaration, parent);
        return;
      case "component-declaration":
      case "tuple-declaration":
        this.visitAggregate(declaration, parent);
        return;
      case "function-declaration":
        if (declaration.name) this.declare(parent, declaration.name, "callable", undefined, false);
        this.bindFunction(declaration, parent);
        return;
      case "event-declaration": {
        const name = declaration.name?.segments.at(-1);
        if (name) this.declare(parent, name, "callable", undefined, false);
        this.bindEvent(declaration, parent);
        return;
      }
      case "declare-graph":
        this.visitDeclareGraph(declaration, parent);
        return;
      default: return assertNever(declaration);
    }
  }

  private visitAggregate(declaration: AggregateDeclarationNode, parent: Scope): void {
    this.visitDecorators(declaration.decorators, parent);
    const scope = this.scope(parent, undefined);
    for (const member of declaration.fields) {
      if (member.name) this.declare(scope, member.name, "field", undefined, false);
      this.visitDecorators(member.decorators, scope);
      this.visitDomainType(member.type, scope);
      this.visitExpression(member.value, scope);
    }
  }

  private visitEnum(declaration: EnumDeclarationNode, parent: Scope): void {
    const scope = this.scope(parent, undefined);
    for (const member of declaration.members) {
      this.visitDecorators(member.decorators, scope);
      this.visitExpression(member.value, scope);
    }
  }

  private visitDeclareGraph(declaration: DeclareGraphNode, parent: Scope): void {
    const scope = this.scope(parent, undefined);
    for (const field of declaration.fields) {
      if (field.name) this.declare(scope, field.name, "field", undefined, false);
      this.visitDecorators(field.decorators, scope);
      this.visitDomainType(field.type, scope);
      this.visitExpression(field.value, scope);
    }
    for (const fn of declaration.functions) {
      if (fn.name) this.declare(scope, fn.name, "callable", undefined, false);
      this.bindFunction(fn, scope);
    }
  }

  private bindFunction(fn: FunctionDeclarationNode, parent: Scope): void {
    const scope = this.scope(parent, fn);
    this.visitDecorators(fn.decorators, parent);
    for (const parameter of fn.signature?.parameters ?? []) {
      this.visitDomainType(parameter.type, parent);
      if (parameter.name) this.declare(scope, parameter.name, "parameter", fn, false, undefined, parameter.outTokenIndex !== undefined);
    }
    this.visitDomainType(fn.result, parent);
    if (fn.body) this.visitBlock(fn.body, scope);
  }

  private bindEvent(event: EventDeclarationNode, parent: Scope): void {
    const scope = this.scope(parent, event);
    this.visitDecorators(event.decorators, parent);
    for (const parameter of event.signature?.parameters ?? []) {
      this.visitDomainType(parameter.type, parent);
      if (parameter.name) this.declare(scope, parameter.name, "parameter", event, false, undefined, parameter.outTokenIndex !== undefined);
    }
    if (event.body) this.visitBlock(event.body, scope);
  }

  private scope(parent: Scope | undefined, owner: FunctionDeclarationNode | EventDeclarationNode | undefined): Scope {
    return { id: this.nextScopeId++, owner, parent, symbols: new Map() };
  }

  private declare(scope: Scope, declaration: NameNode, kind: SymbolKind, owner: FunctionDeclarationNode | EventDeclarationNode | undefined, fromOutVar: boolean, importIndex: number | undefined = undefined, isOutParameter = false): MutableSymbol {
    const symbol: MutableSymbol = { declaration, fromOutVar, id: this.nextSymbolId++, importIndex, isOutParameter, kind, name: declaration.text, owner, reads: [], scopeId: scope.id, writes: [] };
    const original = scope.symbols.get(symbol.name);
    if (original) this.duplicates.push({ duplicate: symbol, original });
    scope.symbols.set(symbol.name, symbol);
    this.symbols.push(symbol);
    return symbol;
  }

  private lookup(scope: Scope, name: string): MutableSymbol | undefined {
    for (let current: Scope | undefined = scope; current; current = current.parent) {
      const symbol = current.symbols.get(name);
      if (symbol) return symbol;
    }
    return undefined;
  }

  private reference(scope: Scope, name: NameNode, kind: ReferenceKind): void {
    const symbol = this.lookup(scope, name.text);
    if (!symbol) {
      if (kind === "call" || kind === "read" || kind === "type-use") {
        this.unresolved.push({ kind, name });
      }
      return;
    }
    const reference = { kind, range: name.range, symbolId: symbol.id } satisfies BindingReference;
    if (kind === "read" || kind === "call" || kind === "type-use") symbol.reads.push(reference);
    if (kind === "write" || kind === "declaration") symbol.writes.push(reference);
  }

  private visitBlock(block: BlockNode, parent: Scope): void {
    const scope = this.scope(parent, parent.owner);
    for (const statement of block.statements) this.visitStatement(statement, scope);
  }

  private visitStatement(statement: StatementNode, scope: Scope): void {
    switch (statement.kind) {
      case "variable-statement": this.visitVariable(statement, scope); return;
      case "assignment-statement": this.visitAssignment(statement, scope); return;
      case "expression-statement": this.visitExpression(statement.expression, scope); return;
      case "return-statement": this.visitExpression(statement.expression, scope); return;
      case "block": this.visitBlock(statement, scope); return;
      case "if-statement": this.visitIf(statement, scope); return;
      case "while-statement":
        this.visitExpression(statement.condition, scope);
        if (statement.body) this.visitBlock(statement.body, scope);
        return;
      case "for-index-statement": this.visitIndexLoop(statement, scope); return;
      case "for-range-statement": this.visitRangeLoop(statement, scope); return;
      case "for-expression-statement":
        this.visitExpression(statement.expression, scope);
        if (statement.body) this.visitBlock(statement.body, scope);
        return;
      case "break-statement":
      case "continue-statement": return;
      default: return assertNever(statement);
    }
  }

  private visitVariable(statement: VariableStatementNode, scope: Scope): void {
    this.visitDomainType(statement.type, scope);
    const symbol = statement.name ? this.declare(scope, statement.name, "local", scope.owner, false) : undefined;
    if (symbol && statement.assignTokenIndex !== undefined) symbol.writes.push({ kind: "declaration", range: statement.name?.range ?? statement.range, symbolId: symbol.id });
    this.visitExpression(statement.value, scope);
  }

  private visitAssignment(statement: AssignmentStatementNode, scope: Scope): void {
    if (statement.left?.kind === "name-expression") {
      this.reference(scope, statement.left.name, "write");
      if (COMPOUND_ASSIGNMENTS.has(statement.operator)) this.reference(scope, statement.left.name, "read");
    } else this.visitExpression(statement.left, scope);
    this.visitExpression(statement.right, scope);
  }

  private visitIf(statement: IfStatementNode, scope: Scope): void {
    this.visitExpression(statement.condition, scope);
    if (statement.consequent) this.visitBlock(statement.consequent, scope);
    if (statement.alternate?.kind === "if-statement") this.visitIf(statement.alternate, scope);
    else if (statement.alternate) this.visitBlock(statement.alternate, scope);
  }

  private visitIndexLoop(statement: ForIndexStatementNode, scope: Scope): void {
    this.visitExpression(statement.start, scope);
    this.visitExpression(statement.end, scope);
    this.visitExpression(statement.step, scope);
    const loopScope = this.scope(scope, scope.owner);
    if (statement.binding) this.declare(loopScope, statement.binding, "loop", scope.owner, false);
    if (statement.body) this.visitBlock(statement.body, loopScope);
  }

  private visitRangeLoop(statement: ForRangeStatementNode, scope: Scope): void {
    this.visitExpression(statement.iterable, scope);
    const loopScope = this.scope(scope, scope.owner);
    if (statement.binding) this.declare(loopScope, statement.binding, "loop", scope.owner, false);
    if (statement.keyBinding) this.declare(loopScope, statement.keyBinding, "loop", scope.owner, false);
    if (statement.body) this.visitBlock(statement.body, loopScope);
  }

  private visitExpression(expression: ExpressionNode | undefined, scope: Scope): void {
    if (!expression) return;
    switch (expression.kind) {
      case "name-expression": this.reference(scope, expression.name, "read"); return;
      case "literal-expression":
      case "entity-reference-expression": return;
      case "parenthesized-expression": this.visitExpression(expression.expression, scope); return;
      case "unary-expression": this.visitExpression(expression.operand, scope); return;
      case "binary-expression": this.visitExpression(expression.left, scope); this.visitExpression(expression.right, scope); return;
      case "cast-expression": this.visitExpression(expression.expression, scope); this.visitDomainType(expression.type, scope); return;
      case "typeof-expression": this.visitDomainType(expression.type, scope); return;
      case "member-expression": this.visitExpression(expression.object, scope); return;
      case "index-expression": this.visitExpression(expression.object, scope); this.visitExpression(expression.index, scope); return;
      case "generic-access-expression": this.visitExpression(expression.object, scope); this.visitDomainType(expression.typeArgument, scope); return;
      case "call-expression": this.visitCall(expression, scope); return;
      case "prefixed-call-expression": this.visitExpression(expression.call, scope); return;
      case "positional-composite-expression": this.visitDomainType(expression.type, scope); for (const entry of expression.entries) this.visitExpression(entry, scope); return;
      case "map-composite-expression": this.visitDomainType(expression.type, scope); for (const entry of expression.entries) { this.visitExpression(entry.key, scope); this.visitExpression(entry.value, scope); } return;
      case "struct-composite-expression":
        for (const segment of expression.typeName.segments) this.reference(scope, segment, "type-use");
        for (const field of expression.fields) this.visitExpression(field.value, scope);
        return;
      case "loc-string-expression": this.visitExpression(expression.key, scope); this.visitExpression(expression.arguments, scope); return;
      default: return assertNever(expression);
    }
  }

  private visitDecorators(decorators: readonly DecoratorNode[], scope: Scope): void {
    for (const decorator of decorators) for (const argument of decorator.arguments) this.visitDomainType(argument, scope);
  }

  private visitDomainType(domain: DomainTypeNode | undefined, scope: Scope): void {
    if (!domain) return;
    if (domain.domain) this.reference(scope, domain.domain, "type-use");
    this.visitTypeCore(domain.type, scope);
  }

  private visitTypeCore(type: TypeCoreNode, scope: Scope): void {
    switch (type.kind) {
      case "scalar-type":
        if (!type.reserved) this.reference(scope, type.name, "type-use");
        return;
      case "generic-type":
        this.reference(scope, type.constructorName, "type-use");
        for (const argument of type.arguments) this.visitDomainType(argument, scope);
        return;
      case "function-type":
        for (const parameter of type.parameters) this.visitDomainType(parameter.type, scope);
        this.visitDomainType(type.result, scope);
        return;
      default: return assertNever(type);
    }
  }

  private visitTypeCombination(type: TypeCombinationNode | DomainTypeNode | undefined, scope: Scope): void {
    if (!type) return;
    if (type.kind === "type-combination") {
      this.visitTypeCombination(type.left, scope);
      this.visitTypeCombination(type.right, scope);
    } else this.visitDomainType(type, scope);
  }

  private visitCall(call: CallExpressionNode, scope: Scope): void {
    if (call.callee.kind === "name-expression") this.reference(scope, call.callee.name, "call");
    else this.visitExpression(call.callee, scope);
    for (const argument of call.arguments) this.visitArgument(argument, scope);
  }

  private visitArgument(argument: CallArgumentNode, scope: Scope): void {
    if (argument.kind === "out-var-argument") {
      if (argument.name) {
        const symbol = this.declare(scope, argument.name, "local", scope.owner, true);
        symbol.writes.push({ kind: "declaration", range: argument.name.range, symbolId: symbol.id });
      }
    } else this.visitExpression(argument, scope);
  }
}

function importBindingName(importNode: ImportNode): NameNode | undefined {
  return importNode.kind === "library-import" ? importNode.alias : importNode.alias ?? importNode.imported;
}
