import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultCompilerPath, defaultProjectRoot } from "../src/oracle/runner.js";
import { getRepositoryRoot } from "./helpers/workspace.js";

describe("compiler oracle boundary", () => {
  it("resolves this repository and the configured compiler without staging source", () => {
    expect(defaultProjectRoot()).toBe(getRepositoryRoot());
    expect(existsSync(join(defaultProjectRoot(), "Assets"))).toBe(true);
    expect(defaultCompilerPath().toLowerCase()).toMatch(/fccompile_external\.exe$/);
  });
});
