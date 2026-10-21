import { describe, expect, it } from "vitest";
import { extractGraph, normalizeBridgeId, stemOfRepoPath } from "../../src/graphify/bridge.js";

const REPO = "/repo";

function source(path: string, text: string): { path: string; source: string } {
  return { path: `${REPO}/${path}`, source: text };
}

const TYPES = source("contracts/Types.fcc", [
  "enum Rarity {",
  "  Common = 0",
  "  Rare = 1",
  "}",
  "tuple ItemInstance {",
  "  id int = 0",
  "  rarity int = 0",
  "}",
  "event Ping(value int)",
  "",
].join("\n"));

const UTIL = source("scripts/Util.fcg", [
  'import "../contracts/Types.fcc" as Types',
  'import "List.fcc" as List',
  "graph Util {",
  "  func Double(value int) int {",
  "    return value + value",
  "  }",
  "  func Quad(value int) int {",
  "    return Double(Double(value))",
  "  }",
  "  func Count(values List<int>) int {",
  "    return List.Length(values)",
  "  }",
  "  func DefaultRarity() int {",
  "    return Rarity.Common",
  "  }",
  "}",
  "",
].join("\n"));

const MAIN = source("scripts/Main.fcg", [
  'import "./Util.fcg" as Util',
  "graph Main {",
  "  func Run() int {",
  "    return Util.Quad(2)",
  "  }",
  "  func Again() int {",
  "    return Run()",
  "  }",
  "  func Unique() int {",
  "    return Helper()",
  "  }",
  "}",
  "",
].join("\n"));

const HELPER = source("scripts/other/Helper.fcg", [
  "graph Helper {",
  "  func Helper() int {",
  "    return 1",
  "  }",
  "}",
  "",
].join("\n"));

const BROKEN = source("scripts/Broken.fcg", "@@@ not fc @@@\n");

describe("graphify bridge", () => {
  it("normalizes IDs to lowercase [a-z0-9_] stems with full directory levels", () => {
    expect(stemOfRepoPath("Assets/Scripts/Storage/StorageMigration.fcg"))
      .toBe("assets_scripts_storage_storagemigration");
    expect(normalizeBridgeId("Notify_WalletChanged")).toBe("notify_walletchanged");
  });

  it("emits module, declaration, and contains structure", () => {
    const { extraction } = extractGraph([TYPES, UTIL], { repoRoot: REPO, workspaceRoot: REPO });
    const ids = new Set(extraction.nodes.map((node) => node.id));
    expect(ids).toContain("contracts_types");
    expect(ids).toContain("contracts_types_rarity");
    expect(ids).toContain("contracts_types_common");
    expect(ids).toContain("contracts_types_iteminstance");
    expect(ids).toContain("contracts_types_ping");
    expect(ids).toContain("scripts_util");
    expect(ids).toContain("scripts_util_util");
    expect(ids).toContain("scripts_util_double");
    const contains = extraction.edges.filter((edge) => edge.relation === "contains");
    expect(contains).toContainEqual(expect.objectContaining({
      confidence: "EXTRACTED", confidence_score: 1, source: "scripts_util_util", target: "scripts_util_double",
    }));
    for (const node of extraction.nodes) {
      expect(node.id).toMatch(/^[a-z0-9_]+$/);
      expect(node.file_type).toBe("code");
    }
  });

  it("resolves same-file, import-linked, and external calls as EXTRACTED", () => {
    const { extraction } = extractGraph([TYPES, UTIL, MAIN], { repoRoot: REPO, workspaceRoot: REPO });
    const calls = extraction.edges.filter((edge) => edge.relation === "calls");
    expect(calls).toContainEqual(expect.objectContaining({
      confidence: "EXTRACTED", source: "scripts_util_quad", target: "scripts_util_double",
    }));
    expect(calls).toContainEqual(expect.objectContaining({
      confidence: "EXTRACTED", source: "scripts_main_run", target: "scripts_util_quad",
    }));
    expect(calls).toContainEqual(expect.objectContaining({
      confidence: "EXTRACTED", source: "scripts_main_again", target: "scripts_main_run",
    }));
    expect(calls).toContainEqual(expect.objectContaining({
      confidence: "EXTRACTED", source: "scripts_util_count", target: "ext_list_length",
    }));
    const imports = extraction.edges.filter((edge) => edge.relation === "imports");
    expect(imports).toContainEqual(expect.objectContaining({ source: "scripts_main", target: "scripts_util" }));
    expect(imports).toContainEqual(expect.objectContaining({ source: "scripts_util", target: "ext_list" }));
  });

  it("links enum reads as references and unique cross-file calls as INFERRED", () => {
    const { extraction } = extractGraph([TYPES, UTIL, MAIN, HELPER], { repoRoot: REPO, workspaceRoot: REPO });
    expect(extraction.edges).toContainEqual(expect.objectContaining({
      confidence: "EXTRACTED", relation: "references",
      source: "scripts_util_defaultrarity", target: "contracts_types_rarity",
    }));
    expect(extraction.edges).toContainEqual(expect.objectContaining({
      confidence: "INFERRED", confidence_score: 0.95, relation: "calls",
      source: "scripts_main_unique", target: "scripts_other_helper_helper_function",
    }));
  });

  it("disambiguates a function sharing its graph's name with a kind suffix", () => {
    const { extraction } = extractGraph([HELPER], { repoRoot: REPO, workspaceRoot: REPO });
    const ids = new Set(extraction.nodes.map((node) => node.id));
    expect(ids).toContain("scripts_other_helper_helper");
    expect(ids).toContain("scripts_other_helper_helper_function");
  });

  it("reports unparsed files and unresolved imports without dropping the graph", () => {
    const missing = source("scripts/Lonely.fcg", 'import "../Nope.fcc" as Nope\ngraph Lonely {\n  func Go() int {\n    return Missing()\n  }\n}\n');
    const { extraction, findings } = extractGraph([TYPES, UTIL, MAIN, BROKEN, missing], { repoRoot: REPO, workspaceRoot: REPO });
    const kinds = findings.map((finding) => finding.kind);
    expect(kinds).toContain("unparsed-file");
    expect(kinds).toContain("unresolved-import");
    expect(kinds).toContain("unresolved-call");
    expect(extraction.nodes.some((node) => node.id === "scripts_broken")).toBe(true);
  });

  it("is deterministic across runs", () => {
    const inputs = [TYPES, UTIL, MAIN, HELPER];
    const first = extractGraph(inputs, { repoRoot: REPO, workspaceRoot: REPO });
    const second = extractGraph(inputs, { repoRoot: REPO, workspaceRoot: REPO });
    expect(second).toEqual(first);
  });
});
