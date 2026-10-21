/**
 * @fileoverview Central AST visitor and diagnostic engine for the Craftland FC Linter.
 *
 * Traverses the lossless concrete syntax tree (CST) and dispatches nodes to registered
 * rules. Aggregates diagnostics with exact source coordinates and severity levels.
 *
 * @see {@link import("../types/lint.js").LintResult}
 */

import { parseSource } from "../syntax/parser.mjs";
import { BUILTIN_RULES, RULES_BY_ID } from "./rules/index.mjs";

/**
 * Precomputes 1-based line starts for fast O(log N) coordinate lookups.
 * @param {string} source
 * @returns {(offset: number) => { line: number, column: number }}
 */
export function createPositionLookup(source) {
  /** @type {number[]} */
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      lineStarts.push(i + 1);
    }
  }

  return function lookup(offset) {
    const clamped = Math.max(0, Math.min(offset, source.length));
    let low = 0;
    let high = lineStarts.length - 1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lineStarts[mid] <= clamped) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const lineIndex = high;
    const line = lineIndex + 1;
    const column = clamped - lineStarts[lineIndex];
    return { line, column };
  };
}

/**
 * Lints a parsed FC CST.
 *
 * @param {import("../types/ast.js").ParseResult} parseResult
 * @param {string} sourceText
 * @param {import("../types/lint.js").LintOptions} [options]
 * @param {string} [filePath]
 * @returns {import("../types/lint.js").LintResult}
 */
export function lintDocument(parseResult, sourceText, options = {}, filePath) {
  // If parsing failed with syntax errors, return empty diagnostics (safety first)
  if (!parseResult || !parseResult.tree || (parseResult.diagnostics && parseResult.diagnostics.length > 0)) {
    return { diagnostics: [], warningCount: 0, errorCount: 0 };
  }

  const lookupPosition = createPositionLookup(sourceText);
  /** @type {import("../types/lint.js").LintDiagnostic[]} */
  const diagnostics = [];

  let currentRuleId = "";
  /** @type {"warn" | "error"} */
  let currentSeverity = "warn";

  /** @type {import("../types/lint.js").LintContext} */
  const context = {
    filePath,
    sourceText,
    tokens: parseResult.tree.tokens ?? [],
    tree: parseResult.tree,
    report(descriptor) {
      let start = descriptor.start;
      let end = descriptor.end;
      let line = descriptor.line;
      let column = descriptor.column;

      if (descriptor.token) {
        start = descriptor.token.start;
        end = descriptor.token.end;
        line = descriptor.token.line;
        column = descriptor.token.column;
      } else if (descriptor.node) {
        start = descriptor.node.start;
        end = descriptor.node.end;
        if (descriptor.node.line !== undefined && descriptor.node.column !== undefined) {
          line = descriptor.node.line;
          column = descriptor.node.column;
        }
      }

      if (start === undefined) start = 0;
      if (end === undefined) end = start;

      if (line === undefined || column === undefined) {
        const pos = lookupPosition(start);
        line = pos.line;
        column = pos.column;
      }

      diagnostics.push({
        ruleId: currentRuleId,
        severity: currentSeverity,
        message: descriptor.message,
        start,
        end,
        line,
        column,
        fix: descriptor.fix,
      });
    },
  };

  // Resolve active rules and their severity
  /** @type {Map<string, Array<{ ruleId: string, severity: 'warn' | 'error', handler: (node: import("../types/ast.js").SyntaxNode) => void }>>} */
  const visitorsByKind = new Map();

  for (const rule of BUILTIN_RULES) {
    const configured = options.rules?.[rule.id];
    const severity = configured ?? rule.defaultSeverity;

    if (severity === "off") continue;

    const ruleVisitors = rule.create(context);
    for (const [kind, handler] of Object.entries(ruleVisitors)) {
      if (typeof handler !== "function") continue;
      let list = visitorsByKind.get(kind);
      if (!list) {
        list = [];
        visitorsByKind.set(kind, list);
      }
      list.push({ ruleId: rule.id, severity, handler });
    }
  }

  // Traverse AST
  /** @param {import("../types/ast.js").SyntaxNode} node */
  function walk(node) {
    const handlers = visitorsByKind.get(node.kind);
    if (handlers) {
      for (const entry of handlers) {
        currentRuleId = entry.ruleId;
        currentSeverity = entry.severity;
        entry.handler(node);
      }
    }

    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }

    const exitHandlers = visitorsByKind.get(`${node.kind}:exit`);
    if (exitHandlers) {
      for (const entry of exitHandlers) {
        currentRuleId = entry.ruleId;
        currentSeverity = entry.severity;
        entry.handler(node);
      }
    }
  }

  walk(parseResult.tree);

  // Sort diagnostics in reading order (line, column, start)
  diagnostics.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    if (a.column !== b.column) return a.column - b.column;
    return a.start - b.start;
  });

  let warningCount = 0;
  let errorCount = 0;
  for (const diag of diagnostics) {
    if (diag.severity === "error") errorCount++;
    else if (diag.severity === "warn") warningCount++;
  }

  return { diagnostics, warningCount, errorCount };
}

/**
 * Convenience helper: Lexes, parses, and lints raw FC source text in a single step.
 *
 * @param {string} sourceText
 * @param {import("../types/lint.js").LintOptions} [options]
 * @param {string} [filePath]
 * @returns {{ parseResult: import("../types/ast.js").ParseResult, lintResult: import("../types/lint.js").LintResult }}
 */
export function lintSource(sourceText, options = {}, filePath) {
  const kind = filePath && filePath.endsWith(".fcc") ? "fcc" : "fcg";
  const parseResult = parseSource(sourceText, kind);
  const lintResult = lintDocument(parseResult, sourceText, options, filePath);
  return { parseResult, lintResult };
}
