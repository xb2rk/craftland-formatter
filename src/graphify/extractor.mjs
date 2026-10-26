/**
 * @fileoverview High-Signal Knowledge Graph Extractor for Craftland FC.
 *
 * Extracts clean, hierarchical code graphs without stdlib or syntactic noise.
 * Identifies:
 * - Module nodes (bounded by domain and platform)
 * - Public contract symbols (functions, enums, tuples)
 * - Event-driven topology (Event declarations, publishers, and subscribers)
 * - Cross-module import and call dependencies
 * - Documentation anchors (linking Business Docs to code modules)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getFileIndex, resolveImportPath } from "../symbols/indexer.mjs";
import { parseSource } from "../syntax/parser.mjs";

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   file_type: "code" | "document",
 *   source_file: string,
 *   source_location: { line: number, column: number } | null,
 *   domain?: string,
 *   platform?: "server" | "client" | "shared",
 *   author: null,
 *   captured_at: null,
 *   contributor: null,
 *   source_url: null,
 * }} GraphNode
 *
 * @typedef {{
 *   source: string,
 *   target: string,
 *   relation: "contains" | "imports" | "calls" | "references" | "publishes" | "subscribes" | "specifies",
 *   confidence: "EXTRACTED" | "INFERRED",
 *   confidence_score: number,
 *   weight: number,
 *   source_file: string,
 *   source_location: { line: number, column: number } | null,
 * }} GraphEdge
 *
 * @typedef {{
 *   nodes: GraphNode[],
 *   edges: GraphEdge[],
 *   hyperedges: any[],
 *   input_tokens: 0,
 *   output_tokens: 0,
 * }} GraphExtraction
 */

export const STOP_CALLS = new Set([
  // Built-ins & Primitives
  "min", "max", "clamp", "abs", "floor", "ceil", "round", "sqrt", "pow",
  "tostring", "tonumber", "type", "assert", "print", "log", "format",
  "sizeof", "length", "new", "gettype", "isnil", "isvalid",
  // Standard collections & utilities
  "list", "map", "stdlibrary", "math", "table", "string", "vector3", "quaternion", "color",
]);

export function normalizeId(str) {
  return str.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

export function toRepoRelative(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).replace(/\\/g, "/");
}

export function stemOfRepoPath(repoRelativePath) {
  const withoutExt = repoRelativePath.replace(/\.[a-z0-9]+$/i, "");
  return normalizeId(withoutExt.replace(/[/\\]+/g, "_"));
}

/**
 * Determine architectural domain from repo relative path.
 * e.g. Assets/Scripts/Systems/Inventory/Server_InventoryManager.fcg -> Systems/Inventory
 *
 * @param {string} relativePath
 * @returns {string}
 */
export function extractDomain(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  const match = normalized.match(/Assets\/Scripts\/([^/]+)(?:\/([^/]+))?/i);
  if (match) {
    const p1 = match[1];
    const p2 = match[2];
    if (p2 && !/\.(fcg|fcc)$/i.test(p2)) {
      return `${p1}/${p2}`;
    }
    return p1;
  }
  return "General";
}

/**
 * Determine platform from file path and content.
 *
 * @param {string} relativePath
 * @param {string} content
 * @returns {"server" | "client" | "shared"}
 */
export function extractPlatform(relativePath, content) {
  const lower = relativePath.toLowerCase();
  if (lower.includes("client_") || content.includes("[platform_client]")) {
    return "client";
  }
  if (lower.includes("server_") || content.includes("[platform_server]")) {
    return "server";
  }
  return "shared";
}

/**
 * Collect all .fcc and .fcg files under a directory recursively.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function collectSourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    return /\.(fcg|fcc)$/i.test(dir) ? [path.resolve(dir)] : [];
  }

  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(full));
    } else if (/\.(fcg|fcc)$/i.test(entry.name)) {
      results.push(path.resolve(full));
    }
  }
  return results.sort();
}

/**
 * Lossless AST traversal.
 *
 * @param {any} node
 * @param {(n: any) => void | "skip"} enter
 * @param {(n: any) => void} [exit]
 */
