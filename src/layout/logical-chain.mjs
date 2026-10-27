/**
 * @fileoverview Expression layout analysis for logical conditions and arithmetic chains.
 *
 * Implements operator precedence-based break candidate selection so long expressions
 * wrap first at logical junctions (&&, ||), then at lowest-binding arithmetic operators (| ^ & + - * / %).
 */

import { PREFIX_CONTEXTS } from "../syntax/operators.mjs";

/** @typedef {import("../types/doc.d.ts").DocMode} DocMode */

/**
 * Arithmetic operator precedence tiers ordered from lowest binding to highest binding.
 *
 * Infix chains break at the lowest binding operator first so higher precedence
 * sub-expressions remain grouped together.
 */
export const ARITHMETIC_PRECEDENCE = Object.freeze([
  new Set(["|"]),
  new Set(["^"]),
  new Set(["&"]),
  new Set(["+", "-"]),
  new Set(["*", "/", "%"]),
]);

/**
 * Operator binding tiers ordered from lowest precedence (breaks first) to highest (breaks last).
 * - Tier 0: Logical boolean conjunctions (&&, ||)
 * - Tier 1: Bitwise OR (|)
 * - Tier 2: Bitwise XOR (^)
 * - Tier 3: Bitwise AND (&)
 * - Tier 4: Additive arithmetic (+, -)
 * - Tier 5: Multiplicative arithmetic (*, /, %)
 */
const OPERATOR_TIERS = Object.freeze({
  "&&": 0, "||": 0,
  "|": 1,
  "^": 2,
  "&": 3,
  "+": 4, "-": 4,
  "*": 5, "/": 5, "%": 5,
});

/** Sentinel tier representing infinity during minimum-tier search. */
const INFINITE_TIER = 999;

/**
 * Determine the layout break mode for a sequence of expression parts.
 *
 * If the sequence contains direct top-level logical operators ('&&' or '||'),
 * it adopts the configured condition wrap policy (`style.wrap.conditions`).
 * Otherwise, it wraps normally with `auto`.
 *
 * @param {readonly any[]} parts - Array of token or node parts in the expression.
 * @param {DocMode} conditionWrapMode - The configured `style.wrap.conditions` mode.
 * @returns {DocMode}
 */
export function determineLogicalMode(parts, conditionWrapMode) {
  for (let i = 1; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part.type === "token" && (part.text === "&&" || part.text === "||")) {
      return conditionWrapMode;
    }
  }

  return "auto";
}

/**
 * Select break opportunities within an expression sequence using an allocation-free single pass.
 *
 * Distinguishes binary operators from unary signs by verifying the preceding token
 * is not a prefix context (such as an assignment, return, or opening delimiter).
 *
 * @param {readonly any[]} parts - Array of token or node parts.
 * @returns {number[]} Array of token indices where breaks may occur.
 */
export function findExpressionBreaks(parts) {
  let bestTier = INFINITE_TIER;
  let bestIndices = [];

  for (let i = 1; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part.type !== "token") {
      continue;
    }

    const tier = OPERATOR_TIERS[part.text];
    if (tier === undefined) {
      continue;
    }

    // Skip prefix unary signs (e.g. -x, +y) that follow an assignment or opening paren
    if (PREFIX_CONTEXTS.has(parts[i - 1].text)) {
      continue;
    }

    if (tier < bestTier) {
      bestTier = tier;
      bestIndices = [i];

      // Early exit optimization: Tier 0 (&&, ||) has the lowest possible precedence.
      // Scan remaining tokens only for matching Tier 0 operators.
      if (bestTier === 0) {
        for (let j = i + 1; j < parts.length - 1; j++) {
          const next = parts[j];
          if (
            next.type === "token" &&
            (next.text === "&&" || next.text === "||") &&
            !PREFIX_CONTEXTS.has(parts[j - 1].text)
          ) {
            bestIndices.push(j);
          }
        }
        return bestIndices;
      }
    } else if (tier === bestTier) {
      bestIndices.push(i);
    }
  }

  return bestIndices;
}
