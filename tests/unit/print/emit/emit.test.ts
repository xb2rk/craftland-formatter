/**
 * @module print/emit/emit.test - verifies the FC emitter.
 *
 * Covers declaration/block/call/positional literal formatting, long-call wrapping,
 * generic angle tightness, operator spacing, comment attachment, tab indentation,
 * flat delimiter spacing, multiline headers, comparison vs generic disambiguation,
 * and prefix-operator clinging.
 */

import { describe, expect, it } from "vitest";
import { classify } from "../../../../src/syntax/classifier.js";
import { resolveConfig, type Config } from "../../../../src/format/config.js";
import { emit } from "../../../../src/print/emit/index.js";
import { itemize } from "../../../../src/lex/items.js";
import { printDoc } from "../../../../src/print/doc.js";
import { tokenize } from "../../../../src/lex/tokenizer.js";

/**
 * Render source via classify→emit→printDoc (test helper).
 *
 * @param source - FC source.
 * @param overrides - partial config.
 * @returns formatted source.
 */
function render(source: string, overrides: Partial<Config> = {}): string {
  const config = resolveConfig(overrides);
  return printDoc(emit(classify(itemize(tokenize(source))), config), config);
}

describe("FC emitter", () => {
  it("formats a declaration, block, call, and positional literal", () => {
    expect(render("func F() int { return Track(Vector3{1,2,3}) }")).toBe(
      "func F() int {\n  return Track(Vector3{1, 2, 3})\n}",
    );
  });

  it("wraps a long call at comma boundaries", () => {
    expect(render("func F() int { return Call(first,second,third) }", { printWidth: 24 })).toBe(
      "func F() int {\n  return Call(\n    first,\n    second,\n    third)\n}",
    );
  });

  it("keeps generic angles tight and binary operators spaced", () => {
    expect(render("func F() List<List<object>> { return a+b }")).toBe(
      "func F() List<List<object>> {\n  return a + b\n}",
    );
  });

  it("keeps line comments attached to their source line", () => {
    expect(render("func F() int { return x // note\n }")).toBe(
      "func F() int {\n  return x // note\n}",
    );
  });

  it("supports tab indentation without changing token spacing", () => {
    expect(render("func F() int { return x }", { useTabs: true })).toBe("func F() int {\n\treturn x\n}");
  });

  it("honors configurable flat delimiter and operator spacing", () => {
    expect(render("func F() int { return Call(a,b) + -4 }", {
      spaceInsideParens: true,
      spaceAroundOperators: false,
      spaceAfterComma: false,
    })).toContain("Call( a,b )+-4");
    expect(render("func F() int { return Vector3{1,2,3} }", {
      spaceInsideBraces: true,
    })).toContain("Vector3{ 1, 2, 3 }");
  });

  it("keeps multiline function headers classified as blocks", () => {
    const source = "func F(\n  out var value int,\n) int { return value }";
    const formatted = render(source);
    expect(formatted).toContain(") int {\n");
    expect(render(formatted)).toBe(formatted);
  });

  it("does not let a comparison open a generic context", () => {
    const formatted = render("func F() int { if CurrentIndex < 0 { return 0 } return 1 }");
    expect(formatted).toContain("CurrentIndex < 0 {");
    expect(render(formatted)).toBe(formatted);
  });

  it("keeps calls in control headers flat and clings prefix operators", () => {
    const formatted = render("func F() int { if !LongCall(first, second, third) { return -4 } return 0 }", { printWidth: 24 });
    expect(formatted).toContain("if !LongCall(first, second, third) {");
    expect(formatted).not.toContain("LongCall(\n");
    expect(formatted).toContain("return -4");
    expect(formatted).not.toContain("- 4");
  });

  it("keeps leading comments inside composites stable", () => {
    const source = "tuple T { Values List<float> = {\n  // values\n  1.0,\n} }";
    const formatted = render(source);
    expect(formatted).toContain("{\n");
    expect(render(formatted)).toBe(formatted);
  });

  it("keeps assignment calls breakAll and idempotent for List<int>=", () => {
    const src = "func F() { var kept List<int>= List.New(0, 0) as List<int> }";
    const once = render(src);
    expect(once).toContain("List<int> = List.New");
    expect(once).not.toContain("List<int>=");
    expect(once).not.toContain("List<int >");
    expect(render(once)).toBe(once);
  });

  it("wraps header conditions after-style with indent", () => {
    const src = "func F() int { if a || b || c { return 0 } return 1 }";
    const formatted = render(src, { printWidth: 12 });
    expect(formatted).toContain("a ||");
    expect(formatted).not.toContain("\n||");
    // after-style: `||` at end of line, continuation indented when broken
    expect(formatted).toMatch(/\|\|\n\s+/);
    const twice = render(formatted, { printWidth: 12 });
    expect(render(twice, { printWidth: 12 })).toBe(twice);
    // flat when fits
    const flat = render(src, { printWidth: 100 });
    expect(flat).toContain("a || b || c {");
    expect(render(flat, { printWidth: 100 })).toBe(flat);
  });

  it("distinguishes Map<string> generic from int < nowTick comparison", () => {
    expect(render("func F() int { return request[_FIELD] as int<nowTick }")).toContain("int < nowTick");
    expect(render("func F() { var x Map<string, object> = Map<string, object>{} }")).toContain("Map<string, object>");
    expect(render("func F() { var x Map<string, Map<string, object>> = Map<string, Map<string, object>>{} }")).toContain("Map<string, Map<string, object>>");
  });

  it("keeps entity generic tight and spaced correctly", () => {
    expect(render("func F() { spawned < PlantEntityScript >.Set(a) }")).toContain("spawned<PlantEntityScript>.Set");
    expect(render("func F() { thisEntity < UIPlantInfo >.Set(true) }")).toContain("thisEntity<UIPlantInfo>.Set");
  });

  it("does not treat header comparison < and >= as generic angle", () => {
    const src = "func F() int { if _ReadCount < StorageConfig.GetReadBudget() && nowTick >= _ReadBlockedUntilTick { return 0 } return 1 }";
    const formatted = render(src, { printWidth: 60 });
    // comparison spaced, not tight generic
    expect(formatted).toContain("_ReadCount < StorageConfig.GetReadBudget()");
    expect(formatted).not.toContain("_ReadCount<StorageConfig");
    // >= stays together, not split to `> =`
    expect(formatted).toContain("nowTick >= _ReadBlockedUntilTick");
    expect(formatted).not.toContain("nowTick> =");
    expect(formatted).not.toContain("nowTick > =");
    expect(render(formatted, { printWidth: 60 })).toBe(formatted);
  });

  it("keeps flat CALL without trailing comma and broken bare CALL with trailing comma", () => {
    const flat = render("[platform_server]\ngraph G { StorageService.WriteValue(playerUID, DataTableName.Player, PlayerData_Key.Profile, profile) }");
    expect(flat).toContain("WriteValue(playerUID, DataTableName.Player, PlayerData_Key.Profile, profile)");
    expect(flat).not.toContain("profile,)");
    expect(flat).not.toContain("profile, )");
    // flat with original trailing comma should still be flat without trailing
    const flatWithComma = render("[platform_server]\ngraph G { StorageService.PromoteLoadedValue(playerUID, DataTableName.Player, PlayerData_Key.Profile, profile,) }", { printWidth: 120 });
    expect(flatWithComma).toContain("PromoteLoadedValue(playerUID, DataTableName.Player, PlayerData_Key.Profile, profile)");
    expect(flatWithComma).not.toContain("profile,)");
    // bare CALL broken (printWidth small) has trailing comma and ) on new line
    const brokenBare = render("[platform_server]\ngraph G { StorageService.PromoteLoadedValue(playerUID, DataTableName.Player, PlayerData_Key.Profile, profile) }", { printWidth: 60 });
    expect(brokenBare).toContain("profile,");
    expect(brokenBare).toMatch(/profile,\n\s*\)/);
    expect(render(brokenBare)).toBe(brokenBare);
  });

  it("keeps assignment CALL broken without trailing comma and ) on same line as last arg", () => {
    const src = "[platform_server]\ngraph G { var profile PlayerMainData = StorageSchemaPlayer.PrepareProfileRecord(rawProfile, out var changed, out var preparedResultCode) }";
    const formatted = render(src, { printWidth: 60 });
    expect(formatted).toContain("PrepareProfileRecord(");
    expect(formatted).not.toContain("preparedResultCode,");
    expect(formatted).toMatch(/preparedResultCode\)/);
    expect(formatted).not.toMatch(/preparedResultCode,\n\s*\)/);
    expect(render(formatted, { printWidth: 60 })).toBe(formatted);
  });

  it("keeps wait bare CALL with preceding var assignments as bare (comma + ) newline, not assignment)", () => {
    const src = "[platform_server]\ngraph G { var keyName string = payload[1] as string\n  var uploadValue object = payload[2]\n  wait WriteToDataStoreV2(tableName, StorageScheduler.GetPlayerUID(request), keyName, uploadValue, StorageConfig.GetMapCode(), out var statusCode) }";
    const formatted = render(src, { printWidth: 100 });
    // bare wait: when broken (6 args >100, so broken), trailing comma and ) on new line
    expect(formatted).toContain("out var statusCode,");
    expect(formatted).toMatch(/out var statusCode,\n\s*\)/);
    expect(formatted).not.toMatch(/out var statusCode\)\n/);
    expect(render(formatted, { printWidth: 100 })).toBe(formatted);
    // same wait flat when fits (printWidth 200) has no trailing
    const flat = render(src, { printWidth: 200 });
    expect(flat).toContain("WriteToDataStoreV2(tableName, StorageScheduler.GetPlayerUID(request), keyName, uploadValue, StorageConfig.GetMapCode(), out var statusCode)");
    expect(flat).not.toContain("statusCode,)");
  });

  it("keeps LocString composite literals always flat", () => {
    const src = `graph G { _NameText = LocString{"[b][{0}]{1}[-][-]", {DataHelper.GetRarityTextHex(ZombieData.GetZombieRarity(_ZombieID)), zombieNameStr}} }`;
    const narrow = render(src, { printWidth: 20, wrapCollections: "always" });
    expect(narrow).not.toMatch(/LocString\{\n/);
    expect(narrow).not.toMatch(/\{\n\s*DataHelper/);
    expect(narrow).toContain(`LocString{"[b][{0}]{1}[-][-]", {DataHelper.GetRarityTextHex(ZombieData.GetZombieRarity(_ZombieID)), zombieNameStr}}`);
    expect(render(narrow, { printWidth: 20, wrapCollections: "always" })).toBe(narrow);
    const src2 = `graph G { _ElementText = LocString{"[b][{0}]{1}[-][-]", {DataHelper.GetElementTextHex(_Element), elementStr}} }`;
    const narrow2 = render(src2, { printWidth: 20, wrapCollections: "always" });
    expect(narrow2).not.toMatch(/LocString\{\n/);
    expect(render(narrow2, { printWidth: 20, wrapCollections: "always" })).toBe(narrow2);
  });
});
