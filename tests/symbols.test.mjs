import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseSource } from "../src/syntax/parser.mjs";
import { extractSymbols, extractImports, flattenSymbols, formatDocComment, extractFoldingRanges, formatTokenSequence } from "../src/symbols/extractor.mjs";
import {
  clearIndexCache,
  getFileIndex,
  resolveImportPath,
  getMemberCompletions,
  getLocalCompletions,
  findDefinition,
  getFoldingRanges,
  getDocumentLinks,
  getSignatureHelp,
  searchWorkspaceSymbols,
} from "../src/symbols/indexer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(__dirname, "../../../Assets");
const gridMathPath = path.join(assetsDir, "Scripts/Utils/GridMath.fcg");
const featureFlagsPath = path.join(assetsDir, "Scripts/Core/FeatureFlags.fcg");
const customTuplePath = path.join(assetsDir, "Scripts/Contracts/CustomTuple.fcc");
const customEnumPath = path.join(assetsDir, "Scripts/Contracts/CustomEnum.fcc");

test("formatDocComment: strips comment syntax and normalizes lines", () => {
  const block = `/**
   * Calculates tile offset.
   * @param {int} col
   */`;
  assert.equal(formatDocComment(block), "Calculates tile offset.\n@param {int} col");

  const line = "// Single line comment";
  assert.equal(formatDocComment(line), "Single line comment");
});

test("extractSymbols: parses Graph and members in .fcg", () => {
  assert.ok(fs.existsSync(gridMathPath), "GridMath.fcg must exist in Assets");
  const code = fs.readFileSync(gridMathPath, "utf8");
  const parsed = parseSource(code, "fcg");
  assert.ok(parsed.tree, "GridMath.fcg must parse without syntax error");

  const symbols = extractSymbols(parsed.tree, "fcg");
  assert.equal(symbols.length, 1);
  assert.equal(symbols[0].kind, "Graph");
  assert.equal(symbols[0].name, "GridMath");

  const children = symbols[0].children ?? [];
  assert.ok(children.length >= 20, "GridMath should have at least 20 member symbols");

  // Verify function GetGardenLaneHeightY
  const laneHeightFn = children.find((c) => c.name === "GetGardenLaneHeightY");
  assert.ok(laneHeightFn, "GetGardenLaneHeightY must be extracted");
  assert.equal(laneHeightFn.kind, "Function");
  assert.equal(laneHeightFn.signature.returnType, "float");

  // Verify function GardenListIndexToColumnIndex has docComment
  const listIdxFn = children.find((c) => c.name === "GardenListIndexToColumnIndex");
  assert.ok(listIdxFn, "GardenListIndexToColumnIndex must be extracted");
  assert.ok(listIdxFn.docComment?.includes("Converts a garden list index"), "Doc comment must be extracted");
});

test("extractSymbols: parses Declarations, Enums, and Tuples in .fcc", () => {
  assert.ok(fs.existsSync(customTuplePath), "CustomTuple.fcc must exist in Assets");
  const tupleCode = fs.readFileSync(customTuplePath, "utf8");
  const parsedTuple = parseSource(tupleCode, "fcc");
  assert.ok(parsedTuple.tree, "CustomTuple.fcc must parse");

  const tupleSymbols = extractSymbols(parsedTuple.tree, "fcc");
  assert.ok(tupleSymbols.length >= 10, "CustomTuple should have multiple declarations");

  const bigNumber = tupleSymbols.find((s) => s.name === "BigNumber");
  assert.ok(bigNumber, "BigNumber tuple must be extracted");
  assert.equal(bigNumber.kind, "Tuple");
  assert.equal(bigNumber.children?.length, 3, "BigNumber has 3 fields");

  // Check CustomEnum.fcc
  assert.ok(fs.existsSync(customEnumPath), "CustomEnum.fcc must exist");
  const enumCode = fs.readFileSync(customEnumPath, "utf8");
  const parsedEnum = parseSource(enumCode, "fcc");
  assert.ok(parsedEnum.tree, "CustomEnum.fcc must parse");

  const enumSymbols = extractSymbols(parsedEnum.tree, "fcc");
  const resultCode = enumSymbols.find((s) => s.name === "ResultCode");
  assert.ok(resultCode, "ResultCode enum must be extracted");
  assert.equal(resultCode.kind, "Enum");
  assert.ok((resultCode.children?.length ?? 0) > 100, "ResultCode enum has >100 members");
});

test("extractImports: extracts import paths and aliases", () => {
  assert.ok(fs.existsSync(featureFlagsPath), "FeatureFlags.fcg must exist");
  const code = fs.readFileSync(featureFlagsPath, "utf8");
  const parsed = parseSource(code, "fcg");
  assert.ok(parsed.tree);

  const imports = extractImports(parsed.tree);
  assert.ok(imports.length >= 5);

  const customEnumImp = imports.find((i) => i.alias === "CustomEnum");
  assert.ok(customEnumImp);
  assert.equal(customEnumImp.path, "../Contracts/CustomEnum.fcc");

  const liveOpsImp = imports.find((i) => i.alias === "LiveOpsControlStore");
  assert.ok(liveOpsImp);
  assert.equal(liveOpsImp.path, "./LiveOpsControlStore.fcg");
});

