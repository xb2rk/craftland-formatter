import { describe, expect, it } from "vitest";

import { TokenId } from "../../src/grammar/token-vocabulary.generated.js";
import { lex } from "../../src/lex/index.js";
import { deriveStatementBoundaries } from "../../src/parser/index.js";
import { EOS_CASES } from "../fixtures/eos-cases.js";

function virtualEosText(source: string): string[] {
  return deriveStatementBoundaries(lex(source).tokens)
    .filter((boundary) => boundary.kind === "virtual")
    .map((boundary) => source.slice(boundary.range.start.offset, boundary.range.end.offset));
}

describe("FC automatic-semicolon boundaries", () => {
  it("matches the audited EOS behavior for representative lexical contexts", () => {
    for (const testCase of EOS_CASES) {
      expect(virtualEosText(testCase.source), testCase.name).toEqual(testCase.expectedVirtualEosText);
    }
  });

  it("reports explicit semicolons independently from virtual EOS", () => {
    const source = "first;\nsecond";
    const boundaries = deriveStatementBoundaries(lex(source).tokens);

    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({
      kind: "explicit",
      range: { start: { offset: 5 }, end: { offset: 6 } },
    });
  });

  it("does not mistake an EOS-capable generic close for a shift token", () => {
    const generic = lex("List<int>\nnext").tokens;
    const shift = lex("left >>\nright").tokens;

    expect(generic.filter((token) => token.kind === TokenId.GREATER)).toHaveLength(1);
    expect(virtualEosText("List<int>\nnext")).toEqual(["\n"]);
    expect(virtualEosText("left >>\nright")).toEqual(["\n"]);
    expect(shift.filter((token) => token.kind === TokenId.GREATER)).toHaveLength(2);
  });
});
