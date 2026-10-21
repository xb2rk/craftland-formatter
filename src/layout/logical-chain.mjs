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
  const hasLogicalOperator = parts.some((part, index) =>
    index > 0 &&
    index < parts.length - 1 &&
    part.type === "token" &&
    (part.text === "&&" || part.text === "||")
  );

  return hasLogicalOperator ? conditionWrapMode : "auto";
}

/**
 * Select break opportunities within an expression sequence.
 *
 * Distinguishes binary operators from unary signs by verifying the preceding token
 * is not a prefix context (such as an assignment, return, or opening delimiter).
 *
 * @param {readonly any[]} parts - Array of token or node parts.
 * @returns {number[]} Array of token indices where breaks may occur.
 */
export function findExpressionBreaks(parts) {
  // Filter for token parts that are in binary position (not immediately following a prefix context)
  const binaryCandidates = parts.flatMap((part, index) => {
    const isBinaryPosition =
      part.type === "token" &&
      index > 0 &&
      index < parts.length - 1 &&
      !PREFIX_CONTEXTS.has(parts[index - 1].text);

    return isBinaryPosition ? [{ part, index }] : [];
  });

  // 1. Highest priority breaks: Logical operators (&&, ||)
  const logicalOperators = binaryCandidates.filter(({ part }) =>
    part.text === "&&" || part.text === "||"
  );

  if (logicalOperators.length > 0) {
    return logicalOperators.map(({ index }) => index);
  }

  // 2. Secondary priority breaks: Lowest binding arithmetic operators
  for (const operatorTier of ARITHMETIC_PRECEDENCE) {
    const tierMatches = binaryCandidates.filter(({ part }) => operatorTier.has(part.text));

    if (tierMatches.length > 0) {
      return tierMatches.map(({ index }) => index);
    }
  }

  return [];
}
