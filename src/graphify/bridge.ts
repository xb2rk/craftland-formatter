import { createWorkspaceIndex, type WorkspaceFileRecord, type WorkspaceSource } from "../workspace/index.js";
import type { SourceRange } from "../lex/position.js";
import type { SyntaxNode } from "../syntax/nodes.js";
import { type AnySyntaxNode, walkAst } from "../syntax/nodes.js";

/** One graph node in graphify's extraction JSON schema. */
export interface BridgeNode {
  readonly author: null;
  readonly captured_at: null;
  readonly contributor: null;
  readonly file_type: "code";
  readonly id: string;
  readonly label: string;
  readonly source_file: string;
  readonly source_location: { readonly column: number; readonly line: number } | null;
  readonly source_url: null;
}

/** One graph edge in graphify's extraction JSON schema. */
export interface BridgeEdge {
  readonly confidence: "EXTRACTED" | "INFERRED";
  readonly confidence_score: number;
  readonly relation: "calls" | "contains" | "imports" | "references";
  readonly source: string;
  readonly source_file: string;
  readonly source_location: { readonly column: number; readonly line: number } | null;
  readonly target: string;
  readonly weight: 1.0;
}

export interface BridgeExtraction {
  readonly edges: readonly BridgeEdge[];
  readonly hyperedges: readonly [];
  readonly input_tokens: 0;
  readonly nodes: readonly BridgeNode[];
  readonly output_tokens: 0;
}

export interface BridgeFinding {
  readonly detail: string;
  readonly file: string;
  readonly kind: "ambiguous-call" | "unparsed-file" | "unresolved-call" | "unresolved-import";
}

export interface BridgeOptions {
  /** Directory inputs are relativized against to build node ID stems. */
  readonly repoRoot: string;
  /** Project source root for the workspace index. All inputs must stay below it. */
  readonly workspaceRoot: string;
}

export interface BridgeResult {
  readonly extraction: BridgeExtraction;
  readonly findings: readonly BridgeFinding[];
}

interface DeclInfo {
  readonly file: string;
  readonly id: string;
  readonly kind: string;
  readonly name: string;
}

interface FileContext {
  readonly absolutePath: string;
  readonly aliasToImport: Map<string, { readonly classification: string; readonly resolvedKey: string | undefined; readonly specifier: string }>;
  readonly defines: Map<string, DeclInfo[]>;
  readonly importedKeys: Set<string>;
  readonly moduleId: string;
  readonly record: WorkspaceFileRecord;
}

const MAX_FINDINGS_PER_KIND = 25;

export function normalizeBridgeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Full repo-relative stem: every directory level kept, extension dropped. */
export function stemOfRepoPath(repoRelativePath: string): string {
  const withoutExtension = repoRelativePath.replace(/\.[a-z0-9]+$/i, "");
  return normalizeBridgeId(withoutExtension.replace(/[/\\]+/g, "_"));
}

function locationOf(range: SourceRange | undefined): BridgeNode["source_location"] {
  if (!range) return null;
  return { column: range.start.column + 1, line: range.start.line + 1 };
}

function nameText(name: { text?: unknown } | undefined): string | undefined {
  return typeof name?.text === "string" && name.text.length ? name.text : undefined;
}

function normPath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

