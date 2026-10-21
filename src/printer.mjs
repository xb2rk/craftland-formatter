/**
 * FC syntax-tree printer. Grammar roles come from the independent parser;
 * source tokens supply spelling and protected bytes. Direct API defaults come
 * from the same option registry used by the Phase 4 CLI.
 *
 * @typedef {import("./syntax/parser.mjs").SyntaxNode} SyntaxNode
 * @typedef {import("./syntax/lexer.mjs").Token} Token
 * @typedef {import("./document.mjs").Doc} Doc
 * @typedef {"auto" | "always" | "never"} WrapMode
 * @typedef {{ printWidth?: number, indentUnit?: string, continuationIndent?: number,
 *   alignment?: { collections?: boolean },
 *   imports?: { sort?: boolean },
 *   endOfLine?: "lf" | "crlf" | "preserve", finalNewline?: boolean,
 *   lineBreaks?: "canonical" | "preserve",
 *   wrap?: { calls?: WrapMode, parameters?: WrapMode | "preserve",
 *     collections?: WrapMode, conditions?: WrapMode },
 *   spacing?: { operators?: "spaced" | "compact", assignment?: "inherit" | "spaced" | "compact",
 *     comma?: "spaced" | "compact", brackets?: "tight" | "spaced" },
 *   blankLines?: { maxConsecutive?: number,
 *     afterImports?: "always" | "preserve" | "never",
 *     betweenMembers?: "preserve" | "always" | "never" } }} FormatterOptions
 */

import { parseSource } from "./syntax/parser.mjs";
import { lexSource } from "./syntax/lexer.mjs";
import { ASSIGNMENT_OPERATORS, BINARY_OPERATORS, PREFIX_CONTEXTS } from "./syntax/operators.mjs";
import { defaultLeaves, printerOptions } from "./config-registry.mjs";
import { concat, group, hardline, ifBreak, indent, line, softline, text, verbatim } from "./document.mjs";
import { columns, render } from "./render.mjs";
import { collectPragmas } from "./pragmas.mjs";
import { organizeImports } from "./imports.mjs";
import { alignCollectionEntries } from "./layout/collection-alignment.mjs";
import { determineLogicalMode, findExpressionBreaks } from "./layout/logical-chain.mjs";

const printerDefaults = printerOptions(defaultLeaves());
const DEFAULT_STYLE = Object.freeze({
  ...printerDefaults,
  wrap: Object.freeze(printerDefaults.wrap),
  alignment: Object.freeze(printerDefaults.alignment),
  imports: Object.freeze(printerDefaults.imports),
  spacing: Object.freeze(printerDefaults.spacing),
  blankLines: Object.freeze(printerDefaults.blankLines),
});
const GROUP_NODES = new Set([
  "Signature", "FunctionTypeSignature", "BareCall", "ValueCall", "Parenthesized", "Index", "Collection", "TypeArguments", "LocalizedString", "Decorator",
]);
const BLOCK_NODES = new Set(["GraphBlock", "CodeBlock", "DeclarationBlock"]);
const COMMENTS = new Set(["LINE_COMMENT", "COMMENT"]);

