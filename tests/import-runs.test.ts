import { describe, expect, it } from "vitest";
import { sortHeaderImports } from "../src/imports/import-runs.js";
import { lex } from "../src/lex/lexer.js";
import { parseGraphFile, parseHeaderFile } from "../src/parser/file-parser.js";
import { formatSource } from "../src/format/formatter.js";

function sortImports(source: string, fileName = "Imports.fcc"): string {
  const lexed = lex(source);
  expect(lexed.diagnostics).toEqual([]);
  const parsed = fileName.endsWith(".fcg") ? parseGraphFile(lexed) : parseHeaderFile(lexed);
  expect(parsed.diagnostics).toEqual([]);
  expect(parsed.node).toBeDefined();
  return sortHeaderImports(source, lexed.tokens, parsed.node!.imports);
}

describe("parsed header imports", () => {
  it("sorts the complete safe header import block and keeps leading comments attached", () => {
    const source = '// zeta\nimport "z" as Z\n// alpha\nimport "a" as A\n\nimport "y" as Y\n';
    expect(sortImports(source)).toBe('// alpha\nimport "a" as A\nimport "y" as Y\n// zeta\nimport "z" as Z\n');
  });

  it("orders standard, contracts, and depth groups with reserved libraries at the standard tail", () => {
    const source = [
      'import "../Feature/Z.fcg" as Z',
      'import "EditorGenLib.fcc" as EditorGenLib',
      'import "../../Contracts/Z.fcc" as ContractZ',
      'import "Map.fcc" as Map',
      'import "../Contracts/A.fcc" as ContractA',
      'import "StdLibrary.fcc" as StdLibrary',
      'import "./Local.fcg" as Local',
      'import "../../Utils/Deep.fcg" as Deep',
      'import "List.fcc" as List',
      "",
    ].join("\n");

    expect(sortImports(source)).toBe([
      'import "List.fcc" as List',
      'import "Map.fcc" as Map',
      'import "StdLibrary.fcc" as StdLibrary',
      'import "EditorGenLib.fcc" as EditorGenLib',
      "",
      'import "../../Contracts/Z.fcc" as ContractZ',
      'import "../Contracts/A.fcc" as ContractA',
      "",
      'import "../../Utils/Deep.fcg" as Deep',
      'import "../Feature/Z.fcg" as Z',
      'import "./Local.fcg" as Local',
      "",
    ].join("\n"));
  });

  it("classifies parsed named imports by their target path", () => {
    const source = [
      'import Res from "EditorGenLib.fcc"',
      'import "StdLibrary.fcc" as StdLibrary',
      'import Type from "../Contracts/Type.fcc"',
      'import "List.fcc" as List',
      'import Helper from "./Helper.fcg"',
      "",
    ].join("\n");

    expect(sortImports(source)).toBe([
      'import "List.fcc" as List',
      'import "StdLibrary.fcc" as StdLibrary',
      'import Res from "EditorGenLib.fcc"',
      "",
      'import Type from "../Contracts/Type.fcc"',
      "",
      'import Helper from "./Helper.fcg"',
      "",
    ].join("\n"));
  });

  it("moves attached comments with their parsed import and adds only one group separator", () => {
    const source = [
      "// local helper",
      'import "./Helper.fcg" as Helper',
      "// editor resources",
      'import Res from "EditorGenLib.fcc"',
      "// contract types",
      'import "../Contracts/Types.fcc" as Types',
      'import "List.fcc" as List',
      "",
    ].join("\n");

    expect(sortImports(source)).toBe([
      'import "List.fcc" as List',
      "// editor resources",
      'import Res from "EditorGenLib.fcc"',
      "",
      "// contract types",
      'import "../Contracts/Types.fcc" as Types',
      "",
      "// local helper",
      'import "./Helper.fcg" as Helper',
      "",
    ].join("\n"));
  });

  it("normalizes blank-separated parsed header imports as one canonical block", () => {
    const source = [
      'import "../Z.fcg" as Z',
      'import "../A.fcg" as A',
      "",
      'import "./Z.fcg" as LocalZ',
      'import "./A.fcg" as LocalA',
      "",
    ].join("\n");

    expect(sortImports(source)).toBe([
      'import "../A.fcg" as A',
      'import "../Z.fcg" as Z',
      'import "./A.fcg" as LocalA',
      'import "./Z.fcg" as LocalZ',
      "",
    ].join("\n"));
  });

  it("canonicalizes standard, contract, and project imports across arbitrary blank runs", () => {
    const expected = [
      'import "Convert.fcc" as Convert',
      'import "List.fcc" as List',
      'import "Map.fcc" as Map',
      'import "Strings.fcc" as Strings',
      'import "StdLibrary.fcc" as StdLibrary',
      "",
      'import "../Contracts/CustomTuple.fcc" as CustomTuple',
      "",
      'import "./BigNumber.fcg" as BigNumberLibrary',
      "",
    ].join("\n");
    const sources = [
      [
        'import "Convert.fcc" as Convert',
        'import "List.fcc" as List',
        'import "Strings.fcc" as Strings',
        'import "StdLibrary.fcc" as StdLibrary',
        "",
        'import "../Contracts/CustomTuple.fcc" as CustomTuple',
        'import "Map.fcc" as Map',
        "",
        'import "./BigNumber.fcg" as BigNumberLibrary',
        "",
      ].join("\n"),
      [
        'import "StdLibrary.fcc" as StdLibrary',
        'import "Convert.fcc" as Convert',
        'import "List.fcc" as List',
        "",
        "",
        'import "../Contracts/CustomTuple.fcc" as CustomTuple',
        'import "Map.fcc" as Map',
        "",
        'import "Strings.fcc" as Strings',
        'import "./BigNumber.fcg" as BigNumberLibrary',
        "",
      ].join("\n"),
    ];

    for (const source of sources) {
      const formatted = sortImports(source);
      expect(formatted).toBe(expected);
      expect(sortImports(formatted)).toBe(formatted);
    }
  });

  it("uses AST imports only and never sees import-like protected text", () => {
    const source = [
      'import "Map.fcc" as Map',
      'import "List.fcc" as List',
      "graph Foo {",
      "  func Bar() {",
      '    var raw string = `first\r\nimport "not-an-import.fcc"`',
      '    // import "also-not-an-import.fcc"',
      "  }",
      "}",
      "",
    ].join("\r\n");

    const sorted = sortImports(source, "Imports.fcg");
    expect(sorted).toContain('first\r\nimport "not-an-import.fcc"');
    expect(sorted).toContain('// import "also-not-an-import.fcc"');
    expect(sorted).toContain('import "List.fcc" as List\r\nimport "Map.fcc" as Map');
    expect(sortImports(sorted, "Imports.fcg")).toBe(sorted);
    const formatted = formatSource(source, { fileName: "Imports.fcg" });
    expect(formatted.diagnostics).toEqual([]);
    expect(formatted.code).toContain('import "List.fcc" as List\nimport "Map.fcc" as Map');
  });
});