export function extractGraph(sources: readonly WorkspaceSource[], options: BridgeOptions): BridgeResult {
  const index = createWorkspaceIndex(sources, { root: options.workspaceRoot });
  const nodes = new Map<string, BridgeNode>();
  const edges = new Map<string, BridgeEdge>();
  const findings: BridgeFinding[] = [];
  const findingCounts = new Map<string, number>();
  const absoluteByNorm = new Map<string, string>();
  for (const source of sources) absoluteByNorm.set(normPath(source.path), source.path);

  const report = (kind: BridgeFinding["kind"], file: string, detail: string): void => {
    const seen = findingCounts.get(kind) ?? 0;
    findingCounts.set(kind, seen + 1);
    if (seen < MAX_FINDINGS_PER_KIND) findings.push({ detail, file, kind });
  };

  const addNode = (node: BridgeNode): void => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addEdge = (edge: BridgeEdge): void => {
    const key = `${edge.source}|${edge.target}|${edge.relation}`;
    if (!edges.has(key)) edges.set(key, edge);
  };
  const absoluteOf = (indexKey: string): string => {
    const direct = absoluteByNorm.get(normPath(indexKey));
    if (direct) return direct;
    for (const [candidate, absolute] of absoluteByNorm) {
      if (candidate.endsWith(normPath(indexKey)) || normPath(indexKey).endsWith(candidate)) return absolute;
    }
    return indexKey;
  };

  // Phase 1: module + declaration nodes, global name table, per-file contexts.
  const globalDecls = new Map<string, DeclInfo[]>();
  const fileContexts = new Map<string, FileContext>();
  const sortedKeys = [...index.files.keys()].sort();
  for (const key of sortedKeys) {
    const record = index.files.get(key)!;
    const absolutePath = absoluteOf(record.path || key);
    const relativePath = toRepoRelative(options.repoRoot, absolutePath);
    const stem = stemOfRepoPath(relativePath);
    addNode({
      author: null, captured_at: null, contributor: null, file_type: "code", id: stem,
      label: baseName(absolutePath), source_file: absolutePath, source_location: null, source_url: null,
    });
    if (!record.parsed || !record.syntax) {
      report("unparsed-file", record.relativePath, "parser rejected the file; no AST nodes emitted");
      continue;
    }
    const defines = new Map<string, DeclInfo[]>();
    const usedKinds = new Map<string, string>([[stem, "module"]]);
    const stack: string[] = [stem];
    walkAst(record.syntax,
      (node) => {
        const decl = toDeclInfo(node, stem, absolutePath, usedKinds);
        if (!decl) return undefined;
        addNode({
          author: null, captured_at: null, contributor: null, file_type: "code", id: decl.id,
          label: decl.name, source_file: absolutePath,
          source_location: locationOf((node as { range?: SourceRange }).range), source_url: null,
        });
        const parent = stack[stack.length - 1]!;
        if (parent !== decl.id) {
          addEdge({
            confidence: "EXTRACTED", confidence_score: 1.0, relation: "contains",
            source: parent, source_file: absolutePath,
            source_location: locationOf((node as { range?: SourceRange }).range),
            target: decl.id, weight: 1.0,
          });
        }
        pushDecl(defines, decl);
        pushDecl(globalDecls, decl);
        stack.push(decl.id);
        return undefined;
      },
      (node) => {
        if (toDeclInfo(node, stem, absolutePath)) stack.pop();
      });
    const aliasToImport = new Map<string, { classification: string; resolvedKey: string | undefined; specifier: string }>();
    for (const imp of record.imports) {
      if (imp.alias) aliasToImport.set(imp.alias, { classification: imp.classification, resolvedKey: imp.resolvedPath, specifier: imp.specifier });
    }
    const importedKeys = new Set<string>();
    for (const imp of record.imports) {
      if (imp.classification === "project" && imp.resolvedPath) importedKeys.add(normPath(absoluteOf(imp.resolvedPath)));
    }
    fileContexts.set(key, { absolutePath, aliasToImport, defines, importedKeys, moduleId: stem, record });
  }

  // Phase 2: import + call + reference edges.
  for (const key of sortedKeys) {
    const context = fileContexts.get(key);
    if (!context) continue;
    emitImportEdges(context, fileContexts, addNode, addEdge, report);
    emitBodyEdges(context, globalDecls, fileContexts, addNode, addEdge, report);
  }

  return {
    extraction: {
      edges: [...edges.values()].sort(compareEdges),
      hyperedges: [],
      input_tokens: 0,
      nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id, "en")),
      output_tokens: 0,
    },
    findings: [...findings].sort((left, right) => left.kind.localeCompare(right.kind, "en") || left.file.localeCompare(right.file, "en")),
  };
}

function compareEdges(left: BridgeEdge, right: BridgeEdge): number {
  return left.source.localeCompare(right.source, "en")
    || left.target.localeCompare(right.target, "en")
    || left.relation.localeCompare(right.relation, "en");
}

function pushDecl(table: Map<string, DeclInfo[]>, decl: DeclInfo): void {
  const bucket = table.get(decl.name.toLowerCase());
  if (bucket?.some((item) => item.id === decl.id)) return;
  if (bucket) bucket.push(decl);
  else table.set(decl.name.toLowerCase(), [decl]);
}

