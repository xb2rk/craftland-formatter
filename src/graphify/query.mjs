/**
 * @fileoverview Universal Blast Radius & Architecture Query Engine for Craftland FC.
 *
 * Solves the "Transitive Explosion Trap" via:
 * 1. Reverse-only dependency traversal (who depends on target, never who target depends on)
 * 2. Hub-Suppressed Reachability (stops expansion through high-degree hubs like GameConfig/CustomTuple)
 * 3. Symbol-Level Discrimination (differentiates changing a specific function vs whole file)
 * 4. Tarjan's SCC Cycle Detection (detects co-dependent circular import twins)
 * 5. Event Bus Cascade (Publisher -> Event -> Subscribers)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeId } from "./extractor.mjs";

const DEFAULT_HUB_THRESHOLD = 20;

/**
 * Run Tarjan's Strongly Connected Components algorithm on 'imports' edges.
 *
 * @param {Map<string, string[]>} importAdj
 * @param {string[]} nodeIds
 * @returns {Map<string, string[]>} Map from node ID to its circular cycle group
 */
export function computeCircularCycles(importAdj, nodeIds) {
  let index = 0;
  const indices = new Map();
  const lowlinks = new Map();
  const onStack = new Map();
  const stack = [];
  const cycleMap = new Map();

  function strongConnect(u) {
    indices.set(u, index++);
    lowlinks.set(u, indices.get(u));
    stack.push(u);
    onStack.set(u, true);

    for (const v of importAdj.get(u) || []) {
      if (!indices.has(v)) {
        strongConnect(v);
        lowlinks.set(u, Math.min(lowlinks.get(u), lowlinks.get(v)));
      } else if (onStack.get(v)) {
        lowlinks.set(u, Math.min(lowlinks.get(u), indices.get(v)));
      }
    }

    if (lowlinks.get(u) === indices.get(u)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.set(w, false);
        scc.push(w);
      } while (w !== u);

      if (scc.length > 1) {
        for (const node of scc) {
          cycleMap.set(node, scc.filter((n) => n !== node));
        }
      }
    }
  }

  for (const id of nodeIds) {
    if (!indices.has(id)) {
      strongConnect(id);
    }
  }

  return cycleMap;
}

/**
 * Query the impact / blast radius of modifying a target symbol or file.
 *
 * @param {any} extraction
 * @param {string} queryStr
 * @param {{ hubThreshold?: number, maxDepth?: number }} [options]
 */
