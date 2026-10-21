// =============================================================================
// lint.ts - the fc-format linter.
//
// Rules, grounded in `docs/CODING_CONVENTION.md` (§1 naming, §2 imports,
// §3 graph/platform, §4 JSDoc) plus FC-specific checks. Each rule emits a
// `Diagnostic` with a stable `ruleId` so the VS Code extension can map it to a
// quick fix.
//
// Severity policy:
//   - error   : hard violation of a MUST rule
//   - warning : SHOULD rule (the formatter fixes import order/whitespace) or
//               JSDoc / line-length advisories
//
// Token vocabulary is the same as the formatter (tokenizer.ts / FCGLexer).
// =============================================================================

import { tokenize, TokenKind } from "./tokenizer.js";
import { itemize, Item, isCommentItem } from "./items.js";
import { collectImports, sortImports } from "./rules/imports.js";
import { resolveConfig } from "./config.js";
import { buildMatching } from "./format.js";

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  ruleId: string;
  message: string;
  line: number; // 1-based
  column: number; // 1-based
  length: number;
  severity: Severity;
  /** Optional quick fix: replace the offending token's text with this. */
  fix?: { text: string };
}

// Reserved toolchain libs must keep their full file name as the alias
// (CODING_CONVENTION.md §2.1: "Reserved library luôn dùng full name").
const RESERVED_LIBS = new Set(["StdLibrary.fcc", "EditorGenLib.fcc"]);

// Script imports in this codebase carry a layer prefix in the file name
// (Server_/Client_/Framework_/...) but the alias drops it (e.g.
// `import "Server_EventBroadcast.fcc" as EventBroadcast`). Strip those before
// comparing alias to file name so the lint rule matches the real convention.
const LAYER_PREFIX = /^(Server_|Client_|Framework_|Data_|Utils_|Global_|Storage_|Systems_|Fx_|UI_|Audio_|Net_)/;

// `if`/`for`/`while`/`switch` condition must not be parenthesized (FC style).
const COND_KEYWORDS = new Set([TokenKind.IF, TokenKind.FOR, TokenKind.WHILE, TokenKind.SWITCH]);

// Declarations that are "public" and therefore need a JSDoc (§4).
const PUBLIC_DECL_KINDS = new Set([
  TokenKind.FUNC,
  TokenKind.EVENT,
  TokenKind.TUPLE,
  TokenKind.COMPONENT,
  TokenKind.ENUM,
  TokenKind.ALIAS,
  TokenKind.TYPE,
]);

// Event names MUST carry a contract prefix (§1.1: Request_/Notify_/Fact_).
const EVENT_PREFIX = /^(Request|Notify|Fact)_[A-Z]/;

function at(tok: { line: number; column: number; text: string }) {
  return { line: tok.line, column: tok.column, length: tok.text.length };
}

function basenameAlias(path: string): string {
  let p = path;
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (slash >= 0) p = p.slice(slash + 1);
  if (p.endsWith(".fcc") || p.endsWith(".fcg")) p = p.slice(0, -4);
  return p;
}

function stripLayerPrefix(name: string): string {
  return name.replace(LAYER_PREFIX, "");
}

function isPascalCase(s: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(s);
}
function isCamelCase(s: string): boolean {
  return /^[a-z][A-Za-z0-9]*$/.test(s);
}
function isPrivateField(s: string): boolean {
  return /^_[A-Z][A-Za-z0-9]*$/.test(s) || /^_[A-Z][A-Z0-9_]*$/.test(s);
}

/** Lint entry point. */
export function lint(source: string): Diagnostic[] {
  const tokens = tokenize(source);
  const items = itemize(tokens);
  const diags: Diagnostic[] = [];
  checkImportAliases(items, diags);
  checkImportOrder(items, diags);
  checkNaming(items, diags);
  checkPlatformDecorators(items, diags);
  checkGraphMissingPlatform(items, diags);
  checkEnumMembers(items, diags);
  checkEventNames(items, diags);
  checkJsdoc(items, diags);
  checkConditionParens(items, diags);
  checkLineTooLong(source, diags);
  return diags;
}