test("resolveImportPath: locates relative and Assets-level imports", () => {
  const resolvedEnum = resolveImportPath(featureFlagsPath, "../Contracts/CustomEnum.fcc");
  assert.ok(resolvedEnum && fs.existsSync(resolvedEnum), "Relative import must resolve");

  const resolvedGridMath = resolveImportPath(featureFlagsPath, "GridMath.fcg");
  assert.ok(resolvedGridMath && fs.existsSync(resolvedGridMath), "Assets tree search must resolve GridMath.fcg");
});

test("getMemberCompletions: returns functions when typing <Graph>.<prefix>", () => {
  clearIndexCache();
  const mockContent = `
import "../Utils/GridMath.fcg" as GridMath

graph GameLogic {
  func Execute() {
    var a = GridMath.Get
  }
}
`;
  // Prefix "Get"
  const completions = getMemberCompletions(featureFlagsPath, mockContent, "GridMath", "Get");
  assert.ok(completions.length >= 10, "Should return multiple Get* functions for GridMath");

  const laneHeight = completions.find((c) => c.label === "GetGardenLaneHeightY");
  assert.ok(laneHeight, "GetGardenLaneHeightY must be in completions");
  assert.equal(laneHeight.kind, "Function");
  assert.equal(laneHeight.insertSnippet, "GetGardenLaneHeightY($0)");

  // Empty prefix: returns all members
  const allCompletions = getMemberCompletions(featureFlagsPath, mockContent, "GridMath", "");
  assert.ok(allCompletions.length >= 20, "Should return all members of GridMath");
});

test("getMemberCompletions: survives broken/incomplete syntax during typing", () => {
  clearIndexCache();
  // Unclosed brace and incomplete expression simulating live typing
  const brokenContent = `
import "../Utils/GridMath.fcg" as GridMath

graph Incomplete {
  func Test() {
    var a = GridMath.Get
`;
  const completions = getMemberCompletions(featureFlagsPath, brokenContent, "GridMath", "Get");
  assert.ok(completions.length >= 10, "Should still return completions even if file is syntactically incomplete");
});

test("formatTokenSequence: normalizes spacing for generic types and parameters", () => {
  const tokens = [
    { text: "player" },
    { text: "entity" },
    { text: "<" },
    { text: "Player" },
    { text: ">" },
    { text: "," },
    { text: "seedId" },
    { text: "int" },
    { text: "," },
    { text: "quantity" },
    { text: "int" },
  ];
  const formatted = formatTokenSequence(tokens);
  assert.equal(formatted, "player entity<Player>, seedId int, quantity int");
});

test("getLocalCompletions: returns imported aliases and avoids duplicate local functions", () => {
  clearIndexCache();
  const mockContent = `
import "../Utils/GridMath.fcg" as GridMath

graph LocalGraph {
  func FooBarAction() {}
  func FooBazCompute() int { return 1 }
}
`;
  // Local functions are intentionally NOT returned by getLocalCompletions to avoid
  // duplicating completion items with the official language extension
  const localCompletions = getLocalCompletions(featureFlagsPath, mockContent, "FooB");
  assert.equal(localCompletions.length, 0);

  // Imported aliases ARE returned as module completions
  const aliasCompletions = getLocalCompletions(featureFlagsPath, mockContent, "Grid");
  assert.equal(aliasCompletions.length, 1);
  assert.equal(aliasCompletions[0].label, "GridMath");
});

test("findDefinition and getSignatureHelp: yield local functions to official extension", () => {
  clearIndexCache();
  const mockContent = `
import "../Utils/GridMath.fcg" as GridMath

graph LocalGraph {
  func LocalMethod(val int) {}
  func Run() {
    LocalMethod(42)
  }
}
`;
  const callLine = "    LocalMethod(42)";
  const offset = callLine.indexOf("LocalMethod") + 2;

  // findDefinition should return null for local functions to avoid "Definitions (2)" peek popup
  const def = findDefinition(featureFlagsPath, mockContent, callLine, offset);
  assert.equal(def, null, "Must return null for local function so official extension handles it");

  // getSignatureHelp should return null for local functions to avoid ugly duplicate signature widget
  const sig = getSignatureHelp(featureFlagsPath, mockContent, "    LocalMethod(", "    LocalMethod(".length);
  assert.equal(sig, null, "Must return null for local function so official extension handles it");
});

test("extractSymbols: formats property types and modifiers cleanly in Outline", () => {
  const code = `
import "StdLibrary.fcc" as StdLibrary

[platform_server] static graph UIAnim {
  _TweenNodes List<entity<UIWidget>> = {}
  _TweenProps List<Property> = {}
  _WindowStates List<int> = {}
  _WINDOW_STATE_CLOSED = 0
}
`;
  const parsed = parseSource(code, "fcg");
  assert.ok(parsed.tree);

  const symbols = extractSymbols(parsed.tree, "fcg");
  assert.equal(symbols.length, 1);
  assert.equal(symbols[0].detail, "[platform_server] static graph");

  const props = symbols[0].children ?? [];
  assert.equal(props.length, 4);
  assert.equal(props[0].name, "_TweenNodes");
  assert.equal(props[0].detail, "List<entity<UIWidget>> = {}");
  assert.equal(props[1].name, "_TweenProps");
  assert.equal(props[1].detail, "List<Property> = {}");
  assert.equal(props[2].name, "_WindowStates");
  assert.equal(props[2].detail, "List<int> = {}");
  assert.equal(props[3].name, "_WINDOW_STATE_CLOSED");
  assert.equal(props[3].detail, "= 0");
});

