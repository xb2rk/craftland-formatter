import { describe, expect, it } from "vitest";
import { formatSource } from "../../src/format/formatter.js";

interface GoldenCase {
  readonly fileName: string;
  readonly input: string;
  readonly name: string;
}

/**
 * One exact-output case per grammar construct. Each input is deliberately
 * unformatted; the expected output freezes the canonical form. Every case
 * also asserts diagnostics are empty and formatting is idempotent, so these
 * double as construct-level regression tests for the spacing analysis.
 */
const CASES: readonly GoldenCase[] = [
  {
    fileName: "Probe.fcc",
    input: "define ActionMapper: func(player entity<Player>,itemId int,target List<object>,out var payload List<object>) int",
    name: "function type with out var parameter",
  },
  {
    fileName: "Probe.fcc",
    input: "define PayloadMap: Map<int,func(player entity<Player>) int>",
    name: "map with nested function type value",
  },
  {
    fileName: "Probe.fcc",
    input: "alias NumberLike = int|float",
    name: "alias with union combination",
  },
  {
    fileName: "Probe.fcc",
    input: "enum Team {\nRed = 1\nBlue = 2\n}",
    name: "enum members",
  },
  {
    fileName: "Probe.fcg",
    input: "[platform_client]\ngraph ClientGraph {\n}",
    name: "platform decorator on graph",
  },
  {
    fileName: "Probe.fcg",
    input: "graph Probe {\nfunc Make(nodes List<object>) {\nvar doc CustomTuple.JsonDocument=CustomTuple.JsonDocument{Nodes=nodes,RootIndex=0}\n}\n}",
    name: "qualified struct literal",
  },
  {
    fileName: "Probe.fcg",
    input: "graph Probe {\nfunc Make() {\nvar info SpawnInfo=SpawnInfo{position=Vector3{0,0,0},yaw=0}\n}\n}",
    name: "nested struct literal",
  },
  {
    fileName: "Probe.fcg",
    input: "graph Probe {\nfunc Loop(count int,items List<int>) {\nfor i=0,count,1 {\n}\nfor i,item in items {\n}\n}\n}",
    name: "index and range for loops",
  },
  {
    fileName: "Probe.fcg",
    input: "graph Probe {\nfunc Read(player entity<Player>,a int,b int) {\nvar label string=player<Player>.Name\nvar top int=Math.Min(a,b)\n}\n}",
    name: "generic access and prefixed call",
  },
  {
    fileName: "Probe.fcg",
    input: "graph Probe {\nfunc Show(playerName string) {\nShowLabel(LocString{\"key.name\",List<object>{playerName}})\n}\n}",
    name: "loc-string literal",
  },
  {
    fileName: "Probe.fcg",
    input: "graph Probe {\nfunc F(m Map<string,List<int>>) Map<string,List<int>> {\nreturn m\n}\n}",
    name: "nested generics in signature",
  },
  {
    fileName: "Probe.fcg",
    input: "graph Probe {\nfunc Load() {\nTryGetScore(out var score)\nif score>0 {\ncount+=score\n} else {\ncount=0\n}\n}\n}",
    name: "out var argument with if else",
  },
];

const EXPECTED: Record<string, string> = {
  "function type with out var parameter":
    "define ActionMapper: func(player entity<Player>, itemId int, target List<object>, out var payload List<object>) int\n",
  "map with nested function type value": "define PayloadMap: Map<int, func(player entity<Player>) int>\n",
  "alias with union combination": "alias NumberLike = int | float\n",
  "enum members": ["enum Team {", "  Red = 1", "  Blue = 2", "}", ""].join("\n"),
  "platform decorator on graph": ["[platform_client]", "graph ClientGraph {", "}", ""].join("\n"),
  "qualified struct literal": [
    "graph Probe {",
    "  func Make(nodes List<object>) {",
    "    var doc CustomTuple.JsonDocument = CustomTuple.JsonDocument{Nodes = nodes, RootIndex = 0}",
    "  }",
    "}",
    "",
  ].join("\n"),
  "nested struct literal": [
    "graph Probe {",
    "  func Make() {",
    "    var info SpawnInfo = SpawnInfo{position = Vector3{0, 0, 0}, yaw = 0}",
    "  }",
    "}",
    "",
  ].join("\n"),
  "index and range for loops": [
    "graph Probe {",
    "  func Loop(count int, items List<int>) {",
    "    for i = 0, count, 1 {",
    "    }",
    "    for i, item in items {",
    "    }",
    "  }",
    "}",
    "",
  ].join("\n"),
  "generic access and prefixed call": [
    "graph Probe {",
    "  func Read(player entity<Player>, a int, b int) {",
    "    var label string = player<Player>.Name",
    "    var top int = Math.Min(a, b)",
    "  }",
    "}",
    "",
  ].join("\n"),
  "loc-string literal": [
    "graph Probe {",
    "  func Show(playerName string) {",
    '    ShowLabel(LocString{"key.name", List<object>{playerName}})',
    "  }",
    "}",
    "",
  ].join("\n"),
  "nested generics in signature": [
    "graph Probe {",
    "  func F(m Map<string, List<int>>) Map<string, List<int>> {",
    "    return m",
    "  }",
    "}",
    "",
  ].join("\n"),
  "out var argument with if else": [
    "graph Probe {",
    "  func Load() {",
    "    TryGetScore(out var score)",
    "    if score > 0 {",
    "      count += score",
    "    } else {",
    "      count = 0",
    "    }",
    "  }",
    "}",
    "",
  ].join("\n"),
};

describe("formatter golden fixtures", () => {
  for (const { fileName, input, name } of CASES) {
    it(`freezes ${name}`, () => {
      const result = formatSource(input, { fileName });
      expect(result.diagnostics, name).toEqual([]);
      expect(result.code, name).toBe(EXPECTED[name]);
      const second = formatSource(result.code!, { fileName });
      expect(second.diagnostics, name).toEqual([]);
      expect(second.code, name).toBe(result.code);
    });
  }
});
