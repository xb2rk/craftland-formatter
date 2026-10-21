import { TokenId } from "../grammar/token-vocabulary.generated.js";
import { assertNever } from "../syntax/nodes.js";
import type { BindingReference, BindingResult } from "./binder.js";
import type { Token } from "../lex/token.js";
import type {
  AssignmentStatementNode, BlockNode, CallArgumentNode, CallExpressionNode, ExpressionNode,
  ForExpressionStatementNode, IfStatementNode, NameNode, OutVarArgumentNode, StatementNode, VariableStatementNode,
  WhileStatementNode,
} from "../syntax/nodes.js";
import type { SourceRange } from "../lex/position.js";
import { buildControlFlowGraph, type ControlFlowGraph, type ControlFlowNode } from "./cfg.js";

export interface DeadStore {
  readonly range: SourceRange;
  readonly symbolId: number;
}

export interface ConstantCondition {
  readonly range: SourceRange;
  readonly statement: ConditionStatement;
  readonly value: boolean;
}

type ConditionStatement = IfStatementNode | WhileStatementNode | ForExpressionStatementNode;

export interface ControlFlowAnalysis {
  readonly constantConditions: readonly ConstantCondition[];
  readonly deadStores: readonly DeadStore[];
  readonly graph: ControlFlowGraph;
  readonly unreachable: readonly ControlFlowNode[];
}

interface WriteEffect {
  readonly declaration: boolean;
  readonly range: SourceRange;
  readonly symbolId: number;
}

interface NodeEffects {
  readonly reads: Set<number>;
  unknown: boolean;
  readonly writes: WriteEffect[];
}

interface ReferenceIndex {
  readonly byRange: ReadonlyMap<string, readonly BindingReference[]>;
  readonly symbols: ReadonlyMap<number, BindingResult["symbols"][number]>;
}

const COMPOUND_ASSIGNMENTS = new Set<number>([
  TokenId.PLUS_ASSIGN, TokenId.MINUS_ASSIGN, TokenId.STAR_ASSIGN, TokenId.DIV_ASSIGN,
  TokenId.MOD_ASSIGN, TokenId.AND_ASSIGN, TokenId.XOR_ASSIGN, TokenId.OR_ASSIGN,
  TokenId.RSHIFT_ASSIGN, TokenId.LSHIFT_ASSIGN, TokenId.PLUS_PLUS, TokenId.MINUS_MINUS,
]);