function toDeclInfo(node: SyntaxNode, stem: string, file: string, usedKinds?: Map<string, string>): DeclInfo | undefined {
  const named = node as { name?: { text?: unknown } };
  const claim = (name: string, kind: string): string => {
    const base = `${stem}_${normalizeBridgeId(name)}`;
    if (!usedKinds) return base;
    if (usedKinds.has(base) && usedKinds.get(base) !== kind) {
      const suffixed = `${base}_${kind}`;
      usedKinds.set(suffixed, kind);
      return suffixed;
    }
    usedKinds.set(base, kind);
    return base;
  };
  switch (node.kind) {
    case "function-declaration":
    case "event-declaration":
    case "enum-declaration":
    case "enum-member":
    case "tuple-declaration":
    case "component-declaration":
    case "declare-graph":
    case "field-declaration":
    case "define-declaration":
    case "alias-declaration": {
      const name = nameText(named.name);
      if (!name) return undefined;
      const kind = node.kind === "tuple-declaration" || node.kind === "component-declaration" ? "tuple"
        : node.kind === "define-declaration" || node.kind === "alias-declaration" ? "constant"
        : node.kind === "declare-graph" ? "graph"
        : node.kind === "field-declaration" ? "field"
        : node.kind === "enum-member" ? "enum-member"
        : node.kind === "event-declaration" ? "event"
        : node.kind === "enum-declaration" ? "enum"
        : "function";
      return { file, id: claim(name, kind), kind, name };
    }
    case "graph-declaration": {
      const name = nameText(named.name);
      if (!name) return { file, id: stem, kind: "graph", name: stem };
      return { file, id: claim(name, "graph"), kind: "graph", name };
    }
    default:
      return undefined;
  }
}

function emitImportEdges(
  context: FileContext,
  fileContexts: ReadonlyMap<string, FileContext>,
  addNode: (node: BridgeNode) => void,
  addEdge: (edge: BridgeEdge) => void,
  report: (kind: BridgeFinding["kind"], file: string, detail: string) => void,
): void {
  for (const imp of context.record.imports) {
    const location = locationOf(imp.range);
    if (imp.classification === "project" && imp.resolvedPath) {
      const target = fileContexts.get(imp.resolvedPath);
      if (!target) continue;
      addEdge({
        confidence: "EXTRACTED", confidence_score: 1.0, relation: "imports",
        source: context.moduleId, source_file: context.absolutePath, source_location: location,
        target: target.moduleId, weight: 1.0,
      });
      continue;
    }
    if (imp.classification === "external-library" || imp.classification === "generated-library") {
      const libraryId = `ext_${normalizeBridgeId(imp.specifier.replace(/\.[a-z0-9]+$/i, ""))}`;
      addNode({
        author: null, captured_at: null, contributor: null, file_type: "code", id: libraryId,
        label: imp.specifier, source_file: context.absolutePath, source_location: null, source_url: null,
      });
      addEdge({
        confidence: "EXTRACTED", confidence_score: 1.0, relation: "imports",
        source: context.moduleId, source_file: context.absolutePath, source_location: location,
        target: libraryId, weight: 1.0,
      });
      continue;
    }
    report("unresolved-import", context.record.relativePath, `import '${imp.specifier}' could not be resolved`);
  }
}

interface Callee {
  readonly member: string | undefined;
  readonly root: string | undefined;
}

function calleeOf(call: SyntaxNode): Callee {
  let expression: unknown = (call as { callee?: unknown }).callee;
  for (;;) {
    if (!expression || typeof expression !== "object" || typeof (expression as SyntaxNode).kind !== "string") return { member: undefined, root: undefined };
    const expr = expression as SyntaxNode;
    if (expr.kind === "name") return { member: undefined, root: nameText(expr as { text?: unknown }) };
    if (expr.kind === "name-expression") {
      return { member: undefined, root: nameText((expr as { name?: { text?: unknown } }).name) };
    }
    if (expr.kind === "member-expression") {
      const member = nameText((expr as { member?: { text?: unknown } }).member);
      const root = unwrapObject((expr as { object?: unknown }).object);
      if (root !== undefined) return { member, root };
      return { member, root: undefined };
    }
    if (expr.kind === "call-expression") return { member: undefined, root: undefined };
    const object: unknown = (expr as { object?: unknown }).object;
    if (object === undefined) return { member: undefined, root: undefined };
    expression = object;
  }
}

