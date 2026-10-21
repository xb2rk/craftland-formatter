import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalWorkspacePath,
  createWorkspaceIndex,
  lintSource,
  lintWorkspace,
  updateWorkspaceIndex,
  type LintDiagnostic,
  type WorkspaceSource,
} from "../src/index.js";
import { getPackageRoot } from "./helpers/workspace.js";

const ROOT = resolve(getPackageRoot(), ".tmp", "workspace-parity-fixture");

function source(path: string, text: string): WorkspaceSource { return { path, source: text }; }

const RULES = {
  "fc/no-unused-import": "off" as const,
  "fc/no-platform-import-isolation": "off" as const,
};

interface HostDiagnostic extends LintDiagnostic {
  readonly file: string;
}

function compareDiagnostics(diagnostics: readonly HostDiagnostic[]): readonly unknown[] {
  return diagnostics.map((diagnostic) => ({
    file: diagnostic.file,
    ruleId: diagnostic.ruleId,
    severity: diagnostic.severity,
    message: diagnostic.message,
    start: diagnostic.range.start.offset,
    end: diagnostic.range.end.offset,
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
}

function runSnapshot(sources: readonly WorkspaceSource[]): readonly HostDiagnostic[] {
  const index = createWorkspaceIndex(sources, { root: ROOT });
  const documentDiagnostics: HostDiagnostic[] = [];
  for (const current of sources) {
    const result = lintSource(current.source, {
      fileName: current.path,
      rules: RULES,
    });
    const file = canonicalWorkspacePath(ROOT, current.path);
    for (const diagnostic of result.diagnostics) documentDiagnostics.push({ ...diagnostic, file });
  }
  return [...documentDiagnostics, ...lintWorkspace(index, { rules: RULES }).diagnostics];
}

function materializeOverlay(
  diskSources: readonly WorkspaceSource[],
  overlays: readonly WorkspaceSource[],
): WorkspaceSource[] {
  const byPath = new Map(diskSources.map((current) => [canonicalWorkspacePath(ROOT, current.path), current]));
  for (const current of overlays) byPath.set(canonicalWorkspacePath(ROOT, current.path), current);
  return [...byPath.values()];
}

describe("workspace host parity", () => {
  it("gives CLI and editor snapshots identical diagnostics with dirty-buffer overlays", () => {
    const diskSources = [
      source("Use.fcg", 'import Item from "./Types.fcc"\ngraph Use {}'),
      source("Types.fcc", "tuple Item {}"),
    ];
    const editorOverlay = [source("Types.fcc", "tuple Other {}")];

    const cli = runSnapshot(diskSources);
    const editor = runSnapshot(materializeOverlay(diskSources, []));
    expect(compareDiagnostics(cli)).toEqual(compareDiagnostics(editor));

    const dirtyEditor = runSnapshot(materializeOverlay(diskSources, editorOverlay));
    expect(compareDiagnostics(dirtyEditor)).toEqual(compareDiagnostics(runSnapshot([
      diskSources[0]!,
      editorOverlay[0]!,
    ])));
    expect(dirtyEditor.some((diagnostic) => diagnostic.ruleId === "fc/no-unresolved-imported-symbol")).toBe(true);
  });

  it("keeps incremental target invalidation equivalent to a fresh rebuild", () => {
    const initial = [
      source("Use.fcg", 'import Item from "./Types.fcc"\ngraph Use {}'),
      source("Types.fcc", "tuple Item {}"),
    ];
    let index = createWorkspaceIndex(initial, { root: ROOT });
    index = updateWorkspaceIndex(index, [source("Types.fcc", "tuple Other {}")]);
    const incremental = lintWorkspace(index, { rules: RULES }).diagnostics;
    const rebuilt = lintWorkspace(createWorkspaceIndex([
      initial[0]!,
      source("Types.fcc", "tuple Other {}"),
    ], { root: ROOT }), { rules: RULES }).diagnostics;
    expect(compareDiagnostics(incremental)).toEqual(compareDiagnostics(rebuilt));

    index = updateWorkspaceIndex(index, [{ path: "Types.fcc" }]);
    expect(lintWorkspace(index, { rules: RULES }).diagnostics.map((diagnostic) => diagnostic.ruleId)).toEqual([
      "fc/no-unresolved-project-import",
    ]);
  });
});
