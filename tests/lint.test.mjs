import test from "node:test";
import assert from "node:assert/strict";
import { lintSource } from "../src/lint/engine.mjs";

test("lint: no-assignment-in-condition catches accidental '=' and ':=' in if/while", () => {
  const badSource = `import "Math.fcc" as Math

graph TestGraph {
  func Check(hp int) {
    Math.Abs(hp)
    if (hp = 0) {
      return
    }
    while (hp := 10) {
      break
    }
  }
}
`;
  const { lintResult } = lintSource(badSource);
  assert.equal(lintResult.errorCount, 2);
  assert.equal(lintResult.diagnostics.length, 2);

  assert.equal(lintResult.diagnostics[0].ruleId, "no-assignment-in-condition");
  assert.equal(lintResult.diagnostics[0].severity, "error");
  assert.match(lintResult.diagnostics[0].message, /Did you mean '=='/);
  assert.equal(lintResult.diagnostics[0].line, 6);

  assert.equal(lintResult.diagnostics[1].ruleId, "no-assignment-in-condition");
  assert.equal(lintResult.diagnostics[1].severity, "error");
  assert.match(lintResult.diagnostics[1].message, /Unexpected ':='/);
  assert.equal(lintResult.diagnostics[1].line, 9);
});

test("lint: no-assignment-in-condition accepts valid comparisons, struct literals, and for loops", () => {
  const goodSource = `import "Math.fcc" as Math

graph TestGraph {
  func Check(hp int) {
    Math.Abs(hp)
    if (hp == 0) {
      return
    }
    if (hp != 10 && hp <= 20) {
      return
    }
    for i = 0, 10, 1 {
      hp = hp + i
    }
  }
}
`;
  const { lintResult } = lintSource(goodSource);
  assert.equal(lintResult.errorCount, 0);
  assert.equal(lintResult.diagnostics.length, 0);
});

test("lint: no-self-compare flags comparisons where both operands are identical", () => {
  const badSource = `import "Math.fcc" as Math

graph TestGraph {
  func Check(id int, hero Entity) {
    Math.Abs(id)
    if (id == id) {
      return
    }
    if (hero.health != hero.health) {
      return
    }
    var same = id <= id
  }
}
`;
  const { lintResult } = lintSource(badSource);
  assert.equal(lintResult.errorCount, 3);
  assert.equal(lintResult.diagnostics.length, 3);

  for (const diag of lintResult.diagnostics) {
    assert.equal(diag.ruleId, "no-self-compare");
    assert.equal(diag.severity, "error");
    assert.match(diag.message, /to itself/);
  }

  assert.equal(lintResult.diagnostics[0].line, 6);
  assert.equal(lintResult.diagnostics[1].line, 9);
  assert.equal(lintResult.diagnostics[2].line, 12);
});

test("lint: no-self-compare allows comparisons of distinct variables and expressions", () => {
  const goodSource = `import "Math.fcc" as Math

graph TestGraph {
  func Check(idA int, idB int, heroA Entity, heroB Entity) {
    Math.Abs(idA)
    if (idA == idB) {
      return
    }
    if (heroA.health != heroB.health) {
      return
    }
  }
}
`;
  const { lintResult } = lintSource(goodSource);
  assert.equal(lintResult.errorCount, 0);
  assert.equal(lintResult.diagnostics.length, 0);
});

test("lint: no-empty-block is off by default but can be enabled via options", () => {
  const source = `import "Math.fcc" as Math

graph TestGraph {
  func StubHandler() {
    Math.Abs(0)
  }

  func Check(isReady bool) {
    if (isReady) {}
    while (isReady) {}
  }
}
`;
  // By default, no-empty-block is off
  const defaultResult = lintSource(source).lintResult;
  assert.equal(defaultResult.diagnostics.length, 0);

  // When explicitly enabled as warn
  const enabledResult = lintSource(source, {
    rules: { "no-empty-block": "warn" },
  }).lintResult;
  assert.equal(enabledResult.warningCount, 2);
  assert.equal(enabledResult.diagnostics[0].ruleId, "no-empty-block");
  assert.equal(enabledResult.diagnostics[1].ruleId, "no-empty-block");
});

test("lint: no-zero-step-for-loop flags loops with step 0 that freeze the game", () => {
  const badSource = `import "Math.fcc" as Math

graph TestGraph {
  func Loop(total int) {
    Math.Abs(total)
    for i = 0, 10, 0 {
      total = total + i
    }
  }
}
`;
  const { lintResult } = lintSource(badSource);
  assert.equal(lintResult.errorCount, 1);
  assert.equal(lintResult.diagnostics[0].ruleId, "no-zero-step-for-loop");
  assert.match(lintResult.diagnostics[0].message, /step is 0/);
  assert.equal(lintResult.diagnostics[0].line, 6);
});

