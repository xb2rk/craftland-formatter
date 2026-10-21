/**
 * @fileoverview Lint rule: no-assignment-in-condition
 *
 * Disallows assignment operators (=, :=) inside condition expressions of
 * control flow statements (if, while, for). Such assignments are almost
 * always accidental typos where equality comparison (==) was intended.
 *
 * @see {@link import("../../types/lint.js").LintRule}
 */

/** @type {import("../../types/lint.js").LintRule} */
export const noAssignmentInCondition = {
  id: "no-assignment-in-condition",
  description: "Disallow assignment operators (=, :=) in condition expressions.",
  defaultSeverity: "error",

  create(context) {
    return {
      Condition(node) {
        // Find the control keyword preceding this condition (if, while, for)
        let controlKeyword = "";
        for (let i = 0; i < context.tokens.length; i++) {
          const t = context.tokens[i];
          if (t.end <= node.start && t.channel === "syntax") {
            controlKeyword = t.text;
          }
          if (t.start >= node.start) break;
        }

        // 'for' loops in FC naturally use '=': for i = start, end, step { ... }
        if (controlKeyword === "for") return;

        // Find ignored ranges from nested collections or lambdas within the condition
        const ignoredRanges = [];
        for (const child of node.children ?? []) {
          if (child.kind === "Collection" || child.kind === "FunctionExpression") {
            ignoredRanges.push({ start: child.start, end: child.end });
          }
        }

        // Scan tokens in this condition's range
        for (const token of context.tokens) {
          if (token.start < node.start) continue;
          if (token.end > node.end) break;
          if (token.channel !== "syntax") continue;

          // Check for assignment operator '=' or ':='
          if (token.text === "=" || token.text === ":=") {
            // Check if token is inside an ignored child (like a struct initializer)
            const isInsideIgnored = ignoredRanges.some(
              (r) => token.start >= r.start && token.end <= r.end
            );
            if (isInsideIgnored) continue;

            const isWalrus = token.text === ":=";
            const message = isWalrus
              ? "Unexpected ':=' definition in condition expression. Use comparison '==' instead."
              : "Unexpected assignment operator '=' in condition expression. Did you mean '=='?";

            context.report({
              token,
              message,
              fix: !isWalrus
                ? { start: token.start, end: token.end, text: "==" }
                : undefined,
            });
          }
        }
      },
    };
  },
};