/** Drill through index/generic/cast/name wrappers to the leftmost name, if any. */
function unwrapObject(object: unknown): string | undefined {
  let current: unknown = object;
  for (;;) {
    if (!current || typeof current !== "object" || typeof (current as SyntaxNode).kind !== "string") return undefined;
    const node = current as SyntaxNode;
    if (node.kind === "name") return nameText(node as { text?: unknown });
    if (node.kind === "name-expression") return nameText((node as { name?: { text?: unknown } }).name);
    if (node.kind === "call-expression") return undefined;
    const next: unknown = (node as { object?: unknown }).object ?? (node as { expression?: unknown }).expression;
    if (next === undefined) return undefined;
    current = next;
  }
}

function emitBodyEdges(
  context: FileContext,
  globalDecls: ReadonlyMap<string, DeclInfo[]>,
  fileContexts: ReadonlyMap<string, FileContext>,
  addNode: (node: BridgeNode) => void,
  addEdge: (edge: BridgeEdge) => void,
  report: (kind: BridgeFinding["kind"], file: string, detail: string) => void,
): void {
  const syntax = context.record.syntax;
  if (!syntax) return;
  const callers: string[] = [context.moduleId];
  const enter = (node: SyntaxNode): "skip" | void => {
    if (node.kind === "function-declaration" || node.kind === "event-declaration") {
      const decl = toDeclInfo(node, "", "");
      const full = decl ? context.defines.get(decl.name.toLowerCase())?.[0] : undefined;
      callers.push(full ? full.id : context.moduleId);
      return undefined;
    }
    if (node.kind === "call-expression") {
      resolveCall(node, callers[callers.length - 1]!, context, globalDecls, fileContexts, addNode, addEdge, report);
      for (const argument of ((node as { arguments?: unknown }).arguments as unknown[] | undefined) ?? []) {
        walkAst(argument as AnySyntaxNode, enter, exit);
      }
      return "skip";
    }
    if (node.kind === "member-expression") {
      resolveTypeReference(node, callers[callers.length - 1]!, context, globalDecls, addEdge);
    }
    return undefined;
  };
  const exit = (node: SyntaxNode): void => {
    if (node.kind === "function-declaration" || node.kind === "event-declaration") callers.pop();
  };
  walkAst(syntax, enter, exit);
}

function resolveCall(
  call: SyntaxNode,
  caller: string,
  context: FileContext,
  globalDecls: ReadonlyMap<string, DeclInfo[]>,
  fileContexts: ReadonlyMap<string, FileContext>,
  addNode: (node: BridgeNode) => void,
  addEdge: (edge: BridgeEdge) => void,
  report: (kind: BridgeFinding["kind"], file: string, detail: string) => void,
): void {
  const { member, root } = calleeOf(call);
  const location = locationOf((call as { range?: SourceRange }).range);
  const calls = (target: string, confidence: BridgeEdge["confidence"], score: number): void => {
    addEdge({
      confidence, confidence_score: score, relation: "calls",
      source: caller, source_file: context.absolutePath, source_location: location,
      target, weight: 1.0,
    });
  };
  if (root === undefined && member === undefined) {
    report("unresolved-call", context.record.relativePath, `unresolvable callee shape in '${shortId(caller)}'`);
    return;
  }
  if (member !== undefined) {
    if (root !== undefined) {
      const imp = context.aliasToImport.get(root);
      if (imp?.resolvedKey) {
        const targetFile = fileContexts.get(imp.resolvedKey);
        const memberDecl = targetFile?.defines.get(member.toLowerCase())?.[0];
        if (memberDecl) {
          calls(memberDecl.id, "EXTRACTED", 1.0);
          return;
        }
        report("unresolved-call", context.record.relativePath, `'${root}.${member}' imported but '${member}' is not defined in the target`);
        return;
      }
      if (imp && (imp.classification === "external-library" || imp.classification === "generated-library")) {
        const libraryId = `ext_${normalizeBridgeId(imp.specifier.replace(/\.[a-z0-9]+$/i, ""))}_${normalizeBridgeId(member)}`;
        addNode({
          author: null, captured_at: null, contributor: null, file_type: "code", id: libraryId,
          label: `${imp.specifier}.${member}`, source_file: context.absolutePath, source_location: null, source_url: null,
        });
        calls(libraryId, "EXTRACTED", 1.0);
        return;
      }
      const typeDecl = lookupDecl(globalDecls, root, ["enum", "tuple", "graph"]);
      if (typeDecl) {
        addEdge({
          confidence: "EXTRACTED", confidence_score: 1.0, relation: "references",
          source: caller, source_file: context.absolutePath, source_location: location,
          target: typeDecl.id, weight: 1.0,
        });
        return;
      }
    }
    resolveNamedCall(member ?? "", caller, context, globalDecls, fileContexts, location, calls, report);
    return;
  }
  resolveNamedCall(root ?? "", caller, context, globalDecls, fileContexts, location, calls, report);
}