/** @param {string} source @param {FormatterOptions} requested */
function resolveStyle(source, requested) {
  const style = {
    ...DEFAULT_STYLE,
    ...requested,
    wrap: { ...DEFAULT_STYLE.wrap, ...requested.wrap },
    alignment: { ...DEFAULT_STYLE.alignment, ...requested.alignment },
    imports: { ...DEFAULT_STYLE.imports, ...requested.imports },
    spacing: { ...DEFAULT_STYLE.spacing, ...requested.spacing },
    blankLines: { ...DEFAULT_STYLE.blankLines, ...requested.blankLines },
  };

  if (!Number.isInteger(style.printWidth) || style.printWidth < 1) {
    throw new TypeError("printWidth must be a positive integer");
  }

  if (typeof style.indentUnit !== "string" || !/^[ \t]+$/.test(style.indentUnit)) {
    throw new TypeError("indentUnit must contain spaces or tabs");
  }

  if (!Number.isInteger(style.continuationIndent) || style.continuationIndent < 0 ||
      style.continuationIndent > 4 || typeof style.alignment.collections !== "boolean") {
    throw new TypeError("Invalid continuationIndent or alignment.collections option");
  }

  if (!["lf", "crlf", "preserve"].includes(style.endOfLine)) {
    throw new TypeError("endOfLine must be lf, crlf, or preserve");
  }

  if (typeof style.finalNewline !== "boolean" || !["canonical", "preserve"].includes(style.lineBreaks)) {
    throw new TypeError("Invalid finalNewline or lineBreaks option");
  }

  for (const [name, mode] of Object.entries(style.wrap)) {
    const allowed = name === "parameters" ? ["preserve", "auto", "always", "never"] : ["auto", "always", "never"];
    if (!allowed.includes(mode)) {
      throw new TypeError(`wrap.${name} must be ${allowed.join(", ")}`);
    }
  }

  if (!["spaced", "compact"].includes(style.spacing.operators) ||
      !["inherit", "spaced", "compact"].includes(style.spacing.assignment) ||
      !["spaced", "compact"].includes(style.spacing.comma) ||
      !["tight", "spaced"].includes(style.spacing.brackets) || typeof style.imports.sort !== "boolean") {
    throw new TypeError("Invalid spacing or imports.sort option");
  }

  if (!Number.isInteger(style.blankLines.maxConsecutive) ||
      style.blankLines.maxConsecutive < 0 || style.blankLines.maxConsecutive > 2 ||
      !["always", "preserve", "never"].includes(style.blankLines.afterImports) ||
      !["preserve", "always", "never"].includes(style.blankLines.betweenMembers)) {
    throw new TypeError("Invalid blankLines option");
  }

  const eol = style.endOfLine === "crlf" ? "\r\n" :
    style.endOfLine === "preserve" ? source.match(/\r\n|\r|\n/)?.[0] ?? "\n" : "\n";
  return { ...style, eol };
}