function walkAst(node, enter, exit) {
  if (!node) return;
  if (enter(node) === "skip") return;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      walkAst(child, enter, exit);
    }
  }
  exit?.(node);
}

/**
 * Main graph extraction engine.
 *
 * @param {{
 *   repoRoot: string,
 *   scopeDir: string,
 *   docsDir?: string,
 * }} options
 * @returns {GraphExtraction}
 */
export function extractGraph(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const scopeDir = path.resolve(options.scopeDir);
  const docsDir = options.docsDir ? path.resolve(options.docsDir) : null;

  const files = collectSourceFiles(scopeDir);

  const nodes = new Map();
  const edges = new Map();

  function addNode(node) {
    if (!nodes.has(node.id)) {
      nodes.set(node.id, node);
    }
  }

  function addEdge(edge) {
    const key = `${edge.source}|${edge.target}|${edge.relation}`;
    if (!edges.has(key) && edge.source !== edge.target) {
      edges.set(key, edge);
    }
  }

  // Phase 1: Scan and record all files, module nodes, and public symbols
  /** @type {Map<string, { moduleId: string, label: string, filePath: string, domain: string, platform: string, index: any, content: string }>} */
  const fileContexts = new Map();
  /** @type {Set<string>} Set of all declared event names */
  const knownEvents = new Set();
  /** @type {Map<string, string>} Map from function symbol ID to owning module ID */
  const publicFunctionNodes = new Map();

  for (const filePath of files) {
    const relPath = toRepoRelative(repoRoot, filePath);
    const moduleId = stemOfRepoPath(relPath);
    const label = path.basename(filePath, path.extname(filePath));
    const content = fs.readFileSync(filePath, "utf8");
    const domain = extractDomain(relPath);
    const platform = extractPlatform(relPath, content);
    const index = getFileIndex(filePath, content);

    fileContexts.set(filePath, { moduleId, label, filePath, domain, platform, index, content });

    // Register module node
    addNode({
      id: moduleId,
      label,
      file_type: "code",
      source_file: relPath,
      source_location: null,
      domain,
      platform,
      author: null,
      captured_at: null,
      contributor: null,
      source_url: null,
    });

    if (!index) continue;

    // Check if this is a Contract file declaring events (e.g. CustomEvent.fcc)
    const isEventContract = /CustomEvent\.fcc$/i.test(filePath) || domain.toLowerCase().includes("contract");

    for (const s of index.symbols) {
      // Event declarations in Contracts
      if (s.kind === "EventListener" && isEventContract) {
        knownEvents.add(s.name);
        const eventId = `event_${normalizeId(s.name)}`;
        addNode({
          id: eventId,
          label: `Event: ${s.name}`,
          file_type: "code",
          source_file: relPath,
          source_location: { line: s.range.line, column: s.range.column },
          domain: "Contracts/Event",
          platform: "shared",
          author: null,
          captured_at: null,
          contributor: null,
          source_url: null,
        });
        addEdge({
          source: moduleId,
          target: eventId,
          relation: "contains",
          confidence: "EXTRACTED",
          confidence_score: 1.0,
          weight: 1.0,
          source_file: relPath,
          source_location: { line: s.range.line, column: s.range.column },
        });
      }

      // Tuples and Enums in Contracts/Data
      if (s.kind === "Tuple" || s.kind === "Enum") {
        const typeId = `${moduleId}_${normalizeId(s.name)}`;
        addNode({
          id: typeId,
          label: `${s.kind}: ${s.name}`,
          file_type: "code",
          source_file: relPath,
          source_location: { line: s.range.line, column: s.range.column },
          domain,
          platform,
          author: null,
          captured_at: null,
          contributor: null,
          source_url: null,
        });
        addEdge({
          source: moduleId,
          target: typeId,
          relation: "contains",
          confidence: "EXTRACTED",
          confidence_score: 1.0,
          weight: 1.0,
          source_file: relPath,
          source_location: { line: s.range.line, column: s.range.column },
        });
      }
    }

    // Public functions in Graphs
    for (const member of index.graphMembers ?? []) {
      if (member.kind === "Function") {
        // Suppress private helpers starting with _
        if (member.name.startsWith("_")) continue;
        // Suppress trivial lifecycle methods
        if (member.name === "OnAwake" || member.name === "OnUpdate" || member.name === "OnDestroy") continue;

        const funcId = `${moduleId}_${normalizeId(member.name)}`;
        publicFunctionNodes.set(funcId, moduleId);

        addNode({
          id: funcId,
          label: `${label}.${member.name}`,
          file_type: "code",
          source_file: relPath,
          source_location: { line: member.range.line, column: member.range.column },
          domain,
          platform,
          author: null,
          captured_at: null,
          contributor: null,
          source_url: null,
        });
        addEdge({
          source: moduleId,
          target: funcId,
          relation: "contains",
          confidence: "EXTRACTED",
          confidence_score: 1.0,
          weight: 1.0,
          source_file: relPath,
          source_location: { line: member.range.line, column: member.range.column },
        });
      }
    }
  }

  // Phase 2: Resolve Imports, Event Subscriptions, Dispatches, and Cross-Module Calls
  for (const [filePath, ctx] of fileContexts) {
    const { moduleId, relPath = toRepoRelative(repoRoot, filePath), index, content } = ctx;
    if (!index) continue;

    // 2.1 Imports (Internal dependencies only; discard stdlib/external extensions)
    /** @type {Map<string, { moduleId: string, filePath: string }>} */
    const aliasMap = new Map();

    for (const imp of index.imports) {
      const resolved = resolveImportPath(filePath, imp.path);
      if (!resolved) continue;

      // Only link if inside Assets/Scripts
      const relTarget = toRepoRelative(repoRoot, resolved);
      if (!relTarget.startsWith("Assets/Scripts/")) {
        // External library or StdLibrary -> Suppress!
        continue;
      }

      const targetCtx = fileContexts.get(resolved);
      if (targetCtx) {
        aliasMap.set(imp.alias, { moduleId: targetCtx.moduleId, filePath: resolved });

        addEdge({
          source: moduleId,
          target: targetCtx.moduleId,
          relation: "imports",
          confidence: "EXTRACTED",
          confidence_score: 1.0,
          weight: 1.0,
          source_file: relPath,
          source_location: { line: imp.range.line, column: imp.range.column },
        });
      }
    }

    // 2.2 Event Subscriptions in .fcg graphs
    for (const member of index.graphMembers ?? []) {
      if (member.kind === "EventListener") {
        if (knownEvents.has(member.name)) {
          const eventId = `event_${normalizeId(member.name)}`;
          addEdge({
            source: moduleId,
            target: eventId,
            relation: "subscribes",
            confidence: "EXTRACTED",
            confidence_score: 1.0,
            weight: 1.0,
            source_file: relPath,
            source_location: { line: member.range.line, column: member.range.column },
          });
        }
      }
    }

    // 2.3 Parse Syntax Tree for Calls and Event Dispatches
    const ext = path.extname(filePath).slice(1).toLowerCase();
    let parsedTree = null;
    try {
      const p = parseSource(content, ext);
      parsedTree = p?.tree;
    } catch {
      parsedTree = null;
    }

    if (parsedTree?.tokens) {
      const tokens = parsedTree.tokens;

      // Detect Event Dispatches (e.g. DispatchEventToEntity(Notify_..., ...))
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.channel !== "syntax") continue;

        // Check if token references a known event name
        if (knownEvents.has(t.text)) {
          // If this is not an event listener declaration header
          const prev = tokens[i - 1]?.text;
          const next = tokens[i + 1]?.text;
          if (prev !== "event") {
            const eventId = `event_${normalizeId(t.text)}`;
            addEdge({
              source: moduleId,
              target: eventId,
              relation: "publishes",
              confidence: "EXTRACTED",
              confidence_score: 1.0,
              weight: 1.0,
              source_file: relPath,
              source_location: { line: t.line, column: t.column },
            });
          }
        }
      }

      // Detect Cross-Module Calls: <Alias>.<Member>(...)
      walkAst(parsedTree, (node) => {
        if (node.kind === "BareCall" || node.kind === "ValueCall") {
          // Find tokens immediately preceding the call's opening paren
          const preTokens = [];
          for (let i = tokens.length - 1; i >= 0; i--) {
            const t = tokens[i];
            if (t.channel !== "syntax") continue;
            if (t.end <= node.start) {
              preTokens.unshift(t);
              if (preTokens.length >= 3) break;
            }
          }

          if (preTokens.length >= 3) {
            const [tObj, tDot, tMethod] = preTokens.slice(-3);
            if (tDot.text === "." && tObj.text && tMethod.text) {
              const alias = tObj.text;
              const method = tMethod.text;

              // Check if alias is a known imported module
              const target = aliasMap.get(alias);
              if (target) {
                // If it's an event reference
                if (knownEvents.has(method)) {
                  addEdge({
                    source: moduleId,
                    target: `event_${normalizeId(method)}`,
                    relation: "publishes",
                    confidence: "EXTRACTED",
                    confidence_score: 1.0,
                    weight: 1.0,
                    source_file: relPath,
                    source_location: { line: tObj.line, column: tObj.column },
                  });
                } else if (!STOP_CALLS.has(method.toLowerCase()) && !method.startsWith("_")) {
                  // Cross-module function call!
                  const targetFuncId = `${target.moduleId}_${normalizeId(method)}`;
                  if (nodes.has(targetFuncId)) {
                    addEdge({
                      source: moduleId,
                      target: targetFuncId,
                      relation: "calls",
                      confidence: "EXTRACTED",
                      confidence_score: 1.0,
                      weight: 1.0,
                      source_file: relPath,
                      source_location: { line: tObj.line, column: tObj.column },
                    });
                  } else {
                    // Call to target module
                    addEdge({
                      source: moduleId,
                      target: target.moduleId,
                      relation: "calls",
                      confidence: "EXTRACTED",
                      confidence_score: 1.0,
                      weight: 1.0,
                      source_file: relPath,
                      source_location: { line: tObj.line, column: tObj.column },
                    });
                  }
                }
              }
            }
          }
        }
      });
    }
  }

  // Phase 3: Docs Anchoring (Linking Markdown Docs to Code Modules)
  if (docsDir && fs.existsSync(docsDir)) {
    const docFiles = fs.readdirSync(docsDir).filter((f) => f.endsWith(".md"));
    for (const docName of docFiles) {
      const docPath = path.join(docsDir, docName);
      const docRel = toRepoRelative(repoRoot, docPath);
      const docId = `doc_${normalizeId(docName)}`;
      const docContent = fs.readFileSync(docPath, "utf8");

      addNode({
        id: docId,
        label: docName,
        file_type: "document",
        source_file: docRel,
        source_location: null,
        domain: "Documentation",
        platform: "shared",
        author: null,
        captured_at: null,
        contributor: null,
        source_url: null,
      });

      // Match mentions of code modules or events in docs
      for (const [filePath, ctx] of fileContexts) {
        if (docContent.includes(ctx.label)) {
          addEdge({
            source: docId,
            target: ctx.moduleId,
            relation: "specifies",
            confidence: "EXTRACTED",
            confidence_score: 1.0,
            weight: 1.0,
            source_file: docRel,
            source_location: null,
          });
        }
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    hyperedges: [],
    input_tokens: 0,
    output_tokens: 0,
  };
}
