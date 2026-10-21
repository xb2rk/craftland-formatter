/**
 * @fileoverview Registry of all built-in FC lint rules.
 */

import { noAssignmentInCondition } from "./no-assignment-in-condition.mjs";
import { noSelfCompare } from "./no-self-compare.mjs";
import { noEmptyBlock } from "./no-empty-block.mjs";
import { noUnreachableCode } from "./no-unreachable-code.mjs";
import { noZeroStepForLoop } from "./no-zero-step-for-loop.mjs";
import { noUnusedImports } from "./no-unused-imports.mjs";

/** @type {readonly import("../../types/lint.js").LintRule[]} */
export const BUILTIN_RULES = [
  noAssignmentInCondition,
  noSelfCompare,
  noEmptyBlock,
  noUnreachableCode,
  noZeroStepForLoop,
  noUnusedImports,
];

/** @type {ReadonlyMap<string, import("../../types/lint.js").LintRule>} */
export const RULES_BY_ID = new Map(BUILTIN_RULES.map((rule) => [rule.id, rule]));