// ---- Rule: import alias ------------------------------------------------------
// §2.1: alias SHOULD match the file name; reserved libs MUST use the full name
// (abbreviating `StdLibrary` -> `StdLib` is a hard DON'T).
function checkImportAliases(items: Item[], diags: Diagnostic[]): void {
  const { imports } = collectImports(items);
  for (const imp of imports) {
    const expected = basenameAlias(imp.path);
    const tok = items[imp.itemStart].tok; // the IMPORT keyword, for position
    if (RESERVED_LIBS.has(imp.path)) {
      if (imp.alias !== expected) {
        diags.push({
          ruleId: "import-reserved-abbrev",
          severity: "error",
          message: `Reserved library "${imp.path}" must use its full name as alias ("${expected}"), not "${imp.alias}".`,
          ...at(tok),
          fix: { text: expected },
        });
      }
    } else if (imp.alias !== expected && imp.alias !== stripLayerPrefix(expected)) {
      diags.push({
        ruleId: "import-alias-mismatch",
        severity: "warning",
        message: `Import alias "${imp.alias}" should match the file name "${expected}".`,
        ...at(tok),
      });
    }
  }
}

// ---- Rule: import order/grouping ---------------------------------------------
// §2.1: imports follow std -> stdlib -> contracts -> relative layers. The
// formatter reorders these, so the linter only warns when they drift.
function checkImportOrder(items: Item[], diags: Diagnostic[]): void {
  const { imports } = collectImports(items);
  if (imports.length < 2) return;
  const sorted = sortImports(imports, resolveConfig());
  for (let i = 0; i < imports.length; i++) {
    if (imports[i].path !== sorted[i].path) {
      const tok = items[imports[i].itemStart].tok;
      diags.push({
        ruleId: "import-order",
        severity: "warning",
        message: `Imports are out of order (expected bucket/alpha order starts with "${sorted[i].path}"). Run the formatter to fix.`,
        ...at(tok),
      });
      return; // one report is enough; the formatter fixes the whole block
    }
  }
}

// ---- Rule: naming (func / var / field) ---------------------------------------
// §1.1: func = PascalCase verb-first (or `_PascalCase` private);
//       `var` local = camelCase; `_`-prefixed = `_PascalCase`/`_UPPER_SNAKE_CASE`.
function checkNaming(items: Item[], diags: Diagnostic[]): void {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (isCommentItem(it)) continue;
    const k = it.tok.kind;
    if (k === TokenKind.FUNC) {
      const name = nextName(items, i);
      if (name && !name.startsWith("_") && !isPascalCase(name)) {
        diags.push({
          ruleId: "naming-func",
          severity: "error",
          message: `Function name "${name}" must be PascalCase (verb-first), e.g. "GetSomething".`,
          ...at(items[i + 1].tok),
        });
      }
    } else if (k === TokenKind.VAR) {
      const name = nextName(items, i);
      if (!name) continue;
      if (name.startsWith("_")) {
        if (!isPrivateField(name)) {
          diags.push({
            ruleId: "naming-field",
            severity: "error",
            message: `Field/state "${name}" must be "_PascalCase" (state) or "_UPPER_SNAKE_CASE" (constant/CSV).`,
            ...at(items[i + 1].tok),
          });
        }
      } else if (!isCamelCase(name)) {
        diags.push({
          ruleId: "naming-local",
          severity: "error",
          message: `Local variable/param "${name}" must be camelCase.`,
          ...at(items[i + 1].tok),
        });
      }
    }
  }
}

function nextName(items: Item[], i: number): string | null {
  for (let j = i + 1; j < items.length; j++) {
    if (isCommentItem(items[j])) continue;
    const k = items[j].tok.kind;
    if (k === TokenKind.IDENTIFIER) return items[j].tok.text;
    if (
      k === TokenKind.L_PAREN ||
      k === TokenKind.L_CURLY ||
      k === TokenKind.ASSIGN ||
      k === TokenKind.SEMI ||
      k === TokenKind.COMMA
    ) {
      return null;
    }
  }
  return null;
}

