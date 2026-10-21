/**
 * @module format/imports.test - verifies import collecting, bucket sorting, and rendering.
 *
 * Covers library (`import "path" as Alias`) vs script (`import Name [as Alias] from "path"`)
 * forms, 7-bucket sort order (library→StdLibrary→EditorGenLib→script from→Contracts→../→./)
 * with group blank gaps, grammar-correct alias rendering, and missing-alias error for libraries.
 */

import { describe, expect, it } from "vitest";
import { collectImports, ImportKind, renderImports } from "../../../src/format/imports.js";
import { itemize } from "../../../src/lex/items.js";
import { tokenize } from "../../../src/lex/tokenizer.js";

describe("imports", () => {
  it("collects library and optional-alias script forms", () => {
    const document = itemize(tokenize([
      'import "StdLibrary.fcc" as StdLibrary',
      'import Res from "EditorGenLib.fcc"',
      'import Graph as Alias from "../Contracts/Graph.fcg"',
    ].join("\n")));
    expect(collectImports(document.items)).toEqual([
      { kind: ImportKind.Library, raw: "StdLibrary.fcc", alias: "StdLibrary" },
      { kind: ImportKind.Script, raw: "Res", from: "EditorGenLib.fcc" },
      { kind: ImportKind.Script, raw: "Graph", alias: "Alias", from: "../Contracts/Graph.fcg" },
    ]);
  });

  it("sorts buckets and renders grammar-correct aliases", () => {
    expect(renderImports([
      { kind: ImportKind.Script, raw: "Local", from: "./Local.fcg" },
      { kind: ImportKind.Library, raw: "StdLibrary.fcc", alias: "StdLibrary" },
      { kind: ImportKind.Script, raw: "Contract", from: "../Contracts/Contract.fcg" },
      { kind: ImportKind.Library, raw: "EditorGenLib.fcc", alias: "EditorGenLib" },
    ])).toBe([
      'import "StdLibrary.fcc" as StdLibrary',
      'import "EditorGenLib.fcc" as EditorGenLib',
      "",
      'import Contract from "../Contracts/Contract.fcg"',
      "",
      'import Local from "./Local.fcg"',
    ].join("\n"));
  });

  it("rejects a library import without its required alias", () => {
    const document = itemize(tokenize('import "Math.fcc"'));
    expect(() => collectImports(document.items)).toThrow(/requires a single alias/iu);
  });
});
