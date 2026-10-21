import type {
  BlockNode, ForExpressionStatementNode, ForIndexStatementNode, ForRangeStatementNode,
  IfStatementNode, StatementNode, WhileStatementNode,
} from "../syntax/nodes.js";

export type ControlFlowEdgeKind = "false" | "normal" | "true";

export interface ControlFlowEdge {
  readonly kind: ControlFlowEdgeKind;
  readonly target: number;
}

export interface ControlFlowNode {
  readonly id: number;
  readonly kind: "entry" | "exit" | "join" | "statement";
  readonly statement: StatementNode | undefined;
  readonly successors: readonly ControlFlowEdge[];
}

export interface ControlFlowGraph {
  readonly entry: number;
  readonly exit: number;
  readonly nodes: readonly ControlFlowNode[];
}

interface MutableControlFlowNode {
  readonly id: number;
  readonly kind: ControlFlowNode["kind"];
  readonly statement: StatementNode | undefined;
  readonly successors: ControlFlowEdge[];
}

interface PendingExit {
  readonly from: number;
  readonly kind: ControlFlowEdgeKind;
}

interface Fragment {
  readonly exits: PendingExit[];
  readonly start: number | undefined;
}

interface BuildContext {
  readonly breakTarget: number | undefined;
  readonly continueTarget: number | undefined;
}

/** Build a statement-level control-flow graph for one callable body. */
export function buildControlFlowGraph(body: BlockNode): ControlFlowGraph {
  const nodes: MutableControlFlowNode[] = [];
  const entry = addNode("entry");
  const exit = addNode("exit");
  const fragment = buildBlock(body, { breakTarget: undefined, continueTarget: undefined });
  if (fragment.start === undefined) addEdge(entry, exit, "normal");
  else addEdge(entry, fragment.start, "normal");
  for (const pending of fragment.exits) addEdge(pending.from, exit, pending.kind);

  return {
    entry,
    exit,
    nodes: nodes.map((node) => ({ ...node, successors: [...node.successors] })),
  };

  function addNode(kind: MutableControlFlowNode["kind"], statement?: StatementNode): number {
    const id = nodes.length;
    nodes.push({ id, kind, statement, successors: [] });
    return id;
  }

  function addEdge(from: number, target: number, kind: ControlFlowEdgeKind): void {
    const node = nodes[from];
    if (!node || node.successors.some((edge) => edge.target === target && edge.kind === kind)) return;
    node.successors.push({ kind, target });
  }

  function connect(pending: readonly PendingExit[], target: number): void {
    for (const edge of pending) addEdge(edge.from, target, edge.kind);
  }

  function buildBlock(block: BlockNode, context: BuildContext): Fragment {
    let start: number | undefined;
    let exits: PendingExit[] = [];
    for (const statement of block.statements) {
      const fragment = buildStatement(statement, context);
      if (fragment.start === undefined) continue;
      if (start === undefined) start = fragment.start;
      connect(exits, fragment.start);
      exits = fragment.exits;
    }
    return { exits, start };
  }

  function buildStatement(statement: StatementNode, context: BuildContext): Fragment {
    switch (statement.kind) {
      case "block":
        return buildBlock(statement, context);
      case "if-statement":
        return buildIf(statement, context);
      case "while-statement":
        return buildLoop(statement, context, statement.body, statement);
      case "for-index-statement":
      case "for-range-statement":
      case "for-expression-statement":
        return buildLoop(statement, context, statement.body, statement);
      case "return-statement": {
        const node = addNode("statement", statement);
        addEdge(node, exit, "normal");
        return { exits: [], start: node };
      }
      case "break-statement": {
        const node = addNode("statement", statement);
        addEdge(node, context.breakTarget ?? exit, "normal");
        return { exits: [], start: node };
      }
      case "continue-statement": {
        const node = addNode("statement", statement);
        addEdge(node, context.continueTarget ?? exit, "normal");
        return { exits: [], start: node };
      }
      default: {
        const node = addNode("statement", statement);
        return { exits: [{ from: node, kind: "normal" }], start: node };
      }
    }
  }

  function buildIf(statement: IfStatementNode, context: BuildContext): Fragment {
    const condition = addNode("statement", statement);
    const exits: PendingExit[] = [];
    const consequent = statement.consequent ? buildBlock(statement.consequent, context) : undefined;
    if (consequent?.start === undefined) exits.push({ from: condition, kind: "true" });
    else {
      addEdge(condition, consequent.start, "true");
      exits.push(...consequent.exits);
    }

    let alternate: Fragment | undefined;
    if (statement.alternate?.kind === "if-statement") alternate = buildIf(statement.alternate, context);
    else if (statement.alternate) alternate = buildBlock(statement.alternate, context);
    if (!alternate || alternate.start === undefined) exits.push({ from: condition, kind: "false" });
    else {
      addEdge(condition, alternate.start, "false");
      exits.push(...alternate.exits);
    }
    return { exits: uniqueExits(exits), start: condition };
  }

  function buildLoop(
    statement: WhileStatementNode | ForIndexStatementNode | ForRangeStatementNode | ForExpressionStatementNode,
    parentContext: BuildContext,
    body: BlockNode | undefined,
    _loopStatement: StatementNode,
  ): Fragment {
    const condition = addNode("statement", statement);
    const after = addNode("join");
    addEdge(condition, after, "false");
    const loopContext: BuildContext = { breakTarget: after, continueTarget: condition };
    const loopBody = body ? buildBlock(body, loopContext) : undefined;
    if (!loopBody || loopBody.start === undefined) addEdge(condition, condition, "true");
    else {
      addEdge(condition, loopBody.start, "true");
      connect(loopBody.exits, condition);
    }
    return { exits: [{ from: after, kind: "normal" }], start: condition };
  }

  function uniqueExits(exits: readonly PendingExit[]): PendingExit[] {
    const seen = new Set<string>();
    const result: PendingExit[] = [];
    for (const exitEdge of exits) {
      const key = `${exitEdge.from}:${exitEdge.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(exitEdge);
    }
    return result;
  }
}
