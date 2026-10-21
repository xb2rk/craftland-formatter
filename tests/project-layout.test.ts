import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectCorpusFiles, getPackageRoot, getRepositoryRoot } from "./helpers/workspace.js";

describe("Phase 0 package boundary", () => {
  it("has an isolated npm package with a tracked lock-file exception", () => {
    const packageRoot = getPackageRoot();
    const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      name: string;
      private: boolean;
    };
    const gitignore = readFileSync(join(packageRoot, ".gitignore"), "utf8");

    expect(packageJson).toMatchObject({ name: "fc-format", private: true });
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain("dist/");
    expect(gitignore).toContain("!package-lock.json");
    expect(existsSync(join(packageRoot, "package-lock.json"))).toBe(true);
  });

  it("locates the formatter contract and the real FC corpus without modifying either", () => {
    const packageRoot = getPackageRoot();
    const repositoryRoot = getRepositoryRoot();
    const corpus = collectCorpusFiles();

    expect(existsSync(join(packageRoot, "docs", "GRAMMAR.md"))).toBe(true);
    expect(existsSync(join(repositoryRoot, "Assets", "Scripts"))).toBe(true);
    expect(corpus.length).toBeGreaterThan(0);
    expect(corpus.every((path) => path.endsWith(".fcc") || path.endsWith(".fcg"))).toBe(true);
  });
});