/** @param {Token[]} tokens @param {number} offset */
function firstAtOrAfter(tokens, offset) {
  let low = 0;
  let high = tokens.length;

  while (low < high) {
    const middle = (low + high) >>> 1;

    if (tokens[middle].start < offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

/** @param {Token} token */
function tokenPart(token) {
  return { type: "token", start: token.start, end: token.end, token, text: token.text };
}

/** @param {SyntaxNode} node */
function nodePart(node) {
  return { type: "node", start: node.start, end: node.end, node, text: "" };
}

/** Omit only grammar-approved terminal commas from the token identity check. */
function stableTokens(tree) {
  const syntax = tree.tokens.filter((token) => token.channel === "syntax");
  const optionalCommas = new Set();
  const pending = [tree];

  while (pending.length > 0) {
    const node = pending.pop();
    pending.push(...node.children);

    if (node.kind !== "Collection" && node.kind !== "BareCall") {
      continue;
    }

    const closeIndex = firstAtOrAfter(syntax, node.end) - 1;
    const beforeClose = syntax[closeIndex - 1];

    if (beforeClose?.text === "," && beforeClose.start >= node.start) {
      optionalCommas.add(beforeClose.start);
    }
  }

  return tree.tokens.filter((token) =>
    (token.channel === "syntax" || COMMENTS.has(token.kind)) && !optionalCommas.has(token.start));
}

class SyntaxPrinter {
  /** @param {string} source @param {SyntaxNode & {tokens: Token[]}} tree @param {ReturnType<typeof resolveStyle>} style */
  constructor(source, tree, style, ignored) {
    this.source = source;
    this.tokens = tree.tokens;
    this.style = style;
    this.ignored = ignored;
  }

  /** Collect direct child nodes and uncovered tokens in source order. */
  parts(node, start = node.start, end = node.end) {
    const children = node.children.filter((child) => child.start >= start && child.end <= end && child.end > child.start);
    const parts = [];
    let childIndex = 0;
    let tokenIndex = firstAtOrAfter(this.tokens, start);
    const ignored = this.ignored.filter(range => range.start >= start && range.end <= end);
    let ignoredIndex = 0;

    while (tokenIndex < this.tokens.length && this.tokens[tokenIndex].start < end) {
      const token = this.tokens[tokenIndex];
      const child = children[childIndex];
      const range = ignored[ignoredIndex];

      if (range && token.start >= range.start) {
        parts.push({ type: "ignored", ...range, text: this.source.slice(range.start, range.end) });
        ignoredIndex += 1;
        tokenIndex = firstAtOrAfter(this.tokens, range.end);
        while (children[childIndex]?.end <= range.end) childIndex += 1;
        continue;
      }

      if (child && token.start >= child.start && token.start < child.end) {
        parts.push(nodePart(child));
        childIndex += 1;
        tokenIndex = firstAtOrAfter(this.tokens, child.end);
        // The child prints its own protected spans. Ancestors must not replay
        // those spans after jumping past the child's token interval.
        while (ignored[ignoredIndex]?.end <= child.end) ignoredIndex += 1;
        continue;
      }

      if (token.channel === "syntax" || COMMENTS.has(token.kind)) {
        parts.push(tokenPart(token));
      }

      tokenIndex += 1;
    }

    return parts;
  }

  /** @param {SyntaxNode} node @returns {Doc} */
  print(node) {
    if (node.kind === "File") {
      return this.printFile(node);
    }

    if (BLOCK_NODES.has(node.kind)) {
      return this.printBlock(node);
    }

    if (GROUP_NODES.has(node.kind)) {
      return this.printGroup(node);
    }

    const parts = this.parts(node);
    const contents = this.printParts(parts, node.kind);
    const mode = this.logicalMode(parts);
    return group(contents, mode);
  }

  /** @param {ReturnType<typeof tokenPart> | ReturnType<typeof nodePart>} part */
  printPart(part) {
    if (part.type === "ignored") return verbatim(part.text, part.absolute);
    if (part.type === "node") {
      return this.print(part.node);
    }

    return COMMENTS.has(part.token.kind) || /[\r\n]/.test(part.text)
      ? verbatim(part.text)
      : text(part.text);
  }

  /** Whitespace between syntax atoms is chosen from their grammatical roles. */
  separator(previous, current, owner, beforePrevious) {
    const gap = this.source.slice(previous.end, current.start);
    const hadBreak = /[\r\n]/.test(gap);
    const prevComment = previous.type === "token" && COMMENTS.has(previous.token.kind);
    const nextComment = current.type === "token" && COMMENTS.has(current.token.kind);

    if (previous.type === "ignored" || current.type === "ignored") return hadBreak ? hardline : text(" ");

    if (prevComment || nextComment) {
      return previous.token?.kind === "LINE_COMMENT" || hadBreak ? hardline : text(" ");
    }

    if (previous.node?.kind === "Decorator") {
      return hardline;
    }

    if (this.style.lineBreaks === "preserve" && hadBreak) {
      return hardline;
    }

    const left = previous.text;
    const right = current.text;

    // Shift operands are two angle tokens even when separated by whitespace.
    // Type delimiters are child nodes and never reach this token-pair rule.
    if (left === "<" && right === "<" || left === ">" && right === ">") {
      return text("");
    }

    // Prefix signs bind to their operand; binary signs keep their separator.
    if (["-", "+", "~"].includes(left) &&
        (!beforePrevious || PREFIX_CONTEXTS.has(beforePrevious.text))) {
      // Repeated unary signs must not merge into a postfix update token.
      return text((left === "+" || left === "-") && left === right ? " " : "");
    }

    if (left === "," && this.style.spacing.comma === "compact") {
      return text("");
    }

    if (left === "&&" || left === "||") {
      return this.style.spacing.operators === "compact" ? softline : line;
    }

    const assignment = ["=", ":="].includes(left) || ["=", ":="].includes(right);
    const operator = BINARY_OPERATORS.has(left) || BINARY_OPERATORS.has(right) ||
      ASSIGNMENT_OPERATORS.has(left) || ASSIGNMENT_OPERATORS.has(right);
    const spacing = assignment && this.style.spacing.assignment !== "inherit"
      ? this.style.spacing.assignment : this.style.spacing.operators;
    if (operator) {
      const mandatory = ["as", "in"].includes(left) || ["as", "in"].includes(right) ||
        ["+", "-"].includes(left) && left === right;
      return text(spacing === "compact" && !mandatory ? "" : " ");
    }

    if (current.node && BLOCK_NODES.has(current.node.kind)) {
      return text(" ");
    }

    if (current.node?.kind === "Parenthesized") {
      return ["!", "~", "(", "[", "."].includes(left) ? text("") : text(" ");
    }

    if (current.node && GROUP_NODES.has(current.node.kind) &&
        !["Decorator"].includes(current.node.kind) &&
        !["=", ":=", "return", "var"].includes(left)) {
      return text("");
    }

    if (right === "," || right === ";" || right === "." || right === ":" ||
        right === ")" || right === "]" || right === "}") {
      return text("");
    }

    if (left === "." || left === "(" || left === "[" || left === "!") {
      return text("");
    }

    if (left === "++" || left === "--" || right === "++" || right === "--") {
      return text("");
    }

    return text(" ");
  }

  /**
   * Select expression boundaries without confusing a unary sign with a binary operator.
   * @param {readonly any[]} parts
   * @returns {number[]}
   */
  expressionBreaks(parts) {
    return findExpressionBreaks(parts);
  }

  /**
   * Print an expression sequence where operands fit independently, breaking at
   * binary and logical boundaries while preserving continuation indentation.
   *
   * @param {readonly any[]} parts
   * @param {string} owner
   * @returns {Doc}
   */
  printParts(parts, owner) {
    const breaks = this.expressionBreaks(parts);

    if (breaks.length === 0) {
      return this.printSequence(parts, owner);
    }

    const docs = [];
    let start = 0;

    for (const end of [...breaks.map((index) => index + 1), parts.length]) {
      const operand = parts.slice(start, end);

      if (start > 0) {
        const separator = this.separator(parts[start - 1], parts[start], owner, parts[start - 2]);
        docs.push(separator.type === "text" ? (separator.value ? line : softline) : separator);
      }

      docs.push(group(this.printParts(operand, owner), this.logicalMode(operand)));
      start = end;
    }

    // The first operand stays beside its header. Only subsequent operands gain
    // continuation indentation, and nested precedence groups own their tails.
    return concat(docs[0], indent(concat(...docs.slice(1)), this.style.continuationIndent));
  }

  /**
   * Print a sequence that has no direct expression break opportunities.
   *
   * @param {readonly any[]} parts
   * @param {string} owner
   * @returns {Doc}
   */
  printSequence(parts, owner) {
    const docs = [];
    let previous;
    let beforePrevious;

    for (const part of parts) {
      if (previous) {
        docs.push(this.separator(previous, part, owner, beforePrevious));
      }

      docs.push(this.printPart(part));
      beforePrevious = previous;
      previous = part;
    }

    return concat(...docs);
  }

  /**
   * Determine the layout mode for logical chains (&&, ||).
   * @param {readonly any[]} parts
   * @returns {"auto" | "always" | "never"}
   */
  logicalMode(parts) {
    return determineLogicalMode(parts, this.style.wrap.conditions);
  }

  /**
   * Format eligible collection keys once and measure their displayed width to align colons or equals.
   * @param {readonly any[][]} items
   * @param {string} owner
   * @returns {Doc[] | null}
   */
  alignedItems(items, owner) {
    return alignCollectionEntries({
      items,
      owner,
      printParts: (parts, own) => this.printParts(parts, own),
      separator: (prev, curr, own, beforePrev) => this.separator(prev, curr, own, beforePrev),
      logicalMode: (parts) => this.logicalMode(parts),
      style: this.style,
    });
  }

  /** @param {SyntaxNode} node */
  printFile(node) {
    return this.printEntries(this.parts(node), "File");
  }

  /** @param {SyntaxNode} node */
  printBlock(node) {
    const syntax = this.tokens.filter((token) => token.channel === "syntax" &&
      token.start >= node.start && token.end <= node.end);
    const open = syntax[0];
    const close = syntax.at(-1);
    const entries = this.parts(node, open.end, close.start);

    if (entries.length === 0) {
      return text("{}");
    }

    return concat(text("{"), indent(concat(hardline, this.printEntries(entries, node.kind))), hardline, text("}"));
  }

  /** Keep mandatory entry breaks separate from configurable blank boundaries. */
  printEntries(entries, owner) {
    const docs = [];
    let previous;

    for (const entry of entries) {
      if (previous) {
        const gap = this.source.slice(previous.end, entry.start);
        const trailingComment = entry.token && COMMENTS.has(entry.token.kind) && !/[\r\n]/.test(gap);

        if (trailingComment) {
          docs.push(text("  "));
        } else {
          docs.push(hardline);

          const sourceBlanks = Math.max(0, (gap.match(/\r\n|\r|\n/g) ?? []).length - 1);
          const importBoundary = owner === "File" && previous.node?.kind === "Import" &&
            entry.node && entry.node.kind !== "Import";
          const memberBoundary = ["GraphBlock", "DeclarationBlock"].includes(owner) &&
            previous.node && entry.node;
          const policy = importBoundary ? this.style.blankLines.afterImports :
            memberBoundary ? this.style.blankLines.betweenMembers : "preserve";
          const requested = policy === "always" ? Math.max(1, sourceBlanks) :
            policy === "never" ? 0 : sourceBlanks;
          const blankCount = Math.min(this.style.blankLines.maxConsecutive, requested);

          for (let index = 0; index < blankCount; index += 1) {
            docs.push(hardline);
          }
        }
      }

      docs.push(this.printPart(entry));
      previous = entry;
    }

    return concat(...docs);
  }

  /** @param {SyntaxNode} node */
  printGroup(node) {
    const syntax = this.tokens.filter((token) => token.channel === "syntax" &&
      token.start >= node.start && token.end <= node.end);
    const open = syntax[0];
    const close = syntax.at(-1);
    const original = this.source.slice(node.start, node.end);
    const tokens = this.tokens.filter(token => token.start >= node.start && token.end <= node.end);
    const hasComments = tokens.some(token => COMMENTS.has(token.kind));
    const protectedToken = tokens.some(token => token.kind.endsWith("_LIT") && /[\r\n]/.test(token.text)) ||
      hasComments && node.kind !== "Collection" ||
      this.ignored.some(range => range.start < node.end && range.end > node.start);

    if (protectedToken || this.style.lineBreaks === "preserve" && /[\r\n]/.test(original)) {
      return verbatim(original);
    }

    const interior = this.parts(node, open.end, close.start);
    if (hasComments && node.kind === "Collection") return this.printCommentedCollection(node, open, close, interior);
    if (["Signature", "FunctionTypeSignature"].includes(node.kind) && this.style.wrap.parameters === "preserve") {
      return this.printPreservedSignature(node, open, close, interior);
    }

    if (node.kind === "Parenthesized") {
      // Grouping parentheses bind to their first/last operand. Call wrapping
      // must not introduce a newline after this opening parenthesis.
      return group(concat(text(open.text), this.printParts(interior, node.kind), text(close.text)),
        this.logicalMode(interior));
    }

    const items = [];
    let item = [];

    for (const part of interior) {
      if (part.type === "token" && part.text === ",") {
        items.push(item);
        item = [];
      } else {
        item.push(part);
      }
    }

    if (item.length > 0) {
      items.push(item);
    }

    if (items.length === 0) {
      return text(open.text + close.text);
    }

    const itemDocs = node.kind === "Collection" && this.style.alignment.collections
      ? this.alignedItems(items, node.kind) : null;
    const printedItems = itemDocs ?? items.map((parts) =>
      group(this.printParts(parts, node.kind), this.logicalMode(parts)));
    const separated = [];

    for (let index = 0; index < printedItems.length; index += 1) {
      if (index > 0) {
        separated.push(text(","), this.style.spacing.comma === "compact" ? softline : line);
      }

      separated.push(printedItems[index]);
    }

    const trailingAllowed = node.kind === "Collection" || node.kind === "BareCall";
    const padding = node.kind === "Collection" && this.style.spacing.brackets === "spaced" ? line : softline;
    const content = concat(padding, ...separated, trailingAllowed ? ifBreak(text(",")) : text(""));
    const closing = trailingAllowed ? ifBreak(hardline, padding) : text("");
    const mode = node.kind === "Collection" || node.kind === "LocalizedString" ? this.style.wrap.collections :
      ["Signature", "FunctionTypeSignature"].includes(node.kind) ? this.style.wrap.parameters :
      node.kind === "BareCall" || node.kind === "ValueCall" ? this.style.wrap.calls : "never";

    // A flat argument/entry list adds no structural indent. Independently
    // broken child expressions then add only their own continuation levels.
    return group(concat(text(open.text), ifBreak(indent(content), content), closing, text(close.text)), mode);
  }

  /** A mandatory boundary plus capped source blank lines, measured between exact token spans. */
  sourceBreak(start, end) {
    const gap = this.source.slice(start, end);
    const blanks = Math.max(0, (gap.match(/\r\n|\r|\n/g) ?? []).length - 1);
    return concat(hardline, ...Array(Math.min(blanks, this.style.blankLines.maxConsecutive)).fill(hardline));
  }

  /** Preserve direct parameter breaks while normalizing safe spacing and structural indentation. */
  printPreservedSignature(node, open, close, interior) {
    const docs = [];
    let previous = tokenPart(open);
    let beforePrevious;
    let hasDirectBreak = false;

    for (const part of interior) {
      const gap = this.source.slice(previous.end, part.start);
      const hadBreak = /[\r\n]/.test(gap);
      hasDirectBreak ||= hadBreak;
      docs.push(hadBreak ? this.sourceBreak(previous.end, part.start) :
        this.separator(previous, part, node.kind, beforePrevious), this.printPart(part));
      beforePrevious = previous;
      previous = part;
    }

    const closing = /[\r\n]/.test(this.source.slice(previous.end, close.start))
      ? this.sourceBreak(previous.end, close.start) : text("");
    // `never` suppresses width-driven breaks; hard source boundaries still win.
    const content = concat(...docs);
    return group(concat(text(open.text), hasDirectBreak ? indent(content) : content, closing, text(close.text)), "never");
  }

  /**
   * Comment attachments belong to rows; they do not freeze collection layout.
   *
   * @param {SyntaxNode} node
   * @param {Token} open
   * @param {Token} close
   * @param {readonly any[]} interior
   * @returns {Doc}
   */
  printCommentedCollection(node, open, close, interior) {
    const rows = [];
    let row = { parts: [], leading: [], trailing: [] };
    let boundary;

    for (const part of interior) {
      if (part.type === "token" && part.text === ",") {
        row.end = part.end;
        rows.push(row);
        row = { parts: [], leading: [], trailing: [] };
        boundary = part.end;
      } else if (part.type === "token" && COMMENTS.has(part.token.kind) && !row.parts.length) {
        if (rows.length > 0 && boundary !== undefined && !/[\r\n]/.test(this.source.slice(boundary, part.start))) {
          rows.at(-1).trailing.push(part);
          boundary = part.end;
        } else {
          row.leading.push(part);
        }
      } else {
        row.parts.push(part);
      }
    }

    const footer = row.parts.length > 0 ? [] : row.leading;
    if (row.parts.length > 0) {
      rows.push(row);
    }

    const values = this.style.alignment.collections && rows.length > 0
      ? this.alignedItems(rows.map((r) => r.parts), node.kind)
      : null;

    const docs = [];
    let previousEnd = open.end;

    const appendBoundary = (start) => {
      docs.push(this.sourceBreak(previousEnd, start));
    };

    for (const [index, r] of rows.entries()) {
      for (const comment of r.leading) {
        appendBoundary(comment.start);
        docs.push(this.printPart(comment));
        previousEnd = comment.end;
      }

      appendBoundary(r.parts[0].start);
      docs.push(
        values?.[index] ?? group(this.printParts(r.parts, node.kind), this.logicalMode(r.parts)),
        text(",")
      );
      previousEnd = r.end ?? r.parts.at(-1).end;

      for (const comment of r.trailing) {
        docs.push(text(" "), this.printPart(comment));
      }

      if (r.trailing.length > 0) {
        previousEnd = r.trailing.at(-1).end;
      }
    }

    for (const comment of footer) {
      appendBoundary(comment.start);
      docs.push(this.printPart(comment));
      previousEnd = comment.end;
    }

    // Hard breaks guarantee line comments cannot consume following values.
    return group(
      concat(
        text(open.text),
        indent(concat(...docs)),
        this.sourceBreak(previousEnd, close.start),
        text(close.text)
      ),
      "always"
    );
  }
}

/**
 * Format one complete FC document. No output is returned for detected syntax or
 * safety failures. The caller decides whether to write the returned string.
 *
 * @param {string} source
 * @param {"fcg" | "fcc"} kind
 * @param {FormatterOptions} [options]
 * @returns {{ output: string | null, diagnostics: object[] }}
 */
export function formatSource(source, kind, options = {}) {
  const style = resolveStyle(source, options);
  let parsed = parseSource(source, kind);

  if (!parsed.tree) {
    return { output: null, diagnostics: parsed.diagnostics };
  }

  let pragmas = collectPragmas(source, parsed.tree);
  if (pragmas.diagnostics.length) return { output: null, diagnostics: pragmas.diagnostics };
  if (style.imports.sort) {
    const organized = organizeImports(source, parsed.tree, pragmas.ranges, style.eol);
    if (organized !== source) {
      source = organized;
      parsed = parseSource(source, kind);
      if (!parsed.tree) return { output: null, diagnostics: parsed.diagnostics };
      pragmas = collectPragmas(source, parsed.tree);
    }
  }
  const printer = new SyntaxPrinter(source, parsed.tree, style, pragmas.ranges);
  const rendered = render(printer.print(parsed.tree), style);
  // A protected final comment can contain its own EOL. Do not trim its bytes.
  const output = style.finalNewline && !/(?:\r\n|\r|\n)$/.test(rendered)
    ? rendered + style.eol : rendered;

  if (output === source) {
    return { output, diagnostics: [] };
  }

  const resultLexed = lexSource(output);
  const reparsed = resultLexed.diagnostics.length === 0 ? parseSource(output, kind) : null;
  const originalTokens = stableTokens(parsed.tree);
  const resultTokens = reparsed?.tree ? stableTokens(reparsed.tree) : [];
  const unchangedTokens = reparsed?.tree && resultTokens.length === originalTokens.length &&
    originalTokens.every((token, index) => token.kind === resultTokens[index].kind && token.text === resultTokens[index].text);

  if (!unchangedTokens || !reparsed?.tree) {
    const firstChanged = originalTokens.findIndex((token, index) =>
      token.kind !== resultTokens[index]?.kind || token.text !== resultTokens[index]?.text);
    const mismatch = firstChanged < 0 ? originalTokens.length : firstChanged;
    const expected = originalTokens[mismatch];
    const actual = resultTokens[mismatch];

    return {
      output: null,
      diagnostics: [{
        phase: "printer",
        code: !reparsed?.tree ? "formatted-source-invalid" : "protected-token-changed",
        message: !reparsed?.tree
          ? "Formatted output did not reparse: " + (reparsed?.diagnostics[0]?.message ?? resultLexed.diagnostics[0]?.message)
          : "Formatting changed token " + mismatch + " from " + JSON.stringify(expected?.text) +
            " to " + JSON.stringify(actual?.text) + ".",
        start: actual?.start ?? 0,
        end: actual?.end ?? 0,
        line: actual?.line ?? 1,
        column: actual?.column ?? 0,
      }],
    };
  }

  return { output, diagnostics: [] };
}
