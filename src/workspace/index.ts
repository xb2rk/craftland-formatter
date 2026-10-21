import { createHash } from "node:crypto";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { TokenId } from "../grammar/token-vocabulary.generated.js";
import { lex, type LexResult } from "../lex/lexer.js";
import type { SourceRange } from "../lex/position.js";
import type { Token } from "../lex/token.js";
import { parseGraphFile, parseHeaderFile } from "../parser/file-parser.js";
import type { ParseDiagnostic } from "../parser/diagnostic.js";
import type {
  GraphFileNode, HeaderDeclarationNode, HeaderFileNode, ImportNode, NameNode, SyntaxNode,
} from "../syntax/nodes.js";

/** The source kinds understood by the workspace index. */
export type WorkspaceFileKind = "fcc" | "fcg";

/** Platform facts are only asserted when the source syntax makes them explicit. */
export type WorkspacePlatform = "client" | "contract" | "server" | "unknown";

/** Import classes are deliberately coarse until compiler-backed policy is added. */
export type WorkspaceImportClassification =
  | "project"
  | "generated-library"
  | "external-library"
  | "unresolved-project";

/** A caller-owned source snapshot. Paths may be absolute or relative to the index root. */
export interface WorkspaceSource {
  readonly path: string;
  readonly source: string;
}

export interface WorkspaceIndexOptions {
  /** Project source root. All indexed files must remain below this directory. */
  readonly root: string;
  /** Additional opaque generated-library specifiers, merged with EditorGenLib.fcc. */
  readonly generatedLibraries?: readonly string[];
}

export interface WorkspaceFileChange {
  /** Absolute or root-relative path. An omitted source deletes the file. */
  readonly path: string;
  readonly source?: string;
}

export interface WorkspaceImport {
  readonly alias: string | undefined;
  readonly candidates: readonly string[];
  readonly classification: WorkspaceImportClassification;
  readonly imported: string | undefined;
  readonly range: SourceRange;
  readonly sourcePath: string;
  readonly specifier: string;
  readonly resolvedPath: string | undefined;
}

/** A declaration name retained for later workspace rules; this is not an export claim. */
export interface WorkspaceDeclaration {
  readonly kind: string;
  readonly name: string;
  readonly range: SourceRange;
}

export interface WorkspaceSyntaxDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly range: SourceRange;
}

export interface WorkspaceFileRecord {
  readonly declarations: readonly WorkspaceDeclaration[];
  readonly fileKind: WorkspaceFileKind;
  readonly imports: readonly WorkspaceImport[];
  readonly parsed: boolean;
  readonly path: string;
  readonly platform: WorkspacePlatform;
  readonly relativePath: string;
  readonly source: string;
  readonly sourceHash: string;
  readonly syntax: GraphFileNode | HeaderFileNode | undefined;
  readonly syntaxDiagnostics: readonly WorkspaceSyntaxDiagnostic[];
}

export interface WorkspaceIndex {
  readonly cycles: readonly (readonly string[])[];
  /** Every file's imports, including opaque library imports and unresolved project imports. */
  readonly dependencies: ReadonlyMap<string, readonly WorkspaceImport[]>;
  /** Resolved project importers keyed by their target canonical path. */
  readonly dependents: ReadonlyMap<string, readonly string[]>;
  readonly files: ReadonlyMap<string, WorkspaceFileRecord>;
  readonly generatedLibraries: readonly string[];
  readonly revision: number;
  readonly root: string;
}

const PROJECT_EXTENSIONS: readonly string[] = [".fcc", ".fcg"];
const DEFAULT_GENERATED_LIBRARIES = ["EditorGenLib.fcc"] as const;

/**
 * Build a deterministic in-memory workspace snapshot from caller-provided files.
 * No filesystem access, compiler call, or semantic-server dependency is involved.
 */