/** Run conservative intraprocedural CFG and liveness analyses for one body. */
export function analyzeControlFlow(body: BlockNode, binding: BindingResult | undefined, tokens: readonly Token[] = []): ControlFlowAnalysis {
  const graph = buildControlFlowGraph(body);
  const referenceIndex = createReferenceIndex(binding);
  const tracked = new Set<number>();
  for (const symbol of binding?.symbols ?? []) {
    if (symbol.kind === "local" || symbol.kind === "loop" || (symbol.kind === "parameter" && !symbol.isOutParameter)) tracked.add(symbol.id);
  }

  const effects = new Map<number, NodeEffects>();
  for (const node of graph.nodes) {
    const effect: NodeEffects = { reads: new Set<number>(), unknown: false, writes: [] };
    if (node.statement) collectStatementEffects(node.statement, effect, referenceIndex);
    effects.set(node.id, effect);
  }

  const reachable = findReachableNodes(graph);
  const { liveIn, liveOut } = solveLiveness(graph, effects, tracked, reachable);
  const deadStores: DeadStore[] = [];
  if (binding) {
    for (const node of graph.nodes) {
      if (!reachable.has(node.id)) continue;
      const effect = effects.get(node.id);
      if (!effect) continue;
      const after = liveOut.get(node.id) ?? new Set<number>();
      for (const write of effect.writes) {
        if (!tracked.has(write.symbolId)
          || write.declaration
          || referenceIndex.symbols.get(write.symbolId)?.isOutParameter
          || effect.reads.has(write.symbolId)
          || after.has(write.symbolId)) continue;
        deadStores.push({ range: write.range, symbolId: write.symbolId });
      }
    }
  }

  const constantConditions: ConstantCondition[] = [];
  for (const node of graph.nodes) {
    const statement = node.statement;
    if (!reachable.has(node.id) || !statement || !isConditionStatement(statement)) continue;
    const condition = conditionExpression(statement);
    const value = evaluateBoolean(condition, tokens);
    if (value !== undefined && condition) constantConditions.push({ range: condition.range, statement, value });
  }

  const unreachable = graph.nodes.filter((node) => node.kind === "statement" && node.statement && !reachable.has(node.id));
  return { constantConditions, deadStores, graph, unreachable };

  function createReferenceIndex(result: BindingResult | undefined): ReferenceIndex {
    const byRange = new Map<string, BindingReference[]>();
    const symbols = new Map<number, BindingResult["symbols"][number]>();
    for (const symbol of result?.symbols ?? []) {
      symbols.set(symbol.id, symbol);
      for (const reference of [...symbol.reads, ...symbol.writes]) {
        const key = rangeKey(reference.range);
        const references = byRange.get(key) ?? [];
        references.push(reference);
        byRange.set(key, references);
      }
    }
    return { byRange, symbols };
  }

  function collectStatementEffects(statement: StatementNode, effect: NodeEffects, index: ReferenceIndex): void {
    switch (statement.kind) {
      case "variable-statement":
        if (statement.assignTokenIndex !== undefined && statement.name) recordWrite(statement.name, effect, index, true);
        collectExpression(statement.value, effect, index);
        return;
      case "assignment-statement":
        collectAssignment(statement, effect, index);
        return;
      case "expression-statement":
        collectExpression(statement.expression, effect, index);
        return;
      case "return-statement":
        collectExpression(statement.expression, effect, index);
        return;
      case "if-statement":
        collectExpression(statement.condition, effect, index);
        return;
      case "while-statement":
        collectExpression(statement.condition, effect, index);
        return;
      case "for-index-statement":
        collectExpression(statement.start, effect, index);
        collectExpression(statement.end, effect, index);
        collectExpression(statement.step, effect, index);
        return;
      case "for-range-statement":
        collectExpression(statement.iterable, effect, index);
        return;
      case "for-expression-statement":
        collectExpression(statement.expression, effect, index);
        return;
      case "break-statement":
      case "continue-statement":
      case "block":
        return;
      default: return assertNever(statement);
    }
  }

  function collectAssignment(statement: AssignmentStatementNode, effect: NodeEffects, index: ReferenceIndex): void {
    if (statement.left?.kind === "name-expression") {
      recordWrite(statement.left.name, effect, index, false);
      if (COMPOUND_ASSIGNMENTS.has(statement.operator)) recordRead(statement.left.name, effect, index);
    } else {
      effect.unknown = true;
      collectExpression(statement.left, effect, index);
    }
    collectExpression(statement.right, effect, index);
  }

  function collectExpression(expression: ExpressionNode | undefined, effect: NodeEffects, index: ReferenceIndex): void {
    if (!expression) return;
    switch (expression.kind) {
      case "name-expression":
        recordRead(expression.name, effect, index);
        return;
      case "literal-expression":
      case "entity-reference-expression":
        return;
      case "parenthesized-expression":
        collectExpression(expression.expression, effect, index);
        return;
      case "unary-expression":
        collectExpression(expression.operand, effect, index);
        return;
      case "binary-expression":
        collectExpression(expression.left, effect, index);
        collectExpression(expression.right, effect, index);
        return;
      case "cast-expression":
        collectExpression(expression.expression, effect, index);
        return;
      case "typeof-expression":
        return;
      case "member-expression":
        collectExpression(expression.object, effect, index);
        return;
      case "index-expression":
        collectExpression(expression.object, effect, index);
        collectExpression(expression.index, effect, index);
        return;
      case "generic-access-expression":
        collectExpression(expression.object, effect, index);
        return;
      case "call-expression":
        effect.unknown = true;
        collectCall(expression, effect, index);
        return;
      case "prefixed-call-expression":
        effect.unknown = true;
        collectExpression(expression.call, effect, index);
        return;
      case "positional-composite-expression":
        for (const entry of expression.entries) collectExpression(entry, effect, index);
        return;
      case "map-composite-expression":
        for (const entry of expression.entries) {
          collectExpression(entry.key, effect, index);
          collectExpression(entry.value, effect, index);
        }
        return;
      case "struct-composite-expression":
        for (const field of expression.fields) collectExpression(field.value, effect, index);
        return;
      case "loc-string-expression":
        collectExpression(expression.key, effect, index);
        collectExpression(expression.arguments, effect, index);
        return;
      default: return assertNever(expression);
    }
  }

  function collectCall(call: CallExpressionNode, effect: NodeEffects, index: ReferenceIndex): void {
    collectExpression(call.callee, effect, index);
    for (const argument of call.arguments) {
      if (argument.kind === "out-var-argument") recordOutVar(argument, effect, index);
      else collectExpression(argument, effect, index);
    }
  }

  function recordOutVar(argument: OutVarArgumentNode, effect: NodeEffects, index: ReferenceIndex): void {
    if (argument.name) recordWrite(argument.name, effect, index, true);
  }

  function recordRead(name: NameNode, effect: NodeEffects, index: ReferenceIndex): void {
    for (const reference of index.byRange.get(rangeKey(name.range)) ?? []) {
      if (reference.kind === "read" || reference.kind === "call") effect.reads.add(reference.symbolId);
    }
  }

  function recordWrite(name: NameNode, effect: NodeEffects, index: ReferenceIndex, declaration: boolean): void {
    for (const reference of index.byRange.get(rangeKey(name.range)) ?? []) {
      if (reference.kind !== "write" && reference.kind !== "declaration") continue;
      effect.writes.push({ declaration: declaration || reference.kind === "declaration", range: name.range, symbolId: reference.symbolId });
    }
  }

  function findReachableNodes(controlFlow: ControlFlowGraph): Set<number> {
    const nodesById = new Map(controlFlow.nodes.map((node) => [node.id, node]));
    const reachableNodes = new Set<number>([controlFlow.entry]);
    const pending = [controlFlow.entry];
    while (pending.length) {
      const currentId = pending.pop();
      if (currentId === undefined) continue;
      const current = nodesById.get(currentId);
      if (!current) continue;
      const condition = current.statement && isConditionStatement(current.statement)
        ? evaluateBoolean(conditionExpression(current.statement), tokens) : undefined;
      for (const edge of current.successors) {
        if (condition !== undefined && (edge.kind === "true" || edge.kind === "false") && (edge.kind === "true") !== condition) continue;
        if (reachableNodes.has(edge.target)) continue;
        reachableNodes.add(edge.target);
        pending.push(edge.target);
      }
    }
    return reachableNodes;
  }

  function solveLiveness(
    controlFlow: ControlFlowGraph,
    nodeEffects: ReadonlyMap<number, NodeEffects>,
    universe: ReadonlySet<number>,
    reachableNodes: ReadonlySet<number>,
  ): { liveIn: Map<number, Set<number>>; liveOut: Map<number, Set<number>> } {
    const liveIn = new Map<number, Set<number>>();
    const liveOut = new Map<number, Set<number>>();
    for (const node of controlFlow.nodes) {
      liveIn.set(node.id, new Set<number>());
      liveOut.set(node.id, new Set<number>());
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of [...controlFlow.nodes].reverse()) {
        if (!reachableNodes.has(node.id)) continue;
        const effect = nodeEffects.get(node.id);
        const nextOut = new Set<number>();
        for (const edge of node.successors) {
          if (!reachableNodes.has(edge.target)) continue;
          for (const id of liveIn.get(edge.target) ?? []) nextOut.add(id);
        }
        const nextIn = new Set<number>(effect?.reads ?? []);
        if (effect?.unknown) for (const id of universe) nextIn.add(id);
        for (const id of nextOut) if (!(effect?.writes.some((write) => write.symbolId === id) ?? false)) nextIn.add(id);
        if (!setsEqual(liveOut.get(node.id), nextOut)) { liveOut.set(node.id, nextOut); changed = true; }
        if (!setsEqual(liveIn.get(node.id), nextIn)) { liveIn.set(node.id, nextIn); changed = true; }
      }
    }
    return { liveIn, liveOut };
  }
}

