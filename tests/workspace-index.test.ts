import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalWorkspacePath, createWorkspaceIndex, updateWorkspaceIndex } from "../src/index.js";
import { getPackageRoot } from "./helpers/workspace.js";

const ROOT = resolve(getPackageRoot(), ".tmp", "workspace-index-fixture");

function pathOf(relativePath: string): string {
  return canonicalWorkspacePath(ROOT, relativePath);
}

function source(path: string, text: string): { path: string; source: string } {
  return { path, source: text };
}

describe("Phase 7D.0 workspace index", () => {
  it("parses sources once and classifies project, generated, and opaque library imports", () => {
    const index = createWorkspaceIndex([
      source("src/Main.fcg", [
        'import "./lib/Worker.fcg" as Worker',
        'import "Map.fcc" as Map',
        'import "EditorGenLib.fcc" as Res',
        "graph Main {}",
      ].join("\n")),
      source("src/lib/Worker.fcg", "graph Worker {}"),
    ], { root: ROOT });

    const main = index.files.get(pathOf("src/Main.fcg"));
    expect(main?.parsed).toBe(true);
    expect(main?.relativePath).toBe("src/main.fcg");
    expect(main?.sourceHash).toHaveLength(64);
    expect(main?.declarations).toMatchObject([{ kind: "graph", name: "Main" }]);
    expect(main?.imports.map(({ specifier, classification, resolvedPath }) => ({
      specifier,
      classification,
      resolvedPath: resolvedPath ? pathOf("src/lib/Worker.fcg") : undefined,
    }))).toEqual([
      { specifier: "./lib/Worker.fcg", classification: "project", resolvedPath: pathOf("src/lib/Worker.fcg") },
      { specifier: "Map.fcc", classification: "external-library", resolvedPath: undefined },
      { specifier: "EditorGenLib.fcc", classification: "generated-library", resolvedPath: undefined },
    ]);
    expect(index.dependents.get(pathOf("src/lib/Worker.fcg"))).toEqual([pathOf("src/Main.fcg")]);
  });

  it("detects deterministic dependency cycles without emitting diagnostics", () => {
    const sources = [
      source("a.fcg", 'import "./b.fcg" as B\ngraph A {}'),
      source("b.fcg", 'import "./a.fcg" as A\ngraph B {}'),
    ];
    const first = createWorkspaceIndex(sources, { root: ROOT });
    const second = createWorkspaceIndex([...sources].reverse(), { root: ROOT });

    expect(first.cycles).toEqual([[pathOf("a.fcg"), pathOf("b.fcg")]]);
    expect(second.cycles).toEqual(first.cycles);
    expect([...second.files.keys()]).toEqual([...first.files.keys()]);
    expect([...second.dependencies.entries()]).toEqual([...first.dependencies.entries()]);
  });

  it("updates resolution and reverse edges after add, change, and delete", () => {
    const initial = createWorkspaceIndex([
      source("Main.fcg", 'import "./Missing.fcc" as Missing\ngraph Main {}'),
    ], { root: ROOT });
    const mainPath = pathOf("Main.fcg");
    const missingPath = pathOf("Missing.fcc");
    expect(initial.files.get(mainPath)?.imports[0]?.classification).toBe("unresolved-project");

    const added = updateWorkspaceIndex(initial, [source("Missing.fcc", "tuple Missing {}")]);
    expect(added.revision).toBe(1);
    expect(added.files.get(mainPath)?.imports[0]?.classification).toBe("project");
    expect(added.files.get(mainPath)?.imports[0]?.resolvedPath).toBe(missingPath);
    expect(added.dependents.get(missingPath)).toEqual([mainPath]);

    const changed = updateWorkspaceIndex(added, [source("Missing.fcc", "tuple Missing { value int }")]);
    expect(changed.files.get(missingPath)?.sourceHash).not.toBe(added.files.get(missingPath)?.sourceHash);
    expect(changed.files.get(mainPath)?.sourceHash).toBe(added.files.get(mainPath)?.sourceHash);

    const deleted = updateWorkspaceIndex(changed, [{ path: "Missing.fcc" }]);
    expect(deleted.files.has(missingPath)).toBe(false);
    expect(deleted.files.get(mainPath)?.imports[0]?.classification).toBe("unresolved-project");
    expect(deleted.dependents.has(missingPath)).toBe(false);
  });

  it("reuses the parsed syntax object when an update repeats identical content", () => {
    const input = source("Stable.fcg", "graph Stable {}");
    const initial = createWorkspaceIndex([input], { root: ROOT });
    const repeated = updateWorkspaceIndex(initial, [input]);
    expect(repeated.files.get(pathOf("Stable.fcg"))?.syntax)
      .toBe(initial.files.get(pathOf("Stable.fcg"))?.syntax);
    expect(repeated.revision).toBe(1);
  });

  it("keeps generated and outside-root boundaries opaque and blocks malformed sources", () => {
    const index = createWorkspaceIndex([
      source("src/Main.fcg", [
        'import "../../Outside.fcg" as Outside',
        'import "CustomGenerated.fcc" as Generated',
        "graph Main {}",
      ].join("\n")),
      source("Broken.fcg", "graph Broken {"),
    ], { root: ROOT, generatedLibraries: ["CustomGenerated.fcc"] });

    const main = index.files.get(pathOf("src/Main.fcg"));
    expect(main?.imports[0]).toMatchObject({ classification: "unresolved-project", candidates: [] });
    expect(main?.imports[1]).toMatchObject({ classification: "generated-library", resolvedPath: undefined });
    expect(index.files.get(pathOf("Broken.fcg"))).toMatchObject({ parsed: false, imports: [], declarations: [] });
  });

  it("rejects duplicate sources and paths outside the declared root", () => {
    expect(() => createWorkspaceIndex([
      source("same.fcg", "graph Same {}"),
      source("./same.fcg", "graph SameAgain {}"),
    ], { root: ROOT })).toThrow("Duplicate workspace source path");
    expect(() => createWorkspaceIndex([
      source("../outside.fcg", "graph Outside {}"),
    ], { root: ROOT })).toThrow("outside root");
  });
});