export function queryBlastRadius(extraction, queryStr, options = {}) {
  const hubThreshold = options.hubThreshold ?? DEFAULT_HUB_THRESHOLD;
  const maxDepth = options.maxDepth ?? 2;

  const nodes = extraction.nodes;
  const edges = extraction.edges;

  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  // Adjacency maps
  const incoming = new Map(); // target -> edges
  const outgoing = new Map(); // source -> edges
  const importAdj = new Map(); // source -> target[] (for SCC)
  const inDegree = new Map();

  for (const e of edges) {
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target).push(e);

    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source).push(e);

    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);

    if (e.relation === "imports") {
      if (!importAdj.has(e.source)) importAdj.set(e.source, []);
      importAdj.get(e.source).push(e.target);
    }
  }

  // 1. Tarjan SCC Cycles
  const codeNodeIds = nodes.filter((n) => n.file_type === "code").map((n) => n.id);
  const cycleMap = computeCircularCycles(importAdj, codeNodeIds);

  // 2. Resolve Target Node (Disambiguation Logic)
  const normQuery = normalizeId(queryStr);
  const lowerQuery = queryStr.toLowerCase();

  // 2.1 Exact matches: exact ID, exact label (e.g. "Server_InventoryManager.InitializePlayer"), or exact file
  const exactMatches = nodes.filter((n) => {
    return (
      n.id === normQuery ||
      n.label.toLowerCase() === lowerQuery ||
      n.source_file.toLowerCase() === lowerQuery ||
      n.source_file.toLowerCase().endsWith(`/${lowerQuery}`) ||
      n.source_file.toLowerCase().endsWith(`\\${lowerQuery}`)
    );
  });

  if (exactMatches.length === 1) {
    return runAnalysisForTarget(exactMatches[0]);
  }

  // 2.2 Suffix/Member matches (e.g. user just passed "InitializePlayer")
  const suffixMatches = nodes.filter((n) => {
    return (
      n.id.endsWith(`_${normQuery}`) ||
      n.label.toLowerCase().endsWith(`.${lowerQuery}`)
    );
  });

  if (suffixMatches.length > 1) {
    // Multiple symbols share this exact name -> Return Ambiguity Error with Candidates
    return {
      ambiguous: true,
      query: queryStr,
      candidates: suffixMatches.map((n) => ({
        id: n.id,
        label: n.label,
        file: n.source_file,
        domain: n.domain || "Unknown",
      })),
      message: `Ambiguous symbol '${queryStr}': matched ${suffixMatches.length} different declarations. Please use a qualified name like '<Module>.<Symbol>' (e.g. '${suffixMatches[0].label}').`,
    };
  }

  const allMatches = exactMatches.length ? exactMatches : suffixMatches;
  if (!allMatches.length) {
    return { error: `Symbol or file '${queryStr}' not found in knowledge graph.` };
  }

  return runAnalysisForTarget(allMatches[0]);

  function runAnalysisForTarget(target) {

  const isHub = (inDegree.get(target.id) || 0) > hubThreshold;
  const isSymbol = target.id.includes("_") && !target.id.startsWith("assets_scripts_");

  // 3. Direct Dependents (1-hop Reverse Dependency)
  const directDependents = [];
  const directEdges = incoming.get(target.id) || [];

  for (const e of directEdges) {
    if (e.relation === "calls" || e.relation === "imports" || e.relation === "references" || e.relation === "subscribes") {
      const sourceNode = nodesById.get(e.source);
      if (sourceNode && sourceNode.id !== target.id) {
        directDependents.push({
          id: sourceNode.id,
          label: sourceNode.label,
          file: sourceNode.source_file,
          relation: e.relation,
        });
      }
    }
  }

  // 4. Event Cascade Analysis
  // If target is an event: who listens?
  // If target is a module: what events does it publish, and who listens to them?
  const eventCascade = [];
  if (target.id.startsWith("event_")) {
    const subscribers = (incoming.get(target.id) || []).filter((e) => e.relation === "subscribes");
    for (const sub of subscribers) {
      const subNode = nodesById.get(sub.source);
      if (subNode) {
        eventCascade.push({
          event: target.label,
          subscriber: subNode.label,
          file: subNode.source_file,
        });
      }
    }
  } else {
    // Outgoing publishes
    const published = (outgoing.get(target.id) || []).filter((e) => e.relation === "publishes");
    for (const pub of published) {
      const eventNode = nodesById.get(pub.target);
      const eventName = eventNode ? eventNode.label : pub.target;
      const subs = (incoming.get(pub.target) || []).filter((e) => e.relation === "subscribes");
      for (const sub of subs) {
        const subNode = nodesById.get(sub.source);
        if (subNode && subNode.id !== target.id) {
          eventCascade.push({
            event: eventName,
            subscriber: subNode.label,
            file: subNode.source_file,
          });
        }
      }
    }
  }

  // 5. Multi-Hop Transitive Reachability with HUB SUPPRESSION
  const visited = new Set([target.id]);
  const tier2Impact = [];

  // If the target itself is NOT a giant hub, explore 2nd hop
  if (!isHub && maxDepth >= 2) {
    for (const dep of directDependents) {
      visited.add(dep.id);
      const depInDegree = inDegree.get(dep.id) || 0;

      // HUB SUPPRESSION: Do not expand backwards through nodes that are hubs!
      // This prevents expanding into 100 unrelated files.
      if (depInDegree > hubThreshold) continue;

      const secondaryEdges = incoming.get(dep.id) || [];
      for (const se of secondaryEdges) {
        if (se.relation === "calls" || se.relation === "imports") {
          if (!visited.has(se.source)) {
            visited.add(se.source);
            const secNode = nodesById.get(se.source);
            if (secNode) {
              tier2Impact.push({
                id: secNode.id,
                label: secNode.label,
                file: secNode.source_file,
                via: dep.label,
                relation: se.relation,
              });
            }
          }
        }
      }
    }
  }

  // 6. Circular Co-dependent Cycles (Tarjan SCC)
  const cyclePeers = (cycleMap.get(target.id) || []).map((id) => {
    const node = nodesById.get(id);
    return { id, label: node ? node.label : id, file: node ? node.source_file : "" };
  });

  return {
    target: {
      id: target.id,
      label: target.label,
      file: target.source_file,
      type: target.file_type,
      domain: target.domain || "Unknown",
      is_hub: isHub,
      in_degree: inDegree.get(target.id) || 0,
    },
    co_dependent_cycle: cyclePeers,
    direct_dependents: directDependents,
    event_cascade: eventCascade,
    indirect_tier2: tier2Impact.slice(0, 15), // Capped for LLM prompt safety
    hub_suppressed: isHub,
    summary: {
      direct_count: directDependents.length,
      event_cascade_count: eventCascade.length,
      indirect_count: tier2Impact.length,
      cycle_count: cyclePeers.length,
    },
  };
  }
}