// ---- Rule: platform decorator on graph, not handler -------------------------
// §3: `[platform_*]` MUST be placed on the `graph` (or `static graph`)
// declaration, never on individual listeners/handlers.
function checkPlatformDecorators(items: Item[], diags: Diagnostic[]): void {
  for (let i = 0; i < items.length - 2; i++) {
    const a = items[i];
    const b = items[i + 1];
    const c = items[i + 2];
    if (a.tok.kind !== TokenKind.L_BRACKET || c.tok.kind !== TokenKind.R_BRACKET) continue;
    if (b.tok.kind !== TokenKind.IDENTIFIER) continue;
    if (!/^platform_/i.test(b.tok.text)) continue;
    let j = i + 3;
    while (j < items.length && isCommentItem(items[j])) j++;
    const nk = j < items.length ? items[j].tok.kind : null;
    if (nk !== TokenKind.GRAPH && nk !== TokenKind.STATIC) {
      diags.push({
        ruleId: "platform-on-graph",
        severity: "error",
        message: `Platform decorator [${b.tok.text}] must be placed on the graph declaration, not on a handler/listener.`,
        ...at(a.tok),
      });
    }
  }
}

// ---- Rule: graph missing platform decorator ----------------------------------
// §3: a `graph` (or `static graph`) MUST carry a `[platform_*]` decorator.
function checkGraphMissingPlatform(items: Item[], diags: Diagnostic[]): void {
  const matching = buildMatching(items);
  const closeToOpen = new Map<number, number>();
  for (const [o, c] of matching) closeToOpen.set(c, o);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (isCommentItem(it)) continue;
    if (it.tok.kind !== TokenKind.GRAPH) continue;
    // skip back over comments/whitespace/STATIC for a preceding `[platform_*]`.
    // Bracket pairs (e.g. the decorator's own `[]`) are jumped over so a `]`
    // does not hide the `[platform_...]` that precedes it.
    let hasPlatform = false;
    let j = i - 1;
    while (j >= 0) {
      const k = items[j].tok.kind;
      if (k === TokenKind.EOS || k === TokenKind.TERMINATOR) break;
      if (isCommentItem(items[j])) { j--; continue; }
      if (k === TokenKind.STATIC) { j--; continue; } // [platform] static graph
      if (k === TokenKind.L_BRACKET) {
        const inner = items[j + 1];
        if (inner && !isCommentItem(inner) && inner.tok.kind === TokenKind.IDENTIFIER && /^platform_/i.test(inner.tok.text)) {
          hasPlatform = true;
        }
        break;
      }
      if (k === TokenKind.R_BRACKET || k === TokenKind.R_PAREN || k === TokenKind.R_CURLY) {
        const o = closeToOpen.get(j);
        j = o !== undefined ? o : j - 1;
        continue;
      }
      break;
    }
    if (!hasPlatform) {
      diags.push({
        ruleId: "graph-missing-platform",
        severity: "warning",
        message: `Graph declaration is missing a [platform_*] decorator (§3).`,
        ...at(it.tok),
      });
    }
  }
}

// ---- Rule: enum member namespace ---------------------------------------------
// §1.1: enum member = `<Domain>_<Thing>`, e.g. `WALLET_CoinInsufficient`.
function checkEnumMembers(items: Item[], diags: Diagnostic[]): void {
  const matching = buildMatching(items);
  for (let i = 0; i < items.length; i++) {
    if (items[i].tok.kind !== TokenKind.ENUM) continue;
    const open = findOpenAfter(items, i, TokenKind.L_CURLY);
    if (open === null) continue;
    const close = matching.get(open);
    if (close === undefined) continue;
    let prevSignificant = TokenKind.L_CURLY;
    for (let j = open + 1; j < close; j++) {
      const it = items[j];
      if (isCommentItem(it)) continue;
      const k = it.tok.kind;
      if (k === TokenKind.IDENTIFIER) {
        const stmtStart = prevSignificant === TokenKind.L_CURLY || prevSignificant === TokenKind.COMMA;
        if (stmtStart && !/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(it.tok.text)) {
          diags.push({
            ruleId: "enum-member-namespace",
            severity: "error",
            message: `Enum member "${it.tok.text}" must use <Domain>_<Thing> namespace, e.g. "GARDEN_OutOfRange".`,
            ...at(it.tok),
          });
        }
      }
      prevSignificant = k;
    }
  }
}