test("findDefinition: jumps to member declaration across imports", () => {
  clearIndexCache();
  const mockContent = `
import "../Utils/GridMath.fcg" as GridMath

graph GameLogic {
  func Execute() {
    var a = GridMath.GetGardenLaneHeightY()
  }
}
`;
  const line = "    var a = GridMath.GetGardenLaneHeightY()";
  const charOffset = line.indexOf("GetGardenLaneHeightY") + 2;

  const def = findDefinition(featureFlagsPath, mockContent, line, charOffset);
  assert.ok(def, "Definition location must be found");
  assert.ok(def.filePath.endsWith("GridMath.fcg"), "Target file must be GridMath.fcg");
  assert.equal(def.range.line, 42, "GetGardenLaneHeightY is defined at line 42");
});

test("findDefinition: jumps to imported file when cursor is on import statement", () => {
  clearIndexCache();
  const mockContent = 'import "../Utils/GridMath.fcg" as GridMath';
  const line = 'import "../Utils/GridMath.fcg" as GridMath';
  const charOffset = 15; // inside "../Utils/GridMath.fcg"

  const def = findDefinition(featureFlagsPath, mockContent, line, charOffset);
  assert.ok(def, "Import path definition must be found");
  assert.ok(def.filePath.endsWith("GridMath.fcg"));
});

test("extractFoldingRanges: calculates ranges for imports, multiline comments, and blocks", () => {
  const code = fs.readFileSync(gridMathPath, "utf8");
  const parsed = parseSource(code, "fcg");
  assert.ok(parsed.tree);

  const ranges = extractFoldingRanges(parsed.tree);
  assert.ok(ranges.length >= 20, "Should extract multiple folding ranges");

  // Check imports block
  const importFold = ranges.find((r) => r.kind === "imports");
  assert.ok(importFold, "Imports block must be folded together");
  assert.equal(importFold.startLine, 0); // line 1 in 0-based is 0

  // Check multiline comment
  const commentFold = ranges.find((r) => r.kind === "comment");
  assert.ok(commentFold, "Multiline comment must be folded");
  assert.ok(commentFold.endLine > commentFold.startLine);
});

test("getDocumentLinks: resolves import paths to document links", () => {
  clearIndexCache();
  const links = getDocumentLinks(featureFlagsPath);
  assert.ok(links.length >= 5, "FeatureFlags should have multiple import links");

  const customEnumLink = links.find((l) => l.targetFilePath.endsWith("CustomEnum.fcc"));
  assert.ok(customEnumLink, "CustomEnum import link must be resolved");
  assert.ok(fs.existsSync(customEnumLink.targetFilePath));
});

test("getSignatureHelp: identifies function and active parameter based on commas", () => {
  clearIndexCache();
  const mockContent = `
import "../Utils/GridMath.fcg" as GridMath

graph CallTest {
  func Run() {
    var a = GridMath.GetGardenGridPosition(
  }
}
`;
  // Test 1: Just opened '(' -> activeParameter: 0
  const line1 = "    var a = GridMath.GetGardenGridPosition(";
  const help1 = getSignatureHelp(featureFlagsPath, mockContent, line1, line1.length);
  assert.ok(help1, "Signature help must be returned");
  assert.ok(help1.label.startsWith("GetGardenGridPosition("));
  assert.equal(help1.parameters.length, 3);
  assert.equal(help1.activeParameter, 0);

  // Test 2: After first comma -> activeParameter: 1
  const line2 = "    var a = GridMath.GetGardenGridPosition(pos, ";
  const help2 = getSignatureHelp(featureFlagsPath, mockContent, line2, line2.length);
  assert.ok(help2);
  assert.equal(help2.activeParameter, 1);

  // Test 3: After second comma -> activeParameter: 2
  const line3 = "    var a = GridMath.GetGardenGridPosition(pos, center, ";
  const help3 = getSignatureHelp(featureFlagsPath, mockContent, line3, line3.length);
  assert.ok(help3);
  assert.equal(help3.activeParameter, 2);
});

test("searchWorkspaceSymbols: searches across workspace files for Ctrl+T", () => {
  clearIndexCache();
  const results = searchWorkspaceSymbols(assetsDir, "GetGarden", 20);
  assert.ok(results.length >= 5, "Should find multiple GetGarden symbols in workspace");

  const match = results.find((r) => r.name === "GetGardenLaneHeightY");
  assert.ok(match, "GetGardenLaneHeightY must be in workspace search results");
  assert.ok(match.filePath.endsWith("GridMath.fcg"));
});
