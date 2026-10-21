/**
 * @fileoverview Lint rule: no-zero-step-for-loop
 *
 * Disallows numeric for loops with a step of 0 (e.g. `for i = 0, 10, 0`).
 * A step of 0 causes an infinite loop that freezes the game tick/engine thread.
 *
 * @see {@link import("../../types/lint.js").LintRule}
 */

/** @type {import("../../types/lint.js").LintRule} */
export const noZeroStepForLoop = {
  id: "no-zero-step-for-loop",
  description: "Disallow numeric for loops with a step of 0 (causes infinite loop freeze).",
  defaultSeverity: "error",

  create(context) {
    return {
      Condition(node) {
        // Verify this condition belongs to a 'for' loop
        let isForLoop = false;
        for (let i = 0; i < context.tokens.length; i++) {
          const t = context.tokens[i];
          if (t.end <= node.start && t.channel === "syntax") {
            isForLoop = t.text === "for";
          }
          if (t.start >= node.start) break;
        }

        if (!isForLoop) return;

        // Collect syntax tokens inside the loop header
        const tokens = context.tokens.filter(
          (t) => t.start >= node.start && t.end <= node.end && t.channel === "syntax"
        );

        // Skip 'for (... in ...)' iterator loops
        if (tokens.some((t) => t.text === "in")) return;

        // Find top-level commas separating start, end, step
        let parenDepth = 0;
        let bracketDepth = 0;
        let braceDepth = 0;
        const commaIndices = [];

        for (let i = 0; i < tokens.length; i++) {
          const t = tokens[i];
          if (t.text === "(") parenDepth++;
          else if (t.text === ")") parenDepth--;
          else if (t.text === "[") bracketDepth++;
          else if (t.text === "]") bracketDepth--;
          else if (t.text === "{") braceDepth++;
          else if (t.text === "}") braceDepth--;
          else if (t.text === "," && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
            commaIndices.push(i);
          }
        }

        // Numeric for loops have: for var = start, end, step (2 commas)
        if (commaIndices.length >= 2) {
          const secondCommaIndex = commaIndices[1];
          const stepTokens = tokens.slice(secondCommaIndex + 1);

          if (stepTokens.length === 1 && stepTokens[0].text === "0") {
            context.report({
              token: stepTokens[0],
              message: "For loop step is 0, which causes an infinite loop and freezes the game execution.",
            });
          } else if (
            stepTokens.length === 2 &&
            ["+", "-"].includes(stepTokens[0].text) &&
            stepTokens[1].text === "0"
          ) {
            context.report({
              start: stepTokens[0].start,
              end: stepTokens[1].end,
              line: stepTokens[0].line,
              column: stepTokens[0].column,
              message: "For loop step is 0, which causes an infinite loop and freezes the game execution.",
            });
          }
        }
      },
    };
  },
};
