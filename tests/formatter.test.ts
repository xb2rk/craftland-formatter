import { describe, expect, it } from "vitest";
import { formatSource } from "../src/format/formatter.js";

describe("FC formatter", () => {
  it("uses tight generic syntax and canonical block spacing", () => {
    const input = "graph Foo{func Bar(){var x int=List<int>{1,2}\nif !x{return}}}";
    const result = formatSource(input, { fileName: "Foo.fcg" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("List<int>{1, 2}");
    expect(result.code).toContain("if !x {");
    expect(result.code).toMatch(/\n$/u);
  });

  it("keeps separator spaces before parenthesized value groups", () => {
    const source = [
      "graph Foo {",
      "func Bar(hash int, playerUID UUID) {",
      "_BucketByPlayer[playerUID] = ((hash % 100) + 100) % 100",
      "var slot int = ((hash % _COHORT_COUNT) + _COHORT_COUNT) % _COHORT_COUNT",
      "_CohortByPlayer[playerUID] = (slot + 1)",
      "if !(slot == 0) { return }",
      "}",
      "}",
      "",
    ].join("\n");
    const result = formatSource(source, { fileName: "Foo.fcg" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("_BucketByPlayer[playerUID] = ((hash % 100) + 100) % 100");
    expect(result.code).toContain("var slot int = ((hash % _COHORT_COUNT) + _COHORT_COUNT) % _COHORT_COUNT");
    expect(result.code).toContain("_CohortByPlayer[playerUID] = (slot + 1)");
    expect(result.code).toContain("if !(slot == 0) {");
    expect(formatSource(result.code!, { fileName: "Foo.fcg" }).code).toBe(result.code);
  });

  it("keeps parenthesized for-loop headers and stabilizes them", () => {
    const source = [
      "graph Foo {",
      "func Run() {",
      "for (key, time in stamps) {",
      "_Cur = _Map[time]",
      "}",
      "for (i = 0, 3, 1) {",
      "break",
      "}",
      "}",
      "}",
      "",
    ].join("\n");
    const result = formatSource(source, { fileName: "Foo.fcg" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("for (key, time in stamps) {");
    expect(result.code).toContain("for (i = 0, 3, 1) {");
    expect(formatSource(result.code!, { fileName: "Foo.fcg" }).code).toBe(result.code);
  });

  it("uses AST-classified unary spacing at every expression boundary", () => {
    const source = [
      "graph UnarySpacing {",
      "func Compare(a int,b int,value int,aIsNeg bool,bIsNeg bool) int {",
      "var absVal int=-value",
      "var positive int=+value",
      "var inverted int=~value",
      "var negated int=-(a+b)",
      "var delta int=a - -b",
      "var sum int=a + +b",
      "var values Map<string,int> = Map<string,int>{\"negative\":-1}",
      "if aIsNeg&&!bIsNeg {return -1}",
      "Use(-value,+value,!aIsNeg,~value)",
      "return-_compareBlocks(a,b)",
      "}",
      "func _compareBlocks(a int,b int) int{return 0}",
      "}",
      "",
    ].join("\n");
    const result = formatSource(source, { fileName: "UnarySpacing.fcg" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe([
      "graph UnarySpacing {",
      "  func Compare(a int, b int, value int, aIsNeg bool, bIsNeg bool) int {",
      "    var absVal int = -value",
      "    var positive int = +value",
      "    var inverted int = ~value",
      "    var negated int = -(a + b)",
      "    var delta int = a - -b",
      "    var sum int = a + +b",
      "    var values Map<string, int> = Map<string, int>{\"negative\": -1}",
      "    if aIsNeg && !bIsNeg {",
      "      return -1",
      "    }",
      "    Use(-value, +value, !aIsNeg, ~value)",
      "    return -_compareBlocks(a, b)",
      "  }",
      "  func _compareBlocks(a int, b int) int {",
      "    return 0",
      "  }",
      "}",
      "",
    ].join("\n"));
    expect(formatSource(result.code!, { fileName: "UnarySpacing.fcg" }).code).toBe(result.code);
  });

  it("uses the same spacing contract for every operator and comma style option", () => {
    const source = [
      "graph StyleOptions {",
      "func Demo(a bool,b bool,value int) int {",
      "var neg int=-value",
      "if a&&!b {Use(-value,+value,!a)}",
      "return -value",
      "}",
      "}",
      "",
    ].join("\n");
    const cases = [
      {
        options: { spaceAroundOperators: true, spaceAfterComma: true },
        expected: [
          "graph StyleOptions {",
          "  func Demo(a bool, b bool, value int) int {",
          "    var neg int = -value",
          "    if a && !b {",
          "      Use(-value, +value, !a)",
          "    }",
          "    return -value",
          "  }",
          "}",
          "",
        ].join("\n"),
      },
      {
        options: { spaceAroundOperators: false, spaceAfterComma: true },
        expected: [
          "graph StyleOptions {",
          "  func Demo(a bool, b bool, value int) int {",
          "    var neg int=-value",
          "    if a&&!b {",
          "      Use(-value, +value, !a)",
          "    }",
          "    return -value",
          "  }",
          "}",
          "",
        ].join("\n"),
      },
      {
        options: { spaceAroundOperators: true, spaceAfterComma: false },
        expected: [
          "graph StyleOptions {",
          "  func Demo(a bool,b bool,value int) int {",
          "    var neg int = -value",
          "    if a && !b {",
          "      Use(-value,+value,!a)",
          "    }",
          "    return -value",
          "  }",
          "}",
          "",
        ].join("\n"),
      },
      {
        options: { spaceAroundOperators: false, spaceAfterComma: false },
        expected: [
          "graph StyleOptions {",
          "  func Demo(a bool,b bool,value int) int {",
          "    var neg int=-value",
          "    if a&&!b {",
          "      Use(-value,+value,!a)",
          "    }",
          "    return -value",
          "  }",
          "}",
          "",
        ].join("\n"),
      },
    ] as const;

    for (const testCase of cases) {
      const first = formatSource(source, { fileName: "StyleOptions.fcg", ...testCase.options });
      expect(first.diagnostics).toEqual([]);
      expect(first.code).toBe(testCase.expected);
      expect(formatSource(first.code!, { fileName: "StyleOptions.fcg", ...testCase.options }).code).toBe(first.code);
    }
  });

  it("measures flat calls with the same option-aware boundary rules it emits", () => {
    const source = "graph Width {func Demo(a bool,value int){Use(-value,+value,!a)}}";
    const spaced = formatSource(source, { fileName: "Width.fcg", printWidth: 25, spaceAroundOperators: true, spaceAfterComma: true });
    const tight = formatSource(source, { fileName: "Width.fcg", printWidth: 25, spaceAroundOperators: false, spaceAfterComma: false });
    expect(spaced.diagnostics).toEqual([]);
    expect(tight.diagnostics).toEqual([]);
    expect(spaced.code).toContain("Use(\n");
    expect(tight.code).toContain("Use(-value,+value,!a)");
    expect(formatSource(spaced.code!, { fileName: "Width.fcg", printWidth: 25, spaceAroundOperators: true, spaceAfterComma: true }).code).toBe(spaced.code);
    expect(formatSource(tight.code!, { fileName: "Width.fcg", printWidth: 25, spaceAroundOperators: false, spaceAfterComma: false }).code).toBe(tight.code);
  });

  it("uses flat-or-breakAll logical headers without splitting for-header commas", () => {
    const source = [
      "graph Conditions {",
      "func Demo(a bool,b bool,c bool,d bool) {",
      "if a && b && c && d {return}",
      "while a || b || c || d {return}",
      "for index,value in values {return}",
      "}",
      "}",
      "",
    ].join("\n");
    const expected = [
      "graph Conditions {",
      "  func Demo(a bool, b bool, c bool, d bool) {",
      "    if a &&",
      "      b &&",
      "      c &&",
      "      d {",
      "      return",
      "    }",
      "    while a ||",
      "      b ||",
      "      c ||",
      "      d {",
      "      return",
      "    }",
      "    for index, value in values {",
      "      return",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    const variants = [
      source,
      source.replace("if a && b && c && d {return}", "if a &&\nb && c && d {return}").replace("while a || b || c || d {return}", "while a ||\nb || c || d {return}"),
      source.replace("if a && b && c && d {return}", "if a\n&& b && c && d {return}").replace("while a || b || c || d {return}", "while a\n|| b || c || d {return}"),
    ];
    for (const variant of variants) {
      const result = formatSource(variant, { fileName: "Conditions.fcg", printWidth: 20 });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toBe(expected);
      expect(formatSource(result.code!, { fileName: "Conditions.fcg", printWidth: 20 }).code).toBe(result.code);
    }
  });

  it("keeps a fitting logical header flat regardless of source line breaks", () => {
    const source = "graph Conditions {func Demo(a bool,b bool,c bool){if a &&\nb && c{return}}}";
    const expected = [
      "graph Conditions {",
      "  func Demo(a bool, b bool, c bool) {",
      "    if a && b && c {",
      "      return",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = formatSource(source, { fileName: "Conditions.fcg", printWidth: 80 });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe(expected);
    expect(formatSource(result.code!, { fileName: "Conditions.fcg", printWidth: 80 }).code).toBe(result.code);
  });

  it("keeps parenthesized logical child groups independent from a broken header chain", () => {
    const source = [
      "graph Conditions {",
      "func Demo(a bool,b bool,c bool,d bool) {",
      "if (a || b) &&",
      "(c || d) {return}",
      "}",
      "}",
      "",
    ].join("\n");
    const expected = [
      "graph Conditions {",
      "  func Demo(a bool, b bool, c bool, d bool) {",
      "    if (a || b) &&",
      "      (c || d) {",
      "      return",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = formatSource(source, { fileName: "Conditions.fcg", printWidth: 20 });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe(expected);
    expect(formatSource(result.code!, { fileName: "Conditions.fcg", printWidth: 20 }).code).toBe(result.code);
  });

  it("breaks every direct mixed logical operand once a header overflows", () => {
    const source = "graph Conditions {func Demo(a bool,b bool,c bool,d bool,e bool){if a&&b||(c&&d)||e{return}}}";
    const expected = [
      "graph Conditions {",
      "  func Demo(a bool, b bool, c bool, d bool, e bool) {",
      "    if a &&",
      "      b ||",
      "      (c && d) ||",
      "      e {",
      "      return",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = formatSource(source, { fileName: "Conditions.fcg", printWidth: 20 });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe(expected);
    expect(formatSource(result.code!, { fileName: "Conditions.fcg", printWidth: 20 }).code).toBe(result.code);
  });

  it("keeps parsed shift pairs atomic and wraps a long predicate after each logical operator", () => {
    const source = [
      "graph Conditions {",
      "func Write(sourceList List<int>,rowWriter RowWriter) {",
      "var result int",
      "var digit int",
      "var shift int",
      "var current int",
      "result=result|(digit<<shift)",
      "var shifted int=current>>_DIGIT_BITS",
      "if sourceList == nil || List.Length(sourceList) > _MAX_FIELD_COUNT || !StoragePackUtilV4.TryWriteUnsignedBits(rowWriter.BitWriter,List.Length(sourceList),_GENERIC_COUNT_BITS){return}",
      "}",
      "}",
      "",
    ].join("\n");
    const expected = [
      "graph Conditions {",
      "  func Write(sourceList List<int>, rowWriter RowWriter) {",
      "    var result int",
      "    var digit int",
      "    var shift int",
      "    var current int",
      "    result = result | (digit << shift)",
      "    var shifted int = current >> _DIGIT_BITS",
      "    if sourceList == nil ||",
      "      List.Length(sourceList) > _MAX_FIELD_COUNT ||",
      "      !StoragePackUtilV4.TryWriteUnsignedBits(",
      "        rowWriter.BitWriter,",
      "        List.Length(sourceList),",
      "        _GENERIC_COUNT_BITS) {",
      "      return",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    const result = formatSource(source, { fileName: "Conditions.fcg", printWidth: 80 });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe(expected);
    expect(formatSource(result.code!, { fileName: "Conditions.fcg", printWidth: 80 }).code).toBe(result.code);
  });

  it("keeps else on the closing-brace line", () => {
    const input = "graph Foo {func Bar(){if true {return} else {return}}}";
    const result = formatSource(input, { fileName: "Foo.fcg" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("} else {");
  });

  it("uses parsed block, decorator, index, and else roles", () => {
    const source = "[platform_client]\ngraph Indexed {func Check(items List<int>){if items[0]>0{return}else if items[0]<0{return}else{return}}}";
    const result = formatSource(source, { fileName: "Indexed.fcg" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe([
      "[platform_client]",
      "graph Indexed {",
      "  func Check(items List<int>) {",
      "    if items[0] > 0 {",
      "      return",
      "    } else if items[0] < 0 {",
      "      return",
      "    } else {",
      "      return",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n"));
    expect(formatSource(result.code!, { fileName: "Indexed.fcg" }).code).toBe(result.code);
  });

  it("rejects standalone bracket list literals", () => {
    const result = formatSource("graph Foo {func Bar(){var values List<int> = [1]}}", { fileName: "Foo.fcg" });
    expect(result.code).toBeUndefined();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("expected-expression");
  });

  it("keeps LocString composites tight to their type name", () => {
    const input = "graph Foo {func Bar(){return LocString{\"KEY\", List<string>{\"value\"}}}}";
    const result = formatSource(input, { fileName: "Foo.fcg" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("LocString{\"KEY\", List<string>{\"value\"}}");
  });

  it("terminates postfix increment statements at virtual EOS", () => {
    const input = "graph Foo {func Bar(){x ++\nif true {return}}}";
    const result = formatSource(input, { fileName: "Foo.fcg" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("x ++\n    if true {");
  });

  it("preserves comments and literal bytes and is byte-idempotent", () => {
    const input = "graph Foo {\n// keep this\nfunc Bar() {\nvar s string = `a  b`\n}\n}\n";
    const first = formatSource(input, { fileName: "Foo.fcg" });
    expect(first.code).toContain("// keep this");
    expect(first.code).toContain("`a  b`");
    const second = formatSource(first.code!, { fileName: "Foo.fcg" });
    expect(second.code).toBe(first.code);
  });

  it("formats header files through the declaration parser", () => {
    const result = formatSource("define Foo:int\n", { fileName: "Foo.fcc" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe("define Foo: int\n");
  });

  it("keeps consecutive declaration decorators on separate lines", () => {
    const source = "[platform_client]\n[platform_server]\nevent Foo()\n";
    const result = formatSource(source, { fileName: "Decorators.fcc" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe("[platform_client]\n[platform_server]\nevent Foo()\n");
  });

  it("keeps multiline JSDoc attached to header declarations without an extra blank line", () => {
    const source = [
      "/**",
      " * Tuple docs",
      " */",
      "tuple Foo {",
      "  value int",
      "}",
      "/**",
      " * Enum docs",
      " */",
      "enum Kind {",
      "  One = 1",
      "}",
      "/**",
      " * Function docs",
      " */",
      "func Build() int",
      "",
    ].join("\n");
    const result = formatSource(source, { fileName: "Docs.fcc" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(" */\ntuple Foo");
    expect(result.code).toContain(" */\nenum Kind");
    expect(result.code).toContain(" */\nfunc Build");
    expect(result.code).not.toContain(" */\n\n");
  });

  it("keeps a JSDoc block directly attached to a tuple declaration", () => {
    const source = ["/**", " * DebugConfig", " *", " * Fixed whitelist for debug commands.", " */", "tuple DebugConfig {", "}", ""].join("\n");
    const result = formatSource(source, { fileName: "DebugConfig.fcc" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe(["/**", " * DebugConfig", " *", " * Fixed whitelist for debug commands.", " */", "tuple DebugConfig {", "}", ""].join("\n"));
  });

  it("breaks commented tuple collections at the opener and indents their entries", () => {
    const source = [
      "tuple DebugConfig {",
      "WhitelistIDs List<string> = {",
      "// Default UID of the local player",
      "\"10001\", \"10002\", \"10003\", \"10004\",",
      "// Other UIDs for testing",
      "\"10257800578\",",
      "}",
      "}",
      "",
    ].join("\n");
    const result = formatSource(source, { fileName: "DebugConfig.fcc" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe([
      "tuple DebugConfig {",
      "  WhitelistIDs List<string> = {",
      "    // Default UID of the local player",
      "    \"10001\",",
      "    \"10002\",",
      "    \"10003\",",
      "    \"10004\",",
      "    // Other UIDs for testing",
      "    \"10257800578\",",
      "  }",
      "}",
      "",
    ].join("\n"));
    expect(formatSource(result.code!, { fileName: "DebugConfig.fcc" }).code).toBe(result.code);
  });

  it("normalizes broken bare collections to an aligned closing brace and trailing comma", () => {
    const source = "tuple DebugConfig {MergeSizeCurve List<float> = {0.50,0.66,0.72,0.77,}}";
    const result = formatSource(source, { fileName: "DebugConfig.fcc", printWidth: 38 });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe([
      "tuple DebugConfig {",
      "  MergeSizeCurve List<float> = {",
      "    0.50,",
      "    0.66,",
      "    0.72,",
      "    0.77,",
      "  }",
      "}",
      "",
    ].join("\n"));
    expect(result.code).not.toContain(",}");
  });

  it("keeps an empty collection flat even when its containing field exceeds print width", () => {
    const type = "Map<UUID, Map<int, List<entity<Entity>>>>";
    const source = `tuple DebugConfig {ColumnBuckets ${type} = ${type}{}}`;
    const result = formatSource(source, { fileName: "DebugConfig.fcc", printWidth: 40 });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(`ColumnBuckets ${type} = ${type}{}`);
    expect(result.code).not.toContain("{\n    ,");
  });

  it("keeps multiline JSDoc attached to graph members", () => {
    const source = [
      "graph Foo {",
      "  /**",
      "   * Function docs",
      "   */",
      "  func Build() {}",
      "}",
      "",
    ].join("\n");
    const result = formatSource(source, { fileName: "Docs.fcg" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain(" */\n  func Build");
    expect(result.code).not.toContain(" */\n\n");
  });

  it("breaks a long statement call without cascading the break into fitting nested collections", () => {
    const source = [
      "graph Foo {",
      "func Bar(node entity<Entity>, targetPosition Vector3, hiddenOffset Vector3, durationMs int) {",
      "Playable.CreateTween(node as entity<Entity>, UIWidget.AnchorPosition, targetPosition + hiddenOffset, targetPosition, Playable.TweenStyle.Once, Playable.CreateCurve({0, 0, 0.25, 1}), durationMs, out var tweenEntity, true,)",
      "}",
      "}",
    ].join("\n");
    const result = formatSource(source, { fileName: "Foo.fcg", printWidth: 80 });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe([
      "graph Foo {",
      "  func Bar(node entity<Entity>, targetPosition Vector3, hiddenOffset Vector3, durationMs int) {",
      "    Playable.CreateTween(",
      "      node as entity<Entity>,",
      "      UIWidget.AnchorPosition,",
      "      targetPosition + hiddenOffset,",
      "      targetPosition,",
      "      Playable.TweenStyle.Once,",
      "      Playable.CreateCurve({0, 0, 0.25, 1}),",
      "      durationMs,",
      "      out var tweenEntity,",
      "      true,",
      "    )",
      "  }",
      "}",
      "",
    ].join("\n"));
    expect(formatSource(result.code!, { fileName: "Foo.fcg", printWidth: 80 }).code).toBe(result.code);
  });

  it("never treats a generic type-argument comma as a broken call argument", () => {
    const source = [
      "graph Foo {",
      "func Send(player entity<Entity>, consumableItemId string, quantity int) {",
      "Track(player, TelemetryEventName.ConsumableApplied, Map<object, object>{\"consumable_item_id\": List<object>{consumableItemId}, \"quantity\": List<object>{quantity}})",
      "}",
      "}",
    ].join("\n");
    const result = formatSource(source, { fileName: "Foo.fcg", printWidth: 60 });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe([
      "graph Foo {",
      "  func Send(player entity<Entity>, consumableItemId string, quantity int) {",
      "    Track(",
      "      player,",
      "      TelemetryEventName.ConsumableApplied,",
      "      Map<object, object>{",
      "        \"consumable_item_id\": List<object>{consumableItemId},",
      "        \"quantity\"          : List<object>{quantity},",
      "      },",
      "    )",
      "  }",
      "}",
      "",
    ].join("\n"));
    expect(formatSource(result.code!, { fileName: "Foo.fcg", printWidth: 60 }).code).toBe(result.code);
  });

  it("keeps every call family flat at the width boundary and removes source trailing commas", () => {
    const source = [
      "graph Foo {",
      "func Bare() { Run(123456,234567,345678,) }",
      "func Waiter() { wait Run(123456,234567,345678,) }",
      "func Starter() { start Run(123456,234567,345678,) }",
      "func Assigned() { var result int; result = Run(123456,234567,345678,) }",
      "func Returned() { return Run(123456,234567,345678,) }",
      "}",
    ].join("\n");
    const result = formatSource(source, { fileName: "Foo.fcg", printWidth: 40 });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe([
      "graph Foo {",
      "  func Bare() {",
      "    Run(123456, 234567, 345678)",
      "  }",
      "  func Waiter() {",
      "    wait Run(123456, 234567, 345678)",
      "  }",
      "  func Starter() {",
      "    start Run(123456, 234567, 345678)",
      "  }",
      "  func Assigned() {",
      "    var result int",
      "    result = Run(123456, 234567, 345678)",
      "  }",
      "  func Returned() {",
      "    return Run(123456, 234567, 345678)",
      "  }",
      "}",
      "",
    ].join("\n"));
    expect(result.code).not.toMatch(/,\)/u);
  });

  it("uses strict break-all for bare and value calls when the flat form exceeds width", () => {
    const source = [
      "graph Foo {",
      "func Bare() { Run(123456,234567,345678,) }",
      "func Waiter() { wait Run(123456,234567,345678,) }",
      "func Starter() { start Run(123456,234567,345678,) }",
      "func Assigned() { var result int; result = Run(123456,234567,345678,) }",
      "func Returned() { return Run(123456,234567,345678,) }",
      "}",
    ].join("\n");
    const result = formatSource(source, { fileName: "Foo.fcg", printWidth: 30 });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe([
      "graph Foo {",
      "  func Bare() {",
      "    Run(",
      "      123456,",
      "      234567,",
      "      345678,",
      "    )",
      "  }",
      "  func Waiter() {",
      "    wait Run(",
      "      123456,",
      "      234567,",
      "      345678,",
      "    )",
      "  }",
      "  func Starter() {",
      "    start Run(",
      "      123456,",
      "      234567,",
      "      345678,",
      "    )",
      "  }",
      "  func Assigned() {",
      "    var result int",
      "    result = Run(",
      "      123456,",
      "      234567,",
      "      345678)",
      "  }",
      "  func Returned() {",
      "    return Run(",
      "      123456,",
      "      234567,",
      "      345678)",
      "  }",
      "}",
      "",
    ].join("\n"));
    expect(formatSource(result.code!, { fileName: "Foo.fcg", printWidth: 30 }).code).toBe(result.code);
  });

  it("refuses malformed input instead of emitting partial output", () => {
    const result = formatSource("graph Foo {", { fileName: "Foo.fcg" });
    expect(result.code).toBeUndefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("returns lexical diagnostics without emitting output", () => {
    const result = formatSource("graph Foo { var x string = `unterminated", { fileName: "Foo.fcg" });
    expect(result.code).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("unterminated-raw-string");
  });

  it("honors safe layout options and remains idempotent", () => {
    const source = "graph Foo {func Bar(){var values List<int> = List<int>{1,2,3}\nRun(1,2,3)}}";
    const first = formatSource(source, {
      fileName: "Foo.fcg",
      tabWidth: 4,
      spaceAroundOperators: false,
      spaceAfterComma: false,
      wrapCalls: "always",
      wrapCollections: "always",
      insertFinalNewline: false,
    });
    expect(first.diagnostics).toEqual([]);
    expect(first.code).toContain("values List<int> =List<int>{\n");
    expect(first.code).toContain("Run(\n");
    expect(first.code).not.toMatch(/\n$/u);
    const second = formatSource(first.code!, {
      fileName: "Foo.fcg",
      tabWidth: 4,
      spaceAroundOperators: false,
      spaceAfterComma: false,
      wrapCalls: "always",
      wrapCollections: "always",
      insertFinalNewline: false,
    });
    expect(second.code).toBe(first.code);
  });

  it("uses tabs and preserves additional blank lines when requested", () => {
    const source = "graph Foo {\n\n\nfunc Bar() { return }\n}\n";
    const result = formatSource(source, { fileName: "Foo.fcg", useTabs: true, tabWidth: 4, collapseBlankLines: false });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("\n\n\n\tfunc Bar()");
  });

  it("formats func types with out var parameters and qualified struct literals", () => {
    const source = [
      "graph Foo {",
      "PayloadMap Map<int, func(player entity<Player>, itemId int, target List<object>, out var payload List<object>) int> = Map<int, func(player entity<Player>, itemId int, target List<object>, out var payload List<object>) int>{}",
      "func Bar() {",
      "document = CustomTuple.JsonDocument{Nodes = snapshot, RootIndex = 0}",
      "for _, keyObject in rawKeys {",
      "Use(keyObject)",
      "}",
      "}",
      "}",
      "",
    ].join("\n");
    const result = formatSource(source, { fileName: "Foo.fcg" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("out var payload List<object>");
    expect(result.code).toContain("CustomTuple.JsonDocument{Nodes = snapshot, RootIndex = 0}");
    expect(formatSource(result.code!, { fileName: "Foo.fcg" }).code).toBe(result.code);
  });
});
