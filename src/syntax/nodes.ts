import type { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { SourceRange } from "../lex/position.js";

/** Half-open indices into the original lossless token stream. */
export interface TokenIndexRange {
  readonly end: number;
  readonly start: number;
}

/** Every syntax node is source-referential; it never owns rewritten text. */
export interface SyntaxNode {
  readonly kind: string;
  readonly range: SourceRange;
  readonly tokenRange: TokenIndexRange;
}

export interface NameNode extends SyntaxNode {
  readonly kind: "name";
  readonly text: string;
  readonly tokenIndex: number;
}

export interface QualifiedNameNode extends SyntaxNode {
  readonly dotTokenIndices: readonly number[];
  readonly kind: "qualified-name";
  readonly segments: readonly NameNode[];
  readonly text: string;
}

export interface DomainTypeNode extends SyntaxNode {
  readonly domain: NameNode | undefined;
  readonly dotTokenIndex: number | undefined;
  readonly kind: "domain-type";
  readonly type: TypeCoreNode;
}

export interface ScalarTypeNode extends SyntaxNode {
  readonly kind: "scalar-type";
  readonly name: NameNode;
  readonly reserved: boolean;
}

export interface GenericTypeNode extends SyntaxNode {
  readonly arguments: readonly DomainTypeNode[];
  readonly closeAngleTokenIndex: number | undefined;
  readonly commaTokenIndices: readonly number[];
  readonly constructorName: NameNode;
  readonly kind: "generic-type";
  readonly openAngleTokenIndex: number | undefined;
}

export interface FunctionTypeParameterNode extends SyntaxNode {
  readonly kind: "function-type-parameter";
  readonly name: NameNode;
  readonly outTokenIndex: number | undefined;
  readonly type: DomainTypeNode;
  readonly varTokenIndex: number | undefined;
}

export interface FunctionTypeNode extends SyntaxNode {
  readonly commaTokenIndices: readonly number[];
  readonly funcTokenIndex: number;
  readonly kind: "function-type";
  readonly leftParenTokenIndex: number | undefined;
  readonly parameters: readonly FunctionTypeParameterNode[];
  readonly result: DomainTypeNode | undefined;
  readonly rightParenTokenIndex: number | undefined;
}

export type TypeCoreNode = ScalarTypeNode | GenericTypeNode | FunctionTypeNode;

export interface LiteralExpressionNode extends SyntaxNode {
  readonly kind: "literal-expression";
  readonly literalKind: "boolean" | "color" | "float" | "imaginary" | "integer" | "nil" | "raw-string" | "rune" | "string";
  readonly tokenIndex: number;
}

export interface NameExpressionNode extends SyntaxNode {
  readonly kind: "name-expression";
  readonly name: NameNode;
}

export interface EntityReferenceExpressionNode extends SyntaxNode {
  readonly kind: "entity-reference-expression";
  readonly reference: "globalEntity" | "thisEntity";
  readonly tokenIndex: number;
}

export interface ParenthesizedExpressionNode extends SyntaxNode {
  readonly expression: ExpressionNode | undefined;
  readonly kind: "parenthesized-expression";
  readonly leftParenTokenIndex: number;
  readonly rightParenTokenIndex: number | undefined;
}

export interface UnaryExpressionNode extends SyntaxNode {
  readonly kind: "unary-expression";
  readonly operand: ExpressionNode | undefined;
  readonly operator: TokenId;
  readonly operatorTokenIndex: number;
}

export interface BinaryExpressionNode extends SyntaxNode {
  readonly kind: "binary-expression";
  readonly left: ExpressionNode;
  readonly operator: TokenId;
  readonly operatorTokenIndices: readonly number[];
  readonly right: ExpressionNode | undefined;
}

export interface CastExpressionNode extends SyntaxNode {
  readonly expression: ExpressionNode;
  readonly kind: "cast-expression";
  readonly asTokenIndex: number;
  readonly type: DomainTypeNode | undefined;
}

export interface OutVarArgumentNode extends SyntaxNode {
  readonly kind: "out-var-argument";
  readonly name: NameNode | undefined;
  readonly outTokenIndex: number;
  readonly varTokenIndex: number | undefined;
}

export type CallArgumentNode = ExpressionNode | OutVarArgumentNode;

export interface CallExpressionNode extends SyntaxNode {
  readonly arguments: readonly CallArgumentNode[];
  readonly callee: ExpressionNode;
  readonly commaTokenIndices: readonly number[];
  readonly kind: "call-expression";
  readonly leftParenTokenIndex: number;
  readonly rightParenTokenIndex: number | undefined;
  readonly trailingCommaTokenIndex: number | undefined;
}

export interface PrefixedCallExpressionNode extends SyntaxNode {
  readonly call: CallExpressionNode | undefined;
  readonly kind: "prefixed-call-expression";
  readonly prefix: "start" | "wait";
  readonly prefixTokenIndex: number;
  readonly target: ExpressionNode | undefined;
}

export interface IndexExpressionNode extends SyntaxNode {
  readonly index: ExpressionNode | undefined;
  readonly kind: "index-expression";
  readonly leftBracketTokenIndex: number;
  readonly object: ExpressionNode;
  readonly rightBracketTokenIndex: number | undefined;
}

export interface MemberExpressionNode extends SyntaxNode {
  readonly kind: "member-expression";
  readonly member: NameNode | undefined;
  readonly object: ExpressionNode;
  readonly dotTokenIndex: number;
}

export interface GenericAccessExpressionNode extends SyntaxNode {
  readonly closeAngleTokenIndex: number;
  readonly kind: "generic-access-expression";
  readonly object: ExpressionNode;
  readonly openAngleTokenIndex: number;
  readonly typeArgument: DomainTypeNode;
}

export interface TypeofExpressionNode extends SyntaxNode {
  readonly kind: "typeof-expression";
  readonly leftParenTokenIndex: number | undefined;
  readonly rightParenTokenIndex: number | undefined;
  readonly type: DomainTypeNode | undefined;
  readonly typeofTokenIndex: number;
}

export interface PositionalCompositeExpressionNode extends SyntaxNode {
  readonly commaTokenIndices: readonly number[];
  readonly entries: readonly ExpressionNode[];
  readonly kind: "positional-composite-expression";
  readonly leftCurlyTokenIndex: number;
  readonly rightCurlyTokenIndex: number | undefined;
  readonly trailingCommaTokenIndex: number | undefined;
  readonly type: DomainTypeNode | undefined;
}

export interface MapCompositeEntryNode extends SyntaxNode {
  readonly colonTokenIndex: number | undefined;
  readonly key: ExpressionNode | undefined;
  readonly kind: "map-composite-entry";
  readonly value: ExpressionNode | undefined;
}

export interface MapCompositeExpressionNode extends SyntaxNode {
  readonly commaTokenIndices: readonly number[];
  readonly entries: readonly MapCompositeEntryNode[];
  readonly kind: "map-composite-expression";
  readonly leftCurlyTokenIndex: number;
  readonly rightCurlyTokenIndex: number | undefined;
  readonly trailingCommaTokenIndex: number | undefined;
  readonly type: DomainTypeNode | undefined;
}

export interface StructCompositeFieldNode extends SyntaxNode {
  readonly assignTokenIndex: number | undefined;
  readonly kind: "struct-composite-field";
  readonly name: NameNode | undefined;
  readonly value: ExpressionNode | undefined;
}

export interface StructCompositeExpressionNode extends SyntaxNode {
  readonly commaTokenIndices: readonly number[];
  readonly fields: readonly StructCompositeFieldNode[];
  readonly kind: "struct-composite-expression";
  readonly leftCurlyTokenIndex: number;
  readonly rightCurlyTokenIndex: number | undefined;
  readonly trailingCommaTokenIndex: number | undefined;
  readonly typeName: QualifiedNameNode;
}

export interface LocStringExpressionNode extends SyntaxNode {
  readonly arguments: PositionalCompositeExpressionNode | undefined;
  readonly commaTokenIndex: number | undefined;
  readonly key: ExpressionNode | undefined;
  readonly kind: "loc-string-expression";
  readonly leftCurlyTokenIndex: number | undefined;
  readonly locStringTokenIndex: number;
  readonly rightCurlyTokenIndex: number | undefined;
}

export type ExpressionNode =
  | LiteralExpressionNode
  | NameExpressionNode
  | EntityReferenceExpressionNode
  | ParenthesizedExpressionNode
  | UnaryExpressionNode
  | BinaryExpressionNode
  | CastExpressionNode
  | CallExpressionNode
  | PrefixedCallExpressionNode
  | IndexExpressionNode
  | MemberExpressionNode
  | GenericAccessExpressionNode
  | TypeofExpressionNode
  | PositionalCompositeExpressionNode
  | MapCompositeExpressionNode
  | StructCompositeExpressionNode
  | LocStringExpressionNode;

export interface DecoratorNode extends SyntaxNode {
  readonly arguments: readonly DomainTypeNode[];
  readonly commaTokenIndices: readonly number[];
  readonly kind: "decorator";
  readonly leftBracketTokenIndex: number;
  readonly name: NameNode | undefined;
  readonly rightBracketTokenIndex: number | undefined;
}

export interface LibraryImportNode extends SyntaxNode {
  readonly alias: NameNode | undefined;
  readonly asTokenIndex: number | undefined;
  readonly importTokenIndex: number;
  readonly kind: "library-import";
  readonly pathTokenIndex: number | undefined;
}

export interface NamedImportNode extends SyntaxNode {
  readonly alias: NameNode | undefined;
  readonly asTokenIndex: number | undefined;
  readonly fromTokenIndex: number | undefined;
  readonly importTokenIndex: number;
  readonly imported: NameNode | undefined;
  readonly kind: "named-import";
  readonly pathTokenIndex: number | undefined;
}

export type ImportNode = LibraryImportNode | NamedImportNode;

export interface TypeCombinationNode extends SyntaxNode {
  readonly kind: "type-combination";
  readonly left: DomainTypeNode | TypeCombinationNode;
  readonly operator: TokenId;
  readonly operatorTokenIndex: number;
  readonly right: DomainTypeNode | TypeCombinationNode | undefined;
}

export interface FieldDeclarationNode extends SyntaxNode {
  readonly assignTokenIndex: number | undefined;
  readonly colonTokenIndex: number | undefined;
  readonly decorators: readonly DecoratorNode[];
  readonly kind: "field-declaration";
  readonly name: NameNode | undefined;
  readonly type: DomainTypeNode | undefined;
  readonly value: ExpressionNode | undefined;
}

export interface EnumMemberNode extends SyntaxNode {
  readonly assignTokenIndex: number | undefined;
  readonly decorators: readonly DecoratorNode[];
  readonly kind: "enum-member";
  readonly name: NameNode | undefined;
  readonly value: ExpressionNode | undefined;
}

export interface ParameterNode extends SyntaxNode {
  readonly kind: "parameter";
  readonly name: NameNode | undefined;
  readonly outTokenIndex: number | undefined;
  readonly type: DomainTypeNode | undefined;
  readonly varTokenIndex: number | undefined;
}

export interface SignatureNode extends SyntaxNode {
  readonly commaTokenIndices: readonly number[];
  readonly kind: "signature";
  readonly leftParenTokenIndex: number | undefined;
  readonly parameters: readonly ParameterNode[];
  readonly rightParenTokenIndex: number | undefined;
  readonly trailingCommaTokenIndex: number | undefined;
}

export interface DefineDeclarationNode extends SyntaxNode {
  readonly colonTokenIndex: number | undefined;
  readonly decorators: readonly DecoratorNode[];
  readonly defineTokenIndex: number;
  readonly equalsTokenIndex: number | undefined;
  readonly kind: "define-declaration";
  readonly name: NameNode | undefined;
  readonly type: DomainTypeNode | undefined;
}

export interface AliasDeclarationNode extends SyntaxNode {
  readonly decorators: readonly DecoratorNode[];
  readonly equalsTokenIndex: number | undefined;
  readonly kind: "alias-declaration";
  readonly name: NameNode | undefined;
  readonly type: TypeCombinationNode | DomainTypeNode | undefined;
}

export interface EnumDeclarationNode extends SyntaxNode {
  readonly decorators: readonly DecoratorNode[];
  readonly enumTokenIndex: number;
  readonly kind: "enum-declaration";
  readonly leftCurlyTokenIndex: number | undefined;
  readonly members: readonly EnumMemberNode[];
  readonly name: NameNode | undefined;
  readonly rightCurlyTokenIndex: number | undefined;
}

export interface AggregateDeclarationNode extends SyntaxNode {
  readonly decorators: readonly DecoratorNode[];
  readonly fields: readonly FieldDeclarationNode[];
  readonly kind: "component-declaration" | "tuple-declaration";
  readonly keywordTokenIndex: number;
  readonly leftCurlyTokenIndex: number | undefined;
  readonly name: NameNode | undefined;
  readonly rightCurlyTokenIndex: number | undefined;
}

export interface FunctionDeclarationNode extends SyntaxNode {
  readonly asyncTokenIndex: number | undefined;
  readonly body: BlockNode | undefined;
  readonly decorators: readonly DecoratorNode[];
  readonly funcTokenIndex: number;
  readonly kind: "function-declaration";
  readonly name: NameNode | undefined;
  readonly result: DomainTypeNode | undefined;
  readonly signature: SignatureNode | undefined;
}

export interface EventDeclarationNode extends SyntaxNode {
  readonly body: BlockNode | undefined;
  readonly decorators: readonly DecoratorNode[];
  readonly eventTokenIndex: number;
  readonly kind: "event-declaration";
  readonly name: QualifiedNameNode | undefined;
  readonly signature: SignatureNode | undefined;
}

export interface DeclareGraphNode extends SyntaxNode {
  readonly declareTokenIndex: number;
  readonly fields: readonly FieldDeclarationNode[];
  readonly functions: readonly FunctionDeclarationNode[];
  readonly graphTokenIndex: number | undefined;
  readonly kind: "declare-graph";
  readonly leftCurlyTokenIndex: number | undefined;
  readonly name: NameNode | undefined;
  readonly rightCurlyTokenIndex: number | undefined;
}

export type HeaderDeclarationNode = DefineDeclarationNode | AliasDeclarationNode | EnumDeclarationNode | AggregateDeclarationNode | FunctionDeclarationNode | EventDeclarationNode | DeclareGraphNode;

export interface ExpressionStatementNode extends SyntaxNode { readonly expression: ExpressionNode | undefined; readonly kind: "expression-statement"; }
export interface ReturnStatementNode extends SyntaxNode { readonly expression: ExpressionNode | undefined; readonly kind: "return-statement"; readonly returnTokenIndex: number; }
export interface SimpleStatementNode extends SyntaxNode { readonly kind: "break-statement" | "continue-statement"; readonly keywordTokenIndex: number; }
export interface VariableStatementNode extends SyntaxNode { readonly assignTokenIndex: number | undefined; readonly kind: "variable-statement"; readonly name: NameNode | undefined; readonly type: DomainTypeNode | undefined; readonly value: ExpressionNode | undefined; readonly varTokenIndex: number; }
export interface AssignmentStatementNode extends SyntaxNode { readonly kind: "assignment-statement"; readonly left: ExpressionNode | undefined; readonly operator: TokenId; readonly operatorTokenIndex: number; readonly right: ExpressionNode | undefined; }
export interface BlockNode extends SyntaxNode { readonly kind: "block"; readonly leftCurlyTokenIndex: number; readonly rightCurlyTokenIndex: number | undefined; readonly statements: readonly StatementNode[]; }
export interface IfStatementNode extends SyntaxNode { readonly alternate: BlockNode | IfStatementNode | undefined; readonly condition: ExpressionNode | undefined; readonly consequent: BlockNode | undefined; readonly elseTokenIndex: number | undefined; readonly ifTokenIndex: number; readonly kind: "if-statement"; }
export interface WhileStatementNode extends SyntaxNode { readonly body: BlockNode | undefined; readonly condition: ExpressionNode | undefined; readonly kind: "while-statement"; readonly whileTokenIndex: number; }
export interface ForIndexStatementNode extends SyntaxNode {
  readonly binding: NameNode | undefined;
  readonly body: BlockNode | undefined;
  readonly commaTokenIndices: readonly number[];
  readonly end: ExpressionNode | undefined;
  readonly forTokenIndex: number;
  readonly kind: "for-index-statement";
  readonly leftParenTokenIndex: number | undefined;
  readonly rightParenTokenIndex: number | undefined;
  readonly step: ExpressionNode | undefined;
  readonly start: ExpressionNode | undefined;
  readonly assignTokenIndex: number | undefined;
}

export interface ForRangeStatementNode extends SyntaxNode {
  readonly binding: NameNode | undefined;
  readonly body: BlockNode | undefined;
  readonly forTokenIndex: number;
  readonly inTokenIndex: number | undefined;
  readonly kind: "for-range-statement";
  readonly leftParenTokenIndex: number | undefined;
  readonly rightParenTokenIndex: number | undefined;
  readonly keyBinding: NameNode | undefined;
  readonly iterable: ExpressionNode | undefined;
}

/** A compiler-accepted expression-header form retained for forward compatibility. */
export interface ForExpressionStatementNode extends SyntaxNode {
  readonly body: BlockNode | undefined;
  readonly expression: ExpressionNode | undefined;
  readonly forTokenIndex: number;
  readonly kind: "for-expression-statement";
  readonly leftParenTokenIndex: number | undefined;
  readonly rightParenTokenIndex: number | undefined;
}

export type ForStatementNode = ForIndexStatementNode | ForRangeStatementNode | ForExpressionStatementNode;
export type StatementNode = ExpressionStatementNode | ReturnStatementNode | SimpleStatementNode | VariableStatementNode | AssignmentStatementNode | BlockNode | IfStatementNode | WhileStatementNode | ForStatementNode;

export interface GraphDeclarationNode extends SyntaxNode {
  readonly decorators: readonly DecoratorNode[];
  readonly elements: readonly FieldDeclarationNode[] | undefined;
  readonly graphTokenIndex: number;
  readonly kind: "graph-declaration";
  readonly leftCurlyTokenIndex: number | undefined;
  readonly members: readonly (FieldDeclarationNode | FunctionDeclarationNode | EventDeclarationNode)[] | undefined;
  readonly name: NameNode | undefined;
  readonly rightCurlyTokenIndex: number | undefined;
  readonly staticTokenIndex: number | undefined;
}

export interface HeaderFileNode extends SyntaxNode { readonly declarations: readonly HeaderDeclarationNode[]; readonly imports: readonly ImportNode[]; readonly kind: "header-file"; }
export interface GraphFileNode extends SyntaxNode { readonly graph: GraphDeclarationNode | undefined; readonly imports: readonly ImportNode[]; readonly kind: "graph-file"; }

/** Umbrella union of every concrete syntax node kind. */
export type AnySyntaxNode =
  | NameNode
  | QualifiedNameNode
  | DomainTypeNode
  | ScalarTypeNode
  | GenericTypeNode
  | FunctionTypeParameterNode
  | FunctionTypeNode
  | LiteralExpressionNode
  | NameExpressionNode
  | EntityReferenceExpressionNode
  | ParenthesizedExpressionNode
  | UnaryExpressionNode
  | BinaryExpressionNode
  | CastExpressionNode
  | OutVarArgumentNode
  | CallExpressionNode
  | PrefixedCallExpressionNode
  | IndexExpressionNode
  | MemberExpressionNode
  | GenericAccessExpressionNode
  | TypeofExpressionNode
  | PositionalCompositeExpressionNode
  | MapCompositeEntryNode
  | MapCompositeExpressionNode
  | StructCompositeFieldNode
  | StructCompositeExpressionNode
  | LocStringExpressionNode
  | DecoratorNode
  | LibraryImportNode
  | NamedImportNode
  | TypeCombinationNode
  | FieldDeclarationNode
  | EnumMemberNode
  | ParameterNode
  | SignatureNode
  | DefineDeclarationNode
  | AliasDeclarationNode
  | EnumDeclarationNode
  | AggregateDeclarationNode
  | FunctionDeclarationNode
  | EventDeclarationNode
  | DeclareGraphNode
  | ExpressionStatementNode
  | ReturnStatementNode
  | SimpleStatementNode
  | VariableStatementNode
  | AssignmentStatementNode
  | BlockNode
  | IfStatementNode
  | WhileStatementNode
  | ForIndexStatementNode
  | ForRangeStatementNode
  | ForExpressionStatementNode
  | GraphDeclarationNode
  | HeaderFileNode
  | GraphFileNode;

/** Type guard for AST-shaped values: the single sanctioned duck-typing seam. */
export function isSyntaxNodeValue(value: unknown): value is AnySyntaxNode {
  return !!value && typeof value === "object" && typeof (value as { readonly kind?: unknown }).kind === "string";
}

/**
 * Throw on a value the type system proves unreachable. Add
 * `default: assertNever(node)` to an exhaustive kind-switch and a new node
 * kind fails compilation at exactly the right site instead of silently
 * falling through at runtime.
 */
export function assertNever(value: never, message = "Unexpected syntax node kind."): never {
  throw new Error(`${message} Received: ${JSON.stringify(value)}`);
}

/** Return the immediate child nodes of any syntax node (depth-first order). */
export function astChildren(node: AnySyntaxNode): readonly AnySyntaxNode[] {
  const result: AnySyntaxNode[] = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isSyntaxNodeValue(item)) result.push(item);
      }
    } else if (isSyntaxNodeValue(value)) {
      result.push(value);
    }
  }
  return result;
}

/**
 * Generic depth-first AST walker.  Visits every descendant before its parent.
 * Return "skip" from the visitor to suppress recursion into that node's
 * children (the exit callback is still called for the skipped node).
 */
export function walkAst(
  root: AnySyntaxNode | readonly AnySyntaxNode[],
  visitor: (node: AnySyntaxNode) => "skip" | void,
  exit?: (node: AnySyntaxNode) => void,
): void {
  if (Array.isArray(root)) {
    for (const item of root) walkAst(item, visitor, exit);
    return;
  }
  const node = root as AnySyntaxNode;
  if (visitor(node) === "skip") { exit?.(node); return; }
  for (const child of astChildren(node)) walkAst(child, visitor, exit);
  exit?.(node);
}
