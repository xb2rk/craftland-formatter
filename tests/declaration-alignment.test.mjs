import test from "node:test";
import assert from "node:assert/strict";

import { formatSource } from "../src/printer.mjs";

test("enum alignment aligns equals signs in .fcc", () => {
  const input = `enum ResultCode {
  SUCCESS = 0
  UnknownError = -1
  EntityNotFound = 101
  InsufficientBalance = 401
}`;
  const result = formatSource(input, "fcc", { alignment: { enums: true } });
  assert.ok(result.output);
  assert.equal(
    result.output,
    `enum ResultCode {
  SUCCESS             = 0
  UnknownError        = -1
  EntityNotFound      = 101
  InsufficientBalance = 401
}\n`
  );

  // Idempotent
  const second = formatSource(result.output, "fcc", { alignment: { enums: true } });
  assert.equal(second.output, result.output);
});

test("enum alignment preserves leading comments and splits on blank lines", () => {
  const input = `enum Status {
  // comment a
  A = 0
  // comment b
  BCD = 1

  VeryLongNameHere = 100
  Short = 2
}`;
  const result = formatSource(input, "fcc", { alignment: { enums: true } });
  assert.ok(result.output);
  assert.equal(
    result.output,
    `enum Status {
  // comment a
  A   = 0
  // comment b
  BCD = 1

  VeryLongNameHere = 100
  Short            = 2
}\n`
  );
});

test("tuple alignment aligns names, types, and values in .fcc", () => {
  const input = `tuple InventorySlot {
  SlotIndex int = 0
  ItemId string = ""
  Quantity int = 0
  Rarity int = 0
}`;
  const result = formatSource(input, "fcc", { alignment: { fields: true } });
  assert.ok(result.output);
  assert.equal(
    result.output,
    `tuple InventorySlot {
  SlotIndex int    = 0
  ItemId    string = ""
  Quantity  int    = 0
  Rarity    int    = 0
}\n`
  );

  // Idempotent
  const second = formatSource(result.output, "fcc", { alignment: { fields: true } });
  assert.equal(second.output, result.output);
});

test("tuple alignment handles fields without default values", () => {
  const input = `tuple Stats {
  HP int
  MaxHP int
  AttackPower float
  Speed float = 5.0
}`;
  const result = formatSource(input, "fcc", { alignment: { fields: true } });
  assert.ok(result.output);
  assert.equal(
    result.output,
    `tuple Stats {
  HP          int
  MaxHP       int
  AttackPower float
  Speed       float = 5.0
}\n`
  );
});

test("graph field alignment aligns names, types, and equals in .fcg", () => {
  const input = `import "StdLibrary.fcc" as StdLibrary

graph Demo {
  _COUNT int = 0
  _PLAYER_NAME string = "Hero"
  _ACTIVE bool = true
}`;
  const result = formatSource(input, "fcg", { alignment: { fields: true } });
  assert.ok(result.output);
  assert.equal(
    result.output,
    `import "StdLibrary.fcc" as StdLibrary

graph Demo {
  _COUNT       int    = 0
  _PLAYER_NAME string = "Hero"
  _ACTIVE      bool   = true
}\n`
  );
});

test("canonical headers strips outer parens when requested and preserves by default", () => {
  const input = `import "StdLibrary.fcc" as StdLibrary

graph Demo {
  func Run() {
    if (count > 0) {
      return
    }
  }
}`;
  // Default is preserve
  const preserved = formatSource(input, "fcg");
  assert.ok(preserved.output?.includes("if (count > 0) {"));

  // Canonical removes parens
  const canonical = formatSource(input, "fcg", { syntax: { canonicalHeaders: "canonical" } });
  assert.ok(canonical.output?.includes("if count > 0 {"));

  // Idempotent
  const second = formatSource(canonical.output, "fcg", { syntax: { canonicalHeaders: "canonical" } });
  assert.equal(second.output, canonical.output);
});

test("blankLines.betweenFunctions enforces empty line between functions when set to always", () => {
  const input = `import "StdLibrary.fcc" as StdLibrary

graph Demo {
  func A() {}
  func B() {}
}`;
  const result = formatSource(input, "fcg", { blankLines: { betweenFunctions: "always" } });
  assert.ok(result.output);
  assert.equal(
    result.output,
    `import "StdLibrary.fcc" as StdLibrary

graph Demo {
  func A() {}

  func B() {}
}\n`
  );
});