function isConditionStatement(statement: StatementNode): statement is ConditionStatement {
  return statement.kind === "if-statement"
    || statement.kind === "while-statement"
    || statement.kind === "for-expression-statement";
}

function conditionExpression(statement: ConditionStatement): ExpressionNode | undefined {
  return statement.kind === "for-expression-statement" ? statement.expression : statement.condition;
}

export function evaluateBoolean(expression: ExpressionNode | undefined, tokens: readonly Token[] = []): boolean | undefined {
  if (!expression) return undefined;
  if (expression.kind === "literal-expression") {
    if (expression.literalKind === "boolean") {
      const token = tokens[expression.tokenIndex];
      if (token?.kind === TokenId.TRUE || token?.text === "true") return true;
      if (token?.kind === TokenId.FALSE || token?.text === "false") return false;
    }
    return undefined;
  }
  if (expression.kind === "parenthesized-expression") return evaluateBoolean(expression.expression, tokens);
  if (expression.kind === "unary-expression" && expression.operator === TokenId.EXCLAMATION) {
    const value = evaluateBoolean(expression.operand, tokens);
    return value === undefined ? undefined : !value;
  }
  return undefined;
}

function setsEqual(left: ReadonlySet<number> | undefined, right: ReadonlySet<number>): boolean {
  if (!left || left.size !== right.size) return false;
  for (const value of right) if (!left.has(value)) return false;
  return true;
}

function rangeKey(range: SourceRange): string { return `${range.start.offset}:${range.end.offset}`; }
