import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeId,
  stemOfRepoPath,
  extractDomain,
  extractPlatform,
  STOP_CALLS,
  extractGraph,
} from "../src/graphify/extractor.mjs";

test("normalizeId and stemOfRepoPath normalize paths to stable identifiers", () => {
  assert.equal(
    stemOfRepoPath("Assets/Scripts/Systems/Inventory/Server_InventoryManager.fcg"),
    "assets_scripts_systems_inventory_server_inventorymanager"
  );
  assert.equal(normalizeId("Notify_WalletChanged"), "notify_walletchanged");
  assert.equal(normalizeId("   Special-Characters!   "), "special_characters");
});

test("extractDomain extracts clean domain folders without filename leaks", () => {
  assert.equal(
    extractDomain("Assets/Scripts/Systems/Inventory/Server_InventoryManager.fcg"),
    "Systems/Inventory"
  );
  assert.equal(
    extractDomain("Assets/Scripts/Data/GameConfig.fcg"),
    "Data"
  );
  assert.equal(
    extractDomain("Assets/Scripts/Contracts/CustomEvent.fcc"),
    "Contracts"
  );
  assert.equal(
    extractDomain("Assets/Scripts/UI/Server_UIInventory.fcg"),
    "UI"
  );
});

test("extractPlatform detects server vs client accurately", () => {
  assert.equal(extractPlatform("Assets/Scripts/UI/Server_UI.fcg", "graph G {}"), "server");
  assert.equal(extractPlatform("Assets/Scripts/Fx/Client_VFX.fcg", "graph G {}"), "client");
  assert.equal(extractPlatform("Assets/Scripts/Other.fcg", "[platform_server] graph G {}"), "server");
  assert.equal(extractPlatform("Assets/Scripts/Other.fcg", "[platform_client] graph G {}"), "client");
  assert.equal(extractPlatform("Assets/Scripts/Contracts/CustomEnum.fcc", "enum E {}"), "shared");
});

test("STOP_CALLS contains stdlib and primitive functions", () => {
  assert.ok(STOP_CALLS.has("min"));
  assert.ok(STOP_CALLS.has("max"));
  assert.ok(STOP_CALLS.has("clamp"));
  assert.ok(STOP_CALLS.has("log"));
  assert.ok(STOP_CALLS.has("print"));
  assert.ok(STOP_CALLS.has("list"));
  assert.ok(STOP_CALLS.has("map"));
  assert.ok(STOP_CALLS.has("stdlibrary"));
});

test("extractGraph extracts high-signal nodes and suppresses stdlib edges", () => {
  // Test extraction against Contracts directory
  const extraction = extractGraph({
    repoRoot: "../../",
    scopeDir: "../../Assets/Scripts/Contracts",
  });

  assert.ok(extraction.nodes.length > 0);
  assert.ok(extraction.edges.length > 0);

  // Check that no edge targets an external library or stdlib
  for (const edge of extraction.edges) {
    assert.ok(!edge.target.startsWith("ext_std"), `Found forbidden stdlib edge: ${edge.target}`);
    assert.ok(!edge.target.startsWith("ext_engine"), `Found forbidden engine edge: ${edge.target}`);
  }

  // Check that event nodes exist
  const eventNodes = extraction.nodes.filter((n) => n.id.startsWith("event_"));
  assert.ok(eventNodes.length > 0, "Expected event nodes to be extracted");
});

test("computeCircularCycles detects mutual circular dependencies via Tarjan SCC", async () => {
  const { computeCircularCycles } = await import("../src/graphify/query.mjs");
  const adj = new Map([
    ["node_a", ["node_b"]],
    ["node_b", ["node_a"]],
    ["node_c", ["node_a"]],
  ]);

  const cycles = computeCircularCycles(adj, ["node_a", "node_b", "node_c"]);
  assert.ok(cycles.has("node_a"));
  assert.ok(cycles.has("node_b"));
  assert.deepEqual(cycles.get("node_a"), ["node_b"]);
  assert.deepEqual(cycles.get("node_b"), ["node_a"]);
  assert.equal(cycles.has("node_c"), false);
});

test("queryBlastRadius returns direct callers and suppresses hub expansion", async () => {
  const { queryBlastRadius } = await import("../src/graphify/query.mjs");

  const mockExtraction = {
    nodes: [
      { id: "mod_target", label: "TargetModule", file_type: "code", source_file: "Target.fcg" },
      { id: "mod_caller", label: "CallerModule", file_type: "code", source_file: "Caller.fcg" },
      { id: "mod_hub", label: "SuperHub", file_type: "code", source_file: "Hub.fcg" },
    ],
    edges: [
      { source: "mod_caller", target: "mod_target", relation: "calls" },
      { source: "mod_caller", target: "mod_hub", relation: "imports" },
    ],
  };

  const result = queryBlastRadius(mockExtraction, "TargetModule", { maxDepth: 2 });
  assert.equal(result.target.id, "mod_target");
  assert.equal(result.direct_dependents.length, 1);
  assert.equal(result.direct_dependents[0].id, "mod_caller");
});