function resolveNamedCall(
  name: string,
  caller: string,
  context: FileContext,
  globalDecls: ReadonlyMap<string, DeclInfo[]>,
  fileContexts: ReadonlyMap<string, FileContext>,
  location: BridgeEdge["source_location"],
  calls: (target: string, confidence: BridgeEdge["confidence"], score: number) => void,
  report: (kind: BridgeFinding["kind"], file: string, detail: string) => void,
): void {
  if (!name) {
    report("unresolved-call", context.record.relativePath, `empty callee name in '${shortId(caller)}'`);
    return;
  }
  const local = context.defines.get(name.toLowerCase())?.find((decl) => decl.kind === "function" || decl.kind === "event");
  if (local) {
    calls(local.id, "EXTRACTED", 1.0);
    return;
  }
  const candidates = (globalDecls.get(name.toLowerCase()) ?? []).filter((decl) => decl.kind === "function" || decl.kind === "event");
  const linked = candidates.filter((decl) => context.importedKeys.has(normPath(decl.file)));
  if (linked.length) {
    calls(linked.sort((a, b) => a.id.localeCompare(b.id, "en"))[0]!.id, "EXTRACTED", 1.0);
    return;
  }
  if (candidates.length === 1) {
    calls(candidates[0]!.id, "INFERRED", 0.95);
    return;
  }
  if (candidates.length > 1) {
    report("ambiguous-call", context.record.relativePath, `'${name}' matches ${candidates.length} definitions without an import link`);
    return;
  }
  report("unresolved-call", context.record.relativePath, `'${name}' has no definition in the workspace`);
}

function lookupDecl(
  globalDecls: ReadonlyMap<string, DeclInfo[]>,
  name: string,
  kinds: readonly string[],
): DeclInfo | undefined {
  return globalDecls.get(name.toLowerCase())?.find((decl) => kinds.includes(decl.kind));
}

/** Non-call `Type.Member` reads (enum values, tuple fields) become references edges. */
function resolveTypeReference(
  member: SyntaxNode,
  caller: string,
  context: FileContext,
  globalDecls: ReadonlyMap<string, DeclInfo[]>,
  addEdge: (edge: BridgeEdge) => void,
): void {
  const root = unwrapObject((member as { object?: unknown }).object);
  if (!root) return;
  const typeDecl = lookupDecl(globalDecls, root, ["enum", "tuple", "graph"]);
  if (!typeDecl) return;
  addEdge({
    confidence: "EXTRACTED", confidence_score: 1.0, relation: "references",
    source: caller, source_file: context.absolutePath,
    source_location: locationOf((member as { range?: SourceRange }).range),
    target: typeDecl.id, weight: 1.0,
  });
}

function shortId(id: string): string {
  return id.split("_").slice(-2).join("_");
}

function baseName(path: string): string {
  const file = path.replace(/\\/g, "/").split("/").pop() ?? path;
  return file.replace(/\.[a-z0-9]+$/i, "");
}

function toRepoRelative(repoRoot: string, absolutePath: string): string {
  const root = repoRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const target = absolutePath.replace(/\\/g, "/");
  if (target.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return target.slice(root.length + 1);
  return baseName(absolutePath);
}
