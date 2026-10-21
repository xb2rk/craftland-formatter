/**
 * @module cli/cli.test - verifies the CLI adapter.
 *
 * Covers `--help`/`--version`, unknown option rejection, `fmt --stdout` (no write),
 * `fmt` in-place, `check` drift with `exitCode 1`, `lint --json` with `--config`
 * (warning vs error exit), and pseudo-FC round-trip idempotency.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../../../src/cli/cli.js";
import { formatSource } from "../../../src/format/format.js";

describe("CLI adapter", () => {
  let stdout = "";
  let stderr = "";
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = "";
    stderr = "";
    process.exitCode = 0;
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: any) => {
      stdout += String(chunk);
      return true;
    }) as any);
    errSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: any) => {
      stderr += String(chunk);
      return true;
    }) as any);
  });
  afterEach(() => {
    writeSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
  });

  it("prints help and version without touching filesystem", async () => {
    await main(["node", "cli.js", "--help"]);
    expect(stdout).toContain("Usage: fc-format-v2");
    stdout = "";
    await main(["node", "cli.js", "--version"]);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("rejects unknown option with exitCode 2", async () => {
    await expect(main(["node", "cli.js", "fmt", "--unknown"])).rejects.toThrow(/unknown option/);
  });

  it("fmt --stdout formats a file and does not write back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fcfmt-"));
    try {
      const file = join(dir, "a.fcc");
      const src = "func F() int{return 1}";
      await writeFile(file, src, "utf8");
      await main(["node", "cli.js", "fmt", "--stdout", file]);
      expect(stdout).toBe(formatSource(src, {}));
      expect(await readFile(file, "utf8")).toBe(src);
      expect(stderr).toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fmt without --stdout writes in place", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fcfmt-"));
    try {
      const file = join(dir, "b.fcc");
      const src = "func F() int{return 1}";
      await writeFile(file, src, "utf8");
      stdout = "";
      await main(["node", "cli.js", "fmt", file]);
      const after = await readFile(file, "utf8");
      expect(after).toBe(formatSource(src, {}));
      expect(after).not.toBe(src);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("check reports drift and sets exitCode 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fcfmt-"));
    try {
      const file = join(dir, "c.fcc");
      const src = "func F() int{return 1}";
      await writeFile(file, src, "utf8");
      await main(["node", "cli.js", "check", file]);
      expect(process.exitCode).toBe(1);
      expect(stderr).toContain("c.fcc");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lint --json collects diagnostics with --config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fcfmt-"));
    try {
      const cfg = join(dir, "cfg.json");
      const file = join(dir, "d.fcc");
      await writeFile(cfg, JSON.stringify({ printWidth: 1 }), "utf8");
      await writeFile(file, "x = 123456789\n", "utf8");
      stdout = "";
      await main(["node", "cli.js", "lint", "--json", "--config", cfg, file]);
      const parsed = JSON.parse(stdout);
      expect(parsed[0].diagnostics.some((d: any) => d.ruleId === "line-too-long")).toBe(true);
      // lint with error sets exitCode 1 only when severity error exists (e.g., import-library-alias)
      // This case is warning, so exitCode stays 0
      expect(process.exitCode).toBe(0);
      // Now trigger an error rule
      await writeFile(file, 'import "StdLibrary.fcc"\n', "utf8");
      stdout = "";
      await main(["node", "cli.js", "lint", "--json", file]);
      expect(process.exitCode).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("pseudo code fed via file round-trips through formatter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fcfmt-"));
    try {
      const file = join(dir, "e.fcc");
      // Pseudo FC from FC_LINTER_SPEC examples - valid-ish but formatter should still be idempotent
      const pseudo = '[platform_server]\ngraph G {\n  func F(a int) int { return a+1 }\n}\n';
      await writeFile(file, pseudo, "utf8");
      await main(["node", "cli.js", "fmt", "--stdout", file]);
      const formatted = stdout;
      expect(formatted).toContain("func F(a int) int");
      // Idempotent second pass
      const second = formatSource(formatted, {});
      expect(second).toBe(formatted);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