export function createWorkspaceIndex(sources: readonly WorkspaceSource[], options: WorkspaceIndexOptions): WorkspaceIndex {
  const root = canonicalPath(options.root);
  const generatedLibraries = normalizeGeneratedLibraries(options.generatedLibraries);
  const files = new Map<string, WorkspaceFileRecord>();
  for (const input of [...sources].sort((left, right) => compareCanonicalPaths(root, left.path, right.path))) {
    const path = sourcePath(root, input.path);
    if (files.has(path)) throw new Error(`Duplicate workspace source path '${path}'.`);
    files.set(path, parseWorkspaceSource(root, path, input.source));
  }
  return buildIndex(root, generatedLibraries, files, 0);
}

/**
 * Apply file additions, replacements, and deletions while reusing unchanged
 * parsed records. Dependency tables are rebuilt from those cached records so
 * a change never leaves stale edges behind.
 */
export function updateWorkspaceIndex(index: WorkspaceIndex, changes: readonly WorkspaceFileChange[]): WorkspaceIndex {
  const files = new Map(index.files);
  const normalizedChanges = [...changes]
    .map((change) => ({ ...change, path: sourcePath(index.root, change.path) }))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  for (let position = 1; position < normalizedChanges.length; position += 1) {
    if (normalizedChanges[position - 1]?.path === normalizedChanges[position]?.path) {
      throw new Error(`Duplicate workspace change path '${normalizedChanges[position]?.path}'.`);
    }
  }
  for (const change of normalizedChanges) {
    if (change.source === undefined) files.delete(change.path);
    else if (files.get(change.path)?.source !== change.source) {
      files.set(change.path, parseWorkspaceSource(index.root, change.path, change.source));
    }
  }
  return buildIndex(index.root, index.generatedLibraries, files, index.revision + 1);
}

/** Converts an absolute or root-relative path to the index's stable key format. */
export function canonicalWorkspacePath(root: string, path: string): string {
  return sourcePath(canonicalPath(root), path);
}

function buildIndex(
  root: string,
  generatedLibraries: readonly string[],
  files: ReadonlyMap<string, WorkspaceFileRecord>,
  revision: number,
): WorkspaceIndex {
  const dependencies = new Map<string, readonly WorkspaceImport[]>();
  const dependents = new Map<string, string[]>();
  const normalizedFiles = new Map<string, WorkspaceFileRecord>();
  const filePaths = [...files.keys()].sort(comparePaths);
  for (const filePath of filePaths) {
    const record = files.get(filePath);
    if (!record) continue;
    const imports = record.imports.map((current) => resolveImport(current, files, root, generatedLibraries));
    normalizedFiles.set(filePath, { ...record, imports });
    dependencies.set(filePath, imports);
    for (const current of imports) {
      if (current.resolvedPath === undefined) continue;
      const existing = dependents.get(current.resolvedPath) ?? [];
      existing.push(filePath);
      dependents.set(current.resolvedPath, existing);
    }
  }
  const normalizedDependents = new Map<string, readonly string[]>();
  for (const [target, importers] of [...dependents.entries()].sort(([left], [right]) => comparePaths(left, right))) {
    normalizedDependents.set(target, [...new Set(importers)].sort(comparePaths));
  }
  return {
    cycles: findCycles(filePaths, dependencies),
    dependencies,
    dependents: normalizedDependents,
    files: normalizedFiles,
    generatedLibraries: [...generatedLibraries],
    revision,
    root,
  };
}

interface RawImport {
  readonly alias: string | undefined;
  readonly candidates: readonly string[];
  readonly classification: WorkspaceImportClassification;
  readonly imported: string | undefined;
  readonly range: SourceRange;
  readonly resolvedPath: string | undefined;
  readonly sourcePath: string;
  readonly specifier: string;
}

function parseWorkspaceSource(root: string, path: string, source: string): WorkspaceFileRecord {
  const fileKind = fileKindOf(path);
  const lexed = lex(source);
  const parsed = fileKind === "fcc" ? parseHeaderFile(lexed) : parseGraphFile(lexed);
  const complete = lexed.diagnostics.length === 0
    && parsed.diagnostics.length === 0
    && parsed.node !== undefined
    && parsed.consumedThroughEof;
  const syntax = complete ? parsed.node : undefined;
  const rawImports = syntax ? syntax.imports.map((node) => rawImport(node, path, lexed)) : [];
  return {
    declarations: syntax ? collectDeclarations(syntax) : [],
    fileKind,
    imports: rawImports,
    parsed: complete,
    path,
    platform: syntax ? platformOf(syntax) : "unknown",
    relativePath: relativePath(root, path),
    source,
    sourceHash: createHash("sha256").update(source, "utf8").digest("hex"),
    syntax,
    syntaxDiagnostics: syntaxDiagnostics(lexed, parsed.diagnostics),
  };
}

