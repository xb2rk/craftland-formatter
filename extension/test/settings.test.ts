import assert from "node:assert/strict";
import test from "node:test";
import { readFormatOptions, readLintOptions } from "../src/settings.js";

test("maps only supported VS Code settings to validated core options", () => {
  const values: Record<string, unknown> = { printWidth: 120, useTabs: true, wrapCalls: "always", wrapCollections: "never" };
  const options = readFormatOptions({ get: <T>(key: string): T | undefined => values[key] as T | undefined });
  assert.equal(options.printWidth, 120);
  assert.equal(options.useTabs, true);
  assert.equal(options.wrapCalls, "always");
  assert.equal(options.wrapCollections, "never");
  assert.equal(options.spaceAfterComma, true);
});

test("maps validated lint settings and ignores unknown rule keys", () => {
  const options = readLintOptions({ get: <T>(key: string): T | undefined => ({
    "lint.rules": { "fc/no-unused-local": "error", "fc/not-a-rule": "error" },
    "lint.ignoredOutVariables": false,
    "lint.suppressions": false,
  } as Record<string, unknown>)[key] as T | undefined });
  assert.equal(options.rules?.["fc/no-unused-local"], "error");
  assert.equal(options.ignoredOutVariables, false);
  assert.equal(options.suppressions, false);
  assert.equal((options.rules as Record<string, unknown>)["fc/not-a-rule"], undefined);
});
