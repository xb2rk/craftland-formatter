import { describe, expect, it } from "vitest";
import { lex } from "../../src/lex/index.js";
import { parseGraphFile } from "../../src/parser/index.js";

/**
 * Graph-body decorator placement (oracle-adjudicated): the reference
 * compiler accepts decorators on fields but rejects them on event
 * listeners and functions at syntax level (`extraneous input 'event'` /
 * `'func'`), so the parser reports `unexpected-decorator` while still
 * parsing the member for recovery.
 */
function body(source: string): string {
  return `graph Probe {\n${source}\n}\n`;
}

describe("graph-body member decorators", () => {
  it("rejects decorators on event listeners", () => {
    const result = parseGraphFile(lex(body("    [platform_client]\n    event A.B() {\n    }\n")));
    expect(result.consumedThroughEof).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("unexpected-decorator");
    expect(result.diagnostics[0]?.message).toContain("event listeners");
    expect(result.node?.graph?.members).toHaveLength(1);
    expect(result.node?.graph?.members?.[0]?.kind).toBe("event-declaration");
  });

  it("rejects decorators on functions", () => {
    const result = parseGraphFile(lex(body("    [platform_client]\n    func Helper() int {\n        return 1\n    }\n")));
    expect(result.consumedThroughEof).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("unexpected-decorator");
    expect(result.diagnostics[0]?.message).toContain("functions");
    expect(result.node?.graph?.members).toHaveLength(1);
    expect(result.node?.graph?.members?.[0]?.kind).toBe("function-declaration");
  });

  it("keeps decorators on fields clean", () => {
    const result = parseGraphFile(lex(body("    [custom]\n    speed float\n")));
    expect(result.consumedThroughEof).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.node?.graph?.members?.[0]?.kind).toBe("field-declaration");
  });

  it("keeps undecorated event listeners and functions clean", () => {
    const bare = parseGraphFile(lex(body("    event A.B() {\n    }\n    func Helper() int {\n        return 1\n    }\n")));
    expect(bare.consumedThroughEof).toBe(true);
    expect(bare.diagnostics).toHaveLength(0);
    expect(bare.node?.graph?.members).toHaveLength(2);
  });

  it("keeps file-level graph decorators clean", () => {
    const result = parseGraphFile(lex("[platform_client]\ngraph Probe {\n}\n"));
    expect(result.consumedThroughEof).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });
});
