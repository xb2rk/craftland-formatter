import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceIndex, lintWorkspace, updateWorkspaceIndex, type WorkspaceSource } from "../src/index.js";
import { getPackageRoot } from "./helpers/workspace.js";

const ROOT = resolve(getPackageRoot(), ".tmp", "workspace-linter-fixture");

function source(path: string, text: string): WorkspaceSource { return { path, source: text }; }

function ruleIds(index: ReturnType<typeof createWorkspaceIndex>, rules: NonNullable<Parameters<typeof lintWorkspace>[1]>["rules"] = {}) {
  return lintWorkspace(index, { rules }).diagnostics;
}

describe("workspace lint rules", () => {
  it("reports unresolved relative project imports but keeps opaque libraries out of the rule", () => {
    const index = createWorkspaceIndex([source("Main.fcg", [
      'import "./Missing.fcg" as Missing',
      'import "Map.fcc" as Map',
      'import "EditorGenLib.fcc" as Res',
      "graph Main {}",
    ].join("\n"))], { root: ROOT });
    const diagnostics = ruleIds(index, { "fc/no-unused-import": "off" });
    expect(diagnostics.map((diagnostic) => diagnostic.ruleId)).toEqual(["fc/no-unresolved-project-import"]);
    expect(diagnostics[0]?.file).toBe(resolve(ROOT, "Main.fcg").toLowerCase().replaceAll("\\", "/"));
  });

  it("enforces only explicit graph platform isolation and allows contracts", () => {
    const index = createWorkspaceIndex([
      source("Server.fcg", [
        'import "./Client.fcg" as Client',
        'import "./Shared.fcc" as Shared',
        "[platform_server]",
        "graph Server {}",
      ].join("\n")),
      source("Client.fcg", "[platform_client]\ngraph Client {}"),
      source("Shared.fcc", "tuple Shared {}"),
      source("OtherServer.fcg", "[platform_server]\ngraph OtherServer {}"),
    ], { root: ROOT });
    const diagnostics = ruleIds(index, { "fc/no-unused-import": "off", "fc/no-unresolved-project-import": "off" });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "fc/no-platform-import-isolation",
      message: expect.stringContaining("client graph"),
    });
  });

  it("reports an unused namespace import while recognizing member use", () => {
    const index = createWorkspaceIndex([
      source("Used.fcg", [
        'import "./Worker.fcg" as Worker',
        'import "./Other.fcg" as Other',
        "graph Used { func Run() { Worker.Run() } }",
      ].join("\n")),
      source("Worker.fcg", "graph Worker { func Run() {} }"),
      source("Other.fcg", "graph Other {}"),
    ], { root: ROOT });
    const diagnostics = ruleIds(index, {
      "fc/no-unresolved-project-import": "off",
      "fc/no-platform-import-isolation": "off",
    });
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["Imported name 'Other' is never used."]);
  });

  it("resolves unqualified enum, tuple, type, and function names through a namespace import", () => {
    const index = createWorkspaceIndex([
      source("Use.fcg", [
        'import "./Contracts.fcc" as Contracts',
        'import "./Worker.fcg" as Worker',
        "graph Use {",
        "  func Run() {",
        "    var code ResultCode",
        "    var record HitRecord",
        "    var value SharedValue",
        "    code = ResultCode.Success",
        "    record = MakeRecord()",
        "    DoWork()",
        "    use(value)",
        "  }",
        "}",
      ].join("\n")),
      source("Contracts.fcc", [
        "enum ResultCode { Success }",
        "tuple HitRecord {}",
        "define SharedValue: int",
        "func MakeRecord() HitRecord",
      ].join("\n")),
      source("Worker.fcg", "graph Worker { func DoWork() {} }"),
    ], { root: ROOT });
    const diagnostics = ruleIds(index, {
      "fc/no-unresolved-project-import": "off",
      "fc/no-platform-import-isolation": "off",
    });
    expect(diagnostics).toEqual([]);
  });

  it("reports an unused namespace import when its complete target has no referenced declarations", () => {
    const index = createWorkspaceIndex([
      source("Use.fcg", [
        'import "./Contracts.fcc" as Contracts',
        "graph Use {}",
      ].join("\n")),
      source("Contracts.fcc", [
        "enum ResultCode { Success }",
        "tuple HitRecord {}",
        "define SharedValue: int",
        "func MakeRecord() HitRecord",
      ].join("\n")),
    ], { root: ROOT });
    const diagnostics = ruleIds(index, {
      "fc/no-unresolved-project-import": "off",
      "fc/no-platform-import-isolation": "off",
    });
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["Imported name 'Contracts' is never used."]);
  });

  it("does not report namespace imports when an unqualified name is ambiguous", () => {
    const index = createWorkspaceIndex([
      source("Use.fcg", [
        'import "./First.fcc" as First',
        'import "./Second.fcc" as Second',
        "graph Use { func Run() { value = SharedValue } }",
      ].join("\n")),
      source("First.fcc", "define SharedValue: int"),
      source("Second.fcc", "define SharedValue: int"),
    ], { root: ROOT });
    const diagnostics = ruleIds(index, {
      "fc/no-unresolved-project-import": "off",
      "fc/no-platform-import-isolation": "off",
    });
    expect(diagnostics).toEqual([]);
  });

  it("keeps local declarations ahead of namespace-import candidates", () => {
    const index = createWorkspaceIndex([
      source("Use.fcg", [
        'import "./Contracts.fcc" as Contracts',
        "graph Use { func Run() { var ResultCode int = 0\n use(ResultCode) } }",
      ].join("\n")),
      source("Contracts.fcc", "enum ResultCode { Success }"),
    ], { root: ROOT });
    const diagnostics = ruleIds(index, {
      "fc/no-unresolved-project-import": "off",
      "fc/no-platform-import-isolation": "off",
    });
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["Imported name 'Contracts' is never used."]);
  });

  it("reports an unused named project import", () => {
    const index = createWorkspaceIndex([
      source("Use.fcg", 'import Item from "./Types.fcc"\ngraph Use {}'),
      source("Types.fcc", "tuple Item {}"),
    ], { root: ROOT });
    const diagnostics = ruleIds(index, {
      "fc/no-unresolved-project-import": "off",
      "fc/no-platform-import-isolation": "off",
    });
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["Imported name 'Item' is never used."]);
  });

  it("reports a named project import whose declaration is absent", () => {
    const useSource = 'import Missing from "./Types.fcc"\ngraph Use {}';
    const index = createWorkspaceIndex([
      source("Use.fcg", useSource),
      source("Types.fcc", "tuple Item {}"),
    ], { root: ROOT });
    const diagnostics = ruleIds(index, {
      "fc/no-unused-import": "off",
      "fc/no-unresolved-project-import": "off",
      "fc/no-platform-import-isolation": "off",
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "fc/no-unresolved-imported-symbol",
      message: "Imported name 'Missing' is not declared by project target \"types.fcc\".",
      severity: "warning",
    });
    expect(diagnostics[0]?.range.start.offset).toBe(useSource.indexOf("Missing"));
    expect(diagnostics[0]?.range.end.offset).toBe(useSource.indexOf("Missing") + "Missing".length);
  });

  it("accepts named imports across declaration kinds and aliases", () => {
    const index = createWorkspaceIndex([
      source("Use.fcg", [
        'import ResultCode as Code from "./Contracts.fcc"',
        'import WorkerRun as Run from "./Worker.fcc"',
        "graph Use {",
        "  func Main() {",
        "    var code Code",
        "    code = Code.Success",
        "    Run()",
        "  }",
        "}",
      ].join("\n")),
      source("Contracts.fcc", "enum ResultCode { Success }"),
      source("Worker.fcc", "func WorkerRun()"),
    ], { root: ROOT });
    const diagnostics = ruleIds(index, {
      "fc/no-unresolved-project-import": "off",
      "fc/no-platform-import-isolation": "off",
    });
    expect(diagnostics).toEqual([]);
  });

  it("does not guess a missing named symbol from an incomplete target", () => {
    const index = createWorkspaceIndex([
      source("Use.fcg", 'import Missing from "./Broken.fcc"\ngraph Use {}'),
      source("Broken.fcc", "tuple Broken {"),
    ], { root: ROOT });
    const diagnostics = ruleIds(index, {
      "fc/no-unused-import": "off",
      "fc/no-unresolved-project-import": "off",
      "fc/no-platform-import-isolation": "off",
    });
    expect(diagnostics).toEqual([]);
  });

  it("honors suppression for missing named project declarations", () => {
    const useSource = [
      "// fc-lint-disable-next-line fc/no-unresolved-imported-symbol",
      'import Missing from "./Types.fcc"',
      "graph Use {}",
    ].join("\n");
    const index = createWorkspaceIndex([
      source("Use.fcg", useSource),
      source("Types.fcc", "tuple Item {}"),
    ], { root: ROOT });
    expect(ruleIds(index, {
      "fc/no-unused-import": "off",
      "fc/no-unresolved-project-import": "off",
      "fc/no-platform-import-isolation": "off",
    })).toEqual([]);
  });

  it("does not report opaque library imports whose members may be used unqualified", () => {
    const index = createWorkspaceIndex([source("UseConvert.fcg", [
      'import "Convert.fcc" as Convert',
      'import Res from "EditorGenLib.fcc"',
      "graph UseConvert { func Run() { ToString(42) } }",
    ].join("\n"))], { root: ROOT });
    const diagnostics = ruleIds(index, {
      "fc/no-unresolved-project-import": "off",
      "fc/no-platform-import-isolation": "off",
    });
    expect(diagnostics).toEqual([]);
  });

  it("counts imported aliases used in domain types", () => {
    const index = createWorkspaceIndex([
      source("Use.fcc", [
        'import Item from "./Types.fcc"',
        "define Value: Item",
      ].join("\n")),
      source("Types.fcc", "tuple Item {}"),
    ], { root: ROOT });
    const diagnostics = ruleIds(index, {
      "fc/no-unresolved-project-import": "off",
      "fc/no-platform-import-isolation": "off",
    });
    expect(diagnostics).toEqual([]);
  });

  it("honors suppression, severity, UTF-16 ranges, and deterministic ordering", () => {
    const index = createWorkspaceIndex([source("😀.fcc", [
      "// fc-lint-disable-next-line fc/no-unused-import",
      'import Missing from "./Nope.fcc"',
      'import Unused from "./Nope2.fcc"',
    ].join("\n"))], { root: ROOT });
    const options = {
      rules: {
        "fc/no-unused-import": "error" as const,
        "fc/no-unresolved-project-import": "off" as const,
        "fc/no-platform-import-isolation": "off" as const,
      },
    };
    const first = lintWorkspace(index, options).diagnostics;
    const second = lintWorkspace(index, options).diagnostics;
    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0]?.severity).toBe("error");
    expect(first[0]?.range.start.offset).toBe("// fc-lint-disable-next-line fc/no-unused-import\nimport Missing from \"./Nope.fcc\"\nimport ".length);
  });

  it("recomputes workspace diagnostics after an import target is added or a binding is used", () => {
    let index = createWorkspaceIndex([source("Main.fcg", 'import "./Missing.fcg" as Missing\ngraph Main {}')], { root: ROOT });
    expect(ruleIds(index, { "fc/no-unused-import": "off", "fc/no-platform-import-isolation": "off" })).toHaveLength(1);
    index = updateWorkspaceIndex(index, [source("Missing.fcg", "graph Missing {}")]);
    expect(ruleIds(index, { "fc/no-unused-import": "off", "fc/no-platform-import-isolation": "off" })).toEqual([]);
    index = updateWorkspaceIndex(index, [{ path: "Main.fcg", source: 'import "./Missing.fcg" as Missing\ngraph Main { func Run() { Missing } }' }]);
    expect(ruleIds(index, { "fc/no-unresolved-project-import": "off", "fc/no-platform-import-isolation": "off" })).toEqual([]);
  });

  it("re-evaluates namespace use when the target declaration surface changes", () => {
    let index = createWorkspaceIndex([
      source("Use.fcg", 'import "./Contracts.fcc" as Contracts\ngraph Use { func Run() { ResultCode } }'),
      source("Contracts.fcc", "enum OtherCode { Other }"),
    ], { root: ROOT });
    expect(ruleIds(index, {
      "fc/no-unresolved-project-import": "off",
      "fc/no-platform-import-isolation": "off",
    }).map((diagnostic) => diagnostic.message)).toEqual(["Imported name 'Contracts' is never used."]);
    index = updateWorkspaceIndex(index, [source("Contracts.fcc", "enum ResultCode { Success }")]);
    expect(ruleIds(index, {
      "fc/no-unresolved-project-import": "off",
      "fc/no-platform-import-isolation": "off",
    })).toEqual([]);
  });

  it("re-evaluates named-import validity for an unsaved target overlay and deletion", () => {
    let index = createWorkspaceIndex([
      source("Use.fcg", 'import Item from "./Types.fcc"\ngraph Use {}'),
      source("Types.fcc", "tuple Item {}"),
    ], { root: ROOT });
    const options = {
      "fc/no-unused-import": "off" as const,
      "fc/no-unresolved-project-import": "off" as const,
      "fc/no-platform-import-isolation": "off" as const,
    };
    expect(ruleIds(index, options)).toEqual([]);
    index = updateWorkspaceIndex(index, [source("Types.fcc", "tuple Other {}")]);
    expect(ruleIds(index, options).map((diagnostic) => diagnostic.ruleId)).toEqual([
      "fc/no-unresolved-imported-symbol",
    ]);
    index = updateWorkspaceIndex(index, [{ path: "Types.fcc" }]);
    expect(ruleIds(index, { "fc/no-unused-import": "off", "fc/no-platform-import-isolation": "off" })
      .map((diagnostic) => diagnostic.ruleId)).toEqual(["fc/no-unresolved-project-import"]);
  });
});