function platformOf(file: GraphFileNode | HeaderFileNode): WorkspacePlatform {
  if (file.kind === "header-file") return "contract";
  const names = new Set((file.graph?.decorators ?? [])
    .map((decorator) => decorator.name?.text.toLowerCase())
    .filter((name): name is string => name !== undefined));
  const server = names.has("platform_server");
  const client = names.has("platform_client");
  if (server !== client) return server ? "server" : "client";
  return "unknown";
}

function rawImport(node: ImportNode, sourcePath: string, lexed: LexResult): RawImport {
  const token = node.pathTokenIndex === undefined ? undefined : lexed.tokens[node.pathTokenIndex];
  const specifier = token ? decodeImportPath(token) : undefined;
  return {
    alias: node.alias?.text,
    candidates: [],
    classification: "unresolved-project",
    imported: node.kind === "named-import" ? node.imported?.text : undefined,
    range: node.range,
    resolvedPath: undefined,
    sourcePath,
    specifier: specifier ?? "",
  };
}

function resolveImport(
  raw: WorkspaceImport,
  files: ReadonlyMap<string, WorkspaceFileRecord>,
  root: string,
  generatedLibraries: readonly string[],
): WorkspaceImport {
  if (!isRelativeSpecifier(raw.specifier)) {
    const classification = isGeneratedLibrary(raw.specifier, generatedLibraries) ? "generated-library" : "external-library";
    return { ...raw, classification, resolvedPath: undefined };
  }
  const candidates = projectCandidates(root, raw.sourcePath, raw.specifier);
  const resolvedPath = candidates.find((candidate) => files.has(candidate));
  return {
    ...raw,
    candidates,
    classification: resolvedPath === undefined ? "unresolved-project" : "project",
    resolvedPath,
  };
}

function projectCandidates(root: string, sourcePath: string, specifier: string): readonly string[] {
  const normalizedSpecifier = specifier.replaceAll("\\", "/");
  const candidate = canonicalPath(resolve(dirname(sourcePath), normalizedSpecifier));
  if (!isWithinRoot(root, candidate)) return [];
  const extension = extname(candidate).toLowerCase();
  const candidates = extension === ".fcc" || extension === ".fcg"
    ? [candidate]
    : [candidate, ...PROJECT_EXTENSIONS.map((suffix) => `${candidate}${suffix}`)];
  return [...new Set(candidates)];
}

function collectDeclarations(file: GraphFileNode | HeaderFileNode): WorkspaceDeclaration[] {
  if (file.kind === "graph-file") {
    const graph = file.graph;
    const declarations: WorkspaceDeclaration[] = [];
    if (graph?.name) declarations.push({ kind: "graph", name: graph.name.text, range: graph.name.range });
    for (const member of graph?.members ?? []) {
      const name = member.kind === "event-declaration" ? member.name?.segments.at(-1) : member.name;
      if (name) declarations.push({ kind: member.kind, name: name.text, range: name.range });
    }
    return declarations;
  }
  const declarations: WorkspaceDeclaration[] = [];
  for (const declaration of file.declarations) {
    const name = declarationName(declaration);
    if (name) declarations.push({ kind: declaration.kind, name: name.text, range: name.range });
    if (declaration.kind === "declare-graph") {
      for (const field of declaration.fields) {
        if (field.name) declarations.push({ kind: field.kind, name: field.name.text, range: field.name.range });
      }
      for (const fn of declaration.functions) {
        if (fn.name) declarations.push({ kind: fn.kind, name: fn.name.text, range: fn.name.range });
      }
    }
  }
  return declarations;
}

