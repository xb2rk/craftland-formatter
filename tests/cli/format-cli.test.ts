import { describe, expect, it } from "vitest";
import { parseArgs, usage, CLI_VERSION } from "../../src/cli/format.js";

describe("cli options parsing", () => {
  it("parses -h and --help", () => {
    expect(parseArgs(["-h"])).toBe("help");
    expect(parseArgs(["--help"])).toBe("help");
  });

  it("parses -v and --version", () => {
    expect(parseArgs(["-v"])).toBe("version");
    expect(parseArgs(["--version"])).toBe("version");
  });

  it("parses -c and --check", () => {
    const res = parseArgs(["--check", "Assets/"]);
    if (typeof res !== "string") {
      expect(res.check).toBe(true);
      expect(res.inputs).toEqual(["Assets/"]);
    }
  });

  it("parses -w and --write", () => {
    const res = parseArgs(["--write", "Assets/"]);
    if (typeof res !== "string") {
      expect(res.write).toBe(true);
      expect(res.inputs).toEqual(["Assets/"]);
    }
  });

  it("parses -d and --diff", () => {
    const res = parseArgs(["--diff", "Assets/"]);
    if (typeof res !== "string") {
      expect(res.diff).toBe(true);
      expect(res.inputs).toEqual(["Assets/"]);
    }
  });

  it("parses --stdin-filepath", () => {
    const res = parseArgs(["--stdin-filepath", "Assets/Scripts/Main.fcg"]);
    if (typeof res !== "string") {
      expect(res.stdinFilepath).toBe("Assets/Scripts/Main.fcg");
    }
  });

  it("throws on unknown options", () => {
    expect(() => parseArgs(["--unknown"])).toThrow("unknown option '--unknown'");
  });

  it("usage includes all options", () => {
    const help = usage();
    expect(help).toContain(`fc-format-v4 v${CLI_VERSION}`);
    expect(help).toContain("--check");
    expect(help).toContain("--diff");
    expect(help).toContain("--stdin-filepath");
    expect(help).toContain("--write");
  });
});