test("lint: no-unreachable-code flags statements after return, break, and continue", () => {
  const source = `import "Math.fcc" as Math

graph TestGraph {
  func Check(x int) int {
    Math.Abs(x)
    return 10
    var deadVar = 20
  }

  func Loop(count int) {
    Math.Abs(count)
    for i = 0, count, 1 {
      if (i > 5) {
        break
        count = count + 1
      }
    }
  }
}
`;
  const { lintResult } = lintSource(source);
  assert.equal(lintResult.errorCount, 2);
  assert.equal(lintResult.diagnostics[0].ruleId, "no-unreachable-code");
  assert.equal(lintResult.diagnostics[0].line, 7);
  assert.match(lintResult.diagnostics[0].message, /after 'return'/);

  assert.equal(lintResult.diagnostics[1].ruleId, "no-unreachable-code");
  assert.equal(lintResult.diagnostics[1].line, 15);
  assert.match(lintResult.diagnostics[1].message, /after 'break'/);
});

test("lint: no-unused-imports flags unreferenced library and script imports", () => {
  const source = `import "Physics.fcc" as Physics
import "Math.fcc" as Math
import "../Player/PlayerEntity.fcg" as PlayerEntity

graph TestGraph {
  func Calc(val int) int {
    return Math.Abs(val)
  }
}
`;
  const { lintResult } = lintSource(source);
  // Math is used, Physics and PlayerEntity are unused
  assert.equal(lintResult.warningCount, 2);
  assert.equal(lintResult.diagnostics.length, 2);

  assert.equal(lintResult.diagnostics[0].ruleId, "no-unused-imports");
  assert.equal(lintResult.diagnostics[0].line, 1);
  assert.match(lintResult.diagnostics[0].message, /'Physics'/);

  assert.equal(lintResult.diagnostics[1].ruleId, "no-unused-imports");
  assert.equal(lintResult.diagnostics[1].line, 3);
  assert.match(lintResult.diagnostics[1].message, /'PlayerEntity'/);
});

test("lint: options can disable rules or override severity", () => {
  const source = `import "Math.fcc" as Math

graph TestGraph {
  func Check(x int) {
    if (x == x) {}
  }
}
`;
  // Turn off no-self-compare and promote no-empty-block to error
  const { lintResult } = lintSource(source, {
    rules: {
      "no-self-compare": "off",
      "no-empty-block": "error",
      "no-unused-imports": "off",
    },
  });

  assert.equal(lintResult.diagnostics.length, 1);
  assert.equal(lintResult.diagnostics[0].ruleId, "no-empty-block");
  assert.equal(lintResult.diagnostics[0].severity, "error");
});

test("lint: no-duplicate-imports flags identical import paths and conflicting aliases", () => {
  const badSource = `import "Math.fcc" as Math
import "Math.fcc" as Math2
import "Other.fcc" as Math

graph TestGraph {
  func Check() {
    Math.Abs(1)
    Math2.Abs(2)
  }
}
`;
  const { lintResult } = lintSource(badSource);
  assert.equal(lintResult.errorCount, 2);
  assert.equal(lintResult.diagnostics.length, 2);

  assert.equal(lintResult.diagnostics[0].ruleId, "no-duplicate-imports");
  assert.match(lintResult.diagnostics[0].message, /Duplicate import for module "Math\.fcc"/);

  assert.equal(lintResult.diagnostics[1].ruleId, "no-duplicate-imports");
  assert.match(lintResult.diagnostics[1].message, /Import alias 'Math' is already used/);
});

test("lint: no-self-assignment flags redundant assignments where both sides are identical", () => {
  const badSource = `import "Math.fcc" as Math

graph TestGraph {
  func Check(hero Entity, count int) {
    count = count
    hero.health = hero.health
    Math.Abs(count)
  }
}
`;
  const { lintResult } = lintSource(badSource);
  assert.equal(lintResult.errorCount, 2);
  assert.equal(lintResult.diagnostics.length, 2);

  assert.equal(lintResult.diagnostics[0].ruleId, "no-self-assignment");
  assert.match(lintResult.diagnostics[0].message, /Assigning 'count' to itself is redundant/);

  assert.equal(lintResult.diagnostics[1].ruleId, "no-self-assignment");
  assert.match(lintResult.diagnostics[1].message, /Assigning 'hero\.health' to itself is redundant/);
});