// ---- Rule: event name prefix -------------------------------------------------
// §1.1: event name = PascalCase + contract prefix (Request_/Notify_/Fact_).
function checkEventNames(items: Item[], diags: Diagnostic[]): void {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (isCommentItem(it)) continue;
    if (it.tok.kind !== TokenKind.EVENT) continue;
    const name = nextName(items, i);
    if (name && !EVENT_PREFIX.test(name)) {
      diags.push({
        ruleId: "event-name-prefix",
        severity: "error",
        message: `Event name "${name}" must use a contract prefix: Request_/Notify_/Fact_ (e.g. "Request_GardenSeedGrow").`,
        ...at(items[i + 1].tok),
      });
    }
  }
}

function findOpenAfter(items: Item[], i: number, kind: TokenKind): number | null {
  for (let j = i + 1; j < items.length; j++) {
    if (isCommentItem(items[j])) continue;
    if (items[j].tok.kind === kind) return j;
    if (items[j].tok.kind === TokenKind.L_PAREN) return null;
  }
  return null;
}

// ---- Rule: JSDoc for public declarations -------------------------------------
// §4: public types/functions should carry a JSDoc comment.
function checkJsdoc(items: Item[], diags: Diagnostic[]): void {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (isCommentItem(it)) continue;
    if (!PUBLIC_DECL_KINDS.has(it.tok.kind)) continue;
    const name = nextName(items, i);
    if (name && name.startsWith("_")) continue; // private decls are exempt
    let hasDoc = false;
    for (let j = i - 1; j >= 0; j--) {
      if (items[j].tok.kind === TokenKind.EOS || items[j].tok.kind === TokenKind.TERMINATOR) break;
      if (isCommentItem(items[j])) {
        hasDoc = true;
        break;
      }
      if (items[j].tok.kind === TokenKind.L_CURLY || items[j].tok.kind === TokenKind.R_CURLY) break;
    }
    if (!hasDoc) {
      diags.push({
        ruleId: "jsdoc-missing",
        severity: "warning",
        message: `Public declaration is missing a JSDoc comment.`,
        ...at(it.tok),
      });
    }
  }
}

// ---- Rule: condition without parens -------------------------------------------
// FC grammar: `if`/`for`/`while`/`switch` conditions are not parenthesized.
function checkConditionParens(items: Item[], diags: Diagnostic[]): void {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (isCommentItem(it)) continue;
    if (!COND_KEYWORDS.has(it.tok.kind)) continue;
    let j = i + 1;
    while (j < items.length && isCommentItem(items[j])) j++;
    if (j < items.length && items[j].tok.kind === TokenKind.L_PAREN) {
      diags.push({
        ruleId: "condition-no-parens",
        severity: "error",
        message: `FC conditions must not be wrapped in parentheses: drop the "(" after "${it.tok.text}".`,
        ...at(items[j].tok),
      });
    }
  }
}

// ---- Rule: line too long -----------------------------------------------------
// Advisory; the formatter wraps call/collection/param lists to maxLineLength,
// but a single unbreakable token (e.g. a long string) can still overflow.
function checkLineTooLong(source: string, diags: Diagnostic[]): void {
  const max = resolveConfig().maxLineLength;
  const lines = source.split("\n");
  lines.forEach((ln, idx) => {
    if (ln.length > max) {
      diags.push({
        ruleId: "line-too-long",
        severity: "warning",
        message: `Line exceeds ${max} characters (${ln.length}).`,
        line: idx + 1,
        column: max + 1,
        length: ln.length - max,
      });
    }
  });
}