function declarationName(declaration: HeaderDeclarationNode): NameNode | undefined {
  if (declaration.kind === "event-declaration") return declaration.name?.segments.at(-1);
  return declaration.name;
}

function syntaxDiagnostics(lexed: LexResult, parsed: readonly ParseDiagnostic[]): WorkspaceSyntaxDiagnostic[] {
  return [
    ...lexed.diagnostics.map((diagnostic) => ({ code: diagnostic.code, message: diagnostic.message, range: diagnostic.range })),
    ...parsed.map((diagnostic) => ({ code: diagnostic.code, message: diagnostic.message, range: diagnostic.range })),
  ];
}

function findCycles(
  filePaths: readonly string[],
  dependencies: ReadonlyMap<string, readonly WorkspaceImport[]>,
): readonly (readonly string[])[] {
  const adjacency = new Map<string, readonly string[]>();
  for (const filePath of filePaths) {
    const targets = (dependencies.get(filePath) ?? [])
      .map((edge) => edge.resolvedPath)
      .filter((target): target is string => target !== undefined);
    adjacency.set(filePath, [...new Set(targets)].sort(comparePaths));
  }

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const visit = (node: string): void => {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of adjacency.get(node) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, lowLinks.get(target) ?? 0));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, indices.get(target) ?? 0));
      }
    }
    if (lowLinks.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    let current: string | undefined;
    do {
      current = stack.pop();
      if (current === undefined) break;
      onStack.delete(current);
      component.push(current);
    } while (current !== node);
    if (component.length > 1 || (component.length === 1 && (adjacency.get(component[0]!) ?? []).includes(component[0]!))) {
      components.push(component.sort(comparePaths));
    }
  };
  for (const filePath of filePaths) if (!indices.has(filePath)) visit(filePath);
  return components.sort((left, right) => comparePaths(left[0] ?? "", right[0] ?? ""));
}

function decodeImportPath(token: Token): string | undefined {
  if (token.kind !== TokenId.INTERPRETED_STRING_LIT && token.kind !== TokenId.RAW_STRING_LIT) return undefined;
  if (token.text.length < 2) return undefined;
  if (token.kind === TokenId.RAW_STRING_LIT) return token.text.slice(1, -1);
  try {
    const decoded: unknown = JSON.parse(token.text);
    return typeof decoded === "string" ? decoded : undefined;
  } catch {
    return token.text.slice(1, -1);
  }
}

function normalizeGeneratedLibraries(values: readonly string[] | undefined): readonly string[] {
  return [...new Set([...DEFAULT_GENERATED_LIBRARIES, ...(values ?? [])].map(normalizeSpecifier))].sort((left, right) => left.localeCompare(right, "en"));
}

function isGeneratedLibrary(specifier: string, generatedLibraries: readonly string[]): boolean {
  const normalized = normalizeSpecifier(specifier);
  return generatedLibraries.includes(normalized) || generatedLibraries.includes(basename(normalized));
}

function normalizeSpecifier(specifier: string): string {
  return specifier.replaceAll("\\", "/").toLocaleLowerCase("en-US");
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
}

function fileKindOf(path: string): WorkspaceFileKind {
  const extension = extname(path).toLowerCase();
  if (extension === ".fcc") return "fcc";
  if (extension === ".fcg") return "fcg";
  throw new Error(`Unsupported workspace source extension '${path}'.`);
}

function sourcePath(root: string, path: string): string {
  const candidate = canonicalPath(isAbsolute(path) ? path : resolve(root, path));
  if (!isWithinRoot(root, candidate)) throw new Error(`Workspace path '${path}' is outside root '${root}'.`);
  return candidate;
}

function canonicalPath(path: string): string {
  const normalized = resolve(path).replaceAll("\\", "/");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function relativePath(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

function isWithinRoot(root: string, path: string): boolean {
  const remainder = relative(root, path);
  return remainder === "" || (!remainder.startsWith("..") && !isAbsolute(remainder));
}

function compareCanonicalPaths(root: string, left: string, right: string): number {
  return sourcePath(root, left).localeCompare(sourcePath(root, right), "en");
}

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right, "en");
}
