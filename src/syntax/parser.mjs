/**
 * Conservative structural parser for FC source.
 *
 * This parser owns syntax roles and source spans. It never imports the extension
 * oracle. The tree keeps the complete lossless token stream so a future printer
 * can attach comments and preserve literal bytes. A diagnostic suppresses the
 * printable tree; callers must not format a recovered fragment.
 *
 * @typedef {import("./lexer.mjs").Token} Token
 * @typedef {
 *   "File" | "Import" | "Graph" | "GraphBlock" | "Declaration" |
 *   "DeclarationBlock" | "Decorator" | "Function" | "EventListener" |
 *   "Property" | "Member" | "CodeBlock" | "Statement" | "ControlFlow" |
 *   "Condition" | "Signature" | "BareCall" | "ValueCall" | "Index" |
 *   "Collection" | "TypeArguments" | "LocalizedString" | "Parenthesized" |
 *   "FunctionTypeSignature" | "FunctionExpression"
 * } SyntaxKind
 * @typedef {{
 *   kind: SyntaxKind,
 *   start: number,
 *   end: number,
 *   children: SyntaxNode[]
 * }} SyntaxNode
 * @typedef {{
 *   phase: "parser",
 *   code: string,
 *   message: string,
 *   start: number,
 *   end: number,
 *   line: number,
 *   column: number
 * }} ParseDiagnostic
 * @typedef {{
 *   tree: (SyntaxNode & { tokens: Token[] }) | null,
 *   diagnostics: (ParseDiagnostic | import("./lexer.mjs").LexDiagnostic)[]
 * }} ParseResult
 */

import { lexSource } from "./lexer.mjs";
import { ASSIGNMENT_OPERATORS, BINARY_OPERATORS, PREFIX_OPERATORS, UPDATE_OPERATORS } from "./operators.mjs";
import { readType, readParameters, SCALAR_TYPES, isName } from "./types.mjs";

const CONTINUATION = new Set([
  ".", ",", ":", "=", ":=", "+", "-", "*", "/", "%", "&", "|", "^",
  "&&", "||", "==", "!=", "<", ">", "<=", ">=", "<<=", ">>=",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "as", "in",
]);
const BLOCK_STATEMENTS = new Set(["if", "for", "while", "else"]);
const HEADER_DECLARATIONS = new Set([
  "define", "alias", "enum", "tuple", "component", "event", "func", "declare",
]);
const GROUP_CLOSE = new Map([["(", ")"], ["[", "]"], ["{", "}"], ["<", ">"]]);
const GROUP_KIND = new Map([["(", "ValueCall"], ["[", "Index"], ["{", "Collection"], ["<", "TypeArguments"]]);
const INVALID_STATEMENT_START = new Set([
  "+", "-", "*", "/", "%", "&&", "||", "==", "!=", ".", ",", ":", "=", "<", ">", "[",
]);

/** Allowed decorator token kinds categorized by top-level header declaration keyword. */
const ALLOWED_DECORATORS_BY_HEADER = Object.freeze({
  define: ["ACCEPT", "IDENTIFIER"],
  enum: ["ACCEPT", "ELEMENT", "IDENTIFIER"],
  component: ["BRIDGING", "COMBINE", "IDENTIFIER"],
  tuple: [],
});

/** Allowed field decorators categorized by enclosing block kind. */
const FIELD_DECORATORS_BY_BLOCK = Object.freeze({
  enum: ["IDENTIFIER"],
  tuple: [],
});

/** Pair possible type delimiters once; syntax context decides which pairs are types. */
function pairAngles(syntax) {
  const opens = [];
  const closes = new Map();

  for (let index = 0; index < syntax.length; index += 1) {
    const text = syntax[index].text;

    if (text === "{" || text === "}" || text === ";") {
      opens.length = 0;
    } else if (text === "<") {
      opens.push(index);
    } else if (text === ">" && opens.length > 0) {
      closes.set(opens.pop(), index);
    }
  }

  return closes;
}

/**
 * Parse a complete graph or header file into a lossless structural tree.
 *
 * `tree === null` is the only safe outcome for malformed input. The parser
 * reports the first structural error; later phases can add recovery solely for
 * diagnostics without changing this contract.
 *
 * @param {string} source
 * @param {"fcg" | "fcc"} kind
 * @returns {ParseResult}
 */
export function parseSource(source, kind) {
  if (kind !== "fcg" && kind !== "fcc") {
    throw new TypeError("kind must be fcg or fcc");
  }

  const lexed = lexSource(source);

  if (lexed.diagnostics.length > 0) {
    return { tree: null, diagnostics: lexed.diagnostics };
  }

  const parser = new StructuralParser(source, lexed.tokens);
  const root = parser.parseFile(kind);

  if (parser.diagnostics.length > 0) {
    return { tree: null, diagnostics: parser.diagnostics };
  }

  return {
    tree: { ...root, tokens: lexed.tokens },
    diagnostics: [],
  };
}

/**
 * A cursor over syntax tokens. Source gaps remain available through offsets;
 * discarding trivia here would otherwise hide virtual end-of-statement rules.
 */
class StructuralParser {
  /** @param {string} source @param {Token[]} tokens */
  constructor(source, tokens) {
    this.source = source;
    this.tokens = tokens;
    this.syntax = tokens.filter((token) => token.channel === "syntax");
    this.angleCloses = pairAngles(this.syntax);
    this.angleOpens = new Map([...this.angleCloses].map(([open, close]) => [close, open]));
    /** @type {ParseDiagnostic[]} */
    this.diagnostics = [];
    this.index = 0;
    this.blockKinds = [];
    this.collectionShapes = new Map();
    this.decoratorHeads = new Map();
  }

  /** @param {"fcg" | "fcc"} kind */
  parseFile(kind) {
    /** @type {SyntaxNode[]} */
    const children = [];

    while (this.at("import")) {
      children.push(this.parseImport());
    }

    if (kind === "fcg") {
      if (children.length === 0) {
        this.fail("missing-import", "Graph files require at least one import.");
      }

      children.push(this.parseGraph());
    } else {
      while (!this.done() && !this.failed()) {
        children.push(this.parseHeaderDeclaration());
      }
    }

    if (!this.done() && !this.failed()) {
      this.fail("unexpected-top-level", "Unexpected token after the file declaration.");
    }

    return { kind: "File", start: 0, end: this.source.length, children };
  }

  /**
   * Parse an import declaration (either library import or script import).
   * @returns {SyntaxNode}
   */
  parseImport() {
    const start = this.take().start;
    const begin = this.index;
    const parts = this.readUntilLineEnd("Import");
    const tokens = this.syntax.slice(begin, this.index).filter((token) => token.text !== ";");

    let position = 0;
    const isQuotedPath = ["INTERPRETED_STRING_LIT", "RAW_STRING_LIT"].includes(tokens[0]?.kind);

    if (!isQuotedPath && tokens[0]?.kind !== "IDENTIFIER") {
      this.fail("invalid-import", "Expected an import path or script name.", tokens[0]);
    }

    position += 1;

    if (tokens[position]?.text === "as") {
      position += 1;

      if (!isName(tokens[position])) {
        this.fail("invalid-import", "Import aliases require a domain name.", tokens[position]);
      }

      position += 1;
    } else if (isQuotedPath) {
      this.fail("invalid-import", "Library imports require 'as Alias'.", tokens[position]);
    }

    if (!isQuotedPath) {
      const hasFrom = tokens[position]?.text === "from";
      const hasQuotedTarget = ["INTERPRETED_STRING_LIT", "RAW_STRING_LIT"].includes(tokens[position + 1]?.kind);

      if (!hasFrom || !hasQuotedTarget) {
        this.fail("invalid-import", "Script imports require 'from' and a quoted path.", tokens[position]);
      }

      position += 2;
    }

    if (position !== tokens.length) {
      this.fail("invalid-import", "Unexpected token in import declaration.", tokens[position]);
    }

    return {
      kind: "Import",
      start,
      end: parts.end,
      children: parts.children,
    };
  }

  /**
   * Parse a graph declaration and its enclosed member block.
   * @returns {SyntaxNode}
   */
  parseGraph() {
    const decorators = this.parseDecorators();
    this.validateDecoratorPlacement(decorators, ["IDENTIFIER"]);
    const start = decorators[0]?.start ?? this.current()?.start ?? this.source.length;

    while (this.at("partial") || this.at("static")) {
      this.take();
    }

    if (!this.at("graph")) {
      this.fail("expected-graph", "Expected a graph declaration.");
      return { kind: "Graph", start, end: start, children: decorators };
    }

    this.take();
    this.expectIdentifier("Graph declaration needs a name.");

    if (!this.at("{")) {
      this.fail("expected-graph-body", "Graph declaration needs a body.");
      return { kind: "Graph", start, end: start, children: decorators };
    }

    const block = this.parseBlock("GraphBlock", "member", "graph");
    block.declarationKind = "graph";
    return { kind: "Graph", start, end: block.end, children: [...decorators, block] };
  }

  /**
   * Parse a top-level FCC header declaration (enum, tuple, component, func, event, define, alias).
   * @returns {SyntaxNode}
   */
  parseHeaderDeclaration() {
    const decorators = this.parseDecorators();
    const start = decorators[0]?.start ?? this.current()?.start ?? this.source.length;

    while (this.at("partial") || this.at("static") || this.at("abstract") || this.at("async")) {
      this.take();
    }

    const head = this.current();

    if (!head || !HEADER_DECLARATIONS.has(head.text)) {
      this.fail("expected-declaration", "Expected an FC header declaration.");
      return { kind: "Declaration", start, end: start, children: decorators };
    }

    this.take();
    const begin = this.index;
    const allowedDecorators = ALLOWED_DECORATORS_BY_HEADER[head.text] ?? ["IDENTIFIER"];
    this.validateDecoratorPlacement(decorators, allowedDecorators);

    const headerKind = ["func", "event"].includes(head.text) ? "SignatureHeader" : "DeclarationHeader";
    const header = this.readUntilBlockOrLineEnd(headerKind);
    this.validateHeader(head, begin, this.index);
    const children = [...decorators, ...header.children];

    if (this.at("{")) {
      const block = this.parseBlock("DeclarationBlock", "member", head.text);
      block.declarationKind = head.text;
      children.push(block);
      return { kind: "Declaration", start, end: block.end, children };
    }

    return { kind: "Declaration", start, end: header.end, children };
  }

  parseDecorators() {
    /** @type {SyntaxNode[]} */
    const decorators = [];

    while (this.at("[")) {
      decorators.push(this.parseDelimited("Decorator"));
    }

    return decorators;
  }

  validateDecoratorPlacement(decorators, allowed) {
    for (const decorator of decorators) {
      const head = this.decoratorHeads.get(decorator.start);
      if (!allowed.includes(head?.kind)) {
        this.fail("unexpected-decorator", "Decorator is not allowed on this declaration.", head);
        return;
      }
    }
  }

  /** @param {string} kind @param {"member" | "statement"} content */
  parseBlock(kind, content, context = kind) {
    const open = this.take();
    this.blockKinds.push(context);
    /** @type {SyntaxNode[]} */
    const children = [];

    while (!this.done() && !this.at("}") && !this.failed()) {
      const before = this.index;
      children.push(content === "member" ? this.parseMember() : this.parseStatement());

      if (this.index === before && !this.failed()) {
        this.fail("parser-stalled", "Could not advance inside block.");
      }
    }

    this.blockKinds.pop();
    if (!this.at("}")) {
      this.fail("unclosed-block", "Expected closing } for block.", open);
      return { kind, start: open.start, end: this.previous()?.end ?? open.end, children };
    }

    const close = this.take();
    return { kind, start: open.start, end: close.end, children };
  }

  /**
   * Parse a member inside a graph or declaration block.
   * @returns {SyntaxNode}
   */
  parseMember() {
    const decorators = this.parseDecorators();
    const start = decorators[0]?.start ?? this.current()?.start ?? this.source.length;
    const head = this.current();

    if (this.at("async")) {
      this.take();
    }

    if (this.at("func") || this.at("event")) {
      if (decorators.length > 0) {
        this.fail("unexpected-decorator", "Graph-body functions and event listeners cannot have decorators.", head);
      }

      const keyword = this.take();
      const begin = this.index;
      const memberKind = keyword.text === "func" ? "Function" : "EventListener";
      const header = this.readUntilBlockOrLineEnd("SignatureHeader");
      this.validateSignature(begin, this.index);
      const children = [...decorators, ...header.children];

      if (this.at("{")) {
        const block = this.parseBlock("CodeBlock", "statement");
        children.push(block);
        return { kind: memberKind, start, end: block.end, children };
      }

      return { kind: memberKind, start, end: header.end, children };
    }

    if (!head) {
      this.fail("expected-member", "Expected a graph or declaration member.");
      return { kind: "Member", start, end: start, children: decorators };
    }

    const fieldDecorators = FIELD_DECORATORS_BY_BLOCK[this.blockKinds.at(-1)] ?? ["READONLY", "IDENTIFIER"];
    this.validateDecoratorPlacement(decorators, fieldDecorators);
    const begin = this.index;
    const value = this.readUntilLineEnd("Property");

    if (this.blockKinds.at(-1) !== "enum") {
      this.validateBinding(begin, this.index);
    }

    return { kind: "Property", start, end: value.end, children: [...decorators, ...value.children] };
  }

  /**
   * Parse a statement or control flow construct.
   * @param {boolean} [allowElse]
   * @returns {SyntaxNode}
   */
  parseStatement(allowElse = false) {
    const start = this.current()?.start ?? this.source.length;
    const head = this.current();

    if (head?.text === "else" && !allowElse) {
      this.fail("orphan-else", "else must follow an if block on the same line.");
    }

    if (head?.text === "switch") {
      this.fail("unsupported-switch", "switch is not part of FC grammar 1.11.0.");
    }

    if (head && (INVALID_STATEMENT_START.has(head.text) || /_LIT$/.test(head.kind))) {
      this.fail("unexpected-statement", "Unexpected token at the start of a statement.");
    }

    if (this.failed()) {
      return { kind: "Statement", start, end: head?.end ?? start, children: [] };
    }

    if (head && BLOCK_STATEMENTS.has(head.text)) {
      this.take();

      if (head.text === "else" && this.at("if")) {
        const branch = this.parseStatement();
        return { kind: "ControlFlow", start, end: branch.end, children: [branch] };
      }

      const condition = head.text === "else"
        ? { kind: "Condition", start: head.end, end: head.end, children: [] }
        : this.readUntilBlockOrLineEnd("Condition");

      if (!this.at("{")) {
        this.fail("expected-control-block", head.text + " needs a block.", head);
        return { kind: "ControlFlow", start, end: condition.end, children: condition.children };
      }

      const block = this.parseBlock("CodeBlock", "statement");
      const children = [condition, block];

      if (head.text === "if" && this.at("else")) {
        if (this.hasLineBreak(block.end, this.current().start)) {
          this.fail("else-line-break", "else must follow its closing } on the same line.");
        } else {
          children.push(this.parseStatement(true));
        }
      }

      return { kind: "ControlFlow", start, end: children.at(-1).end, children };
    }

    const body = this.readUntilLineEnd("Expression");
    return { kind: "Statement", start, end: body.end, children: body.children };
  }

  /** @param {string} kind */
  readUntilLineEnd(kind) {
    return this.readSequence(kind, false);
  }

  /** @param {string} kind */
  readUntilBlockOrLineEnd(kind) {
    return this.readSequence(kind, true);
  }

  /** @param {string} kind @param {boolean} stopAtBlock */
  readSequence(kind, stopAtBlock) {
    const start = this.current()?.start ?? this.previous()?.end ?? 0;
    const startIndex = this.index;
    /** @type {SyntaxNode[]} */
    const children = [];
    // Only declaration/control heads were consumed before entering this scan.
    // A new member or statement must not inherit a newline from its neighbor.
    let last = ["Import", "DeclarationHeader", "SignatureHeader", "Condition"].includes(kind)
      ? this.previous()
      : undefined;

    while (!this.done() && !this.failed()) {
      const token = this.current();

      if (token.text === "}" || token.text === ";") {
        break;
      }

      if (stopAtBlock && token.text === "{") {
        break;
      }

      const lastGroup = children.at(-1);
      const lastIsTypeClose = lastGroup?.kind === "TypeArguments" && lastGroup.end === last?.end;

      if (last && this.hasLineBreak(last.end, token.start) &&
          (!CONTINUATION.has(last.text) || lastIsTypeClose)) {
        break;
      }

      const functionBody = this.functionBodyStart();
      if (functionBody !== undefined) {
        children.push(this.parseFunctionExpression(functionBody));
      } else if (token.text === "(" || token.text === "[" || token.text === "{") {
        const role = token.text === "{" && this.previous()?.text === "LocString" ? "LocalizedString" :
          token.text === "(" && kind === "SignatureHeader" ? "Signature" :
          token.text === "(" ? this.parenthesisRole(kind === "Expression" && !this.isValueContext(startIndex)) :
          GROUP_KIND.get(token.text);
        children.push(this.parseDelimited(role));
      } else if (token.text === "<" && this.looksLikeTypeArguments()) {
        children.push(this.parseDelimited("TypeArguments"));
      } else if (token.text === ")" || token.text === "]" || token.text === ">") {
        if (token.text !== ">") {
          this.fail("unexpected-close", "Unexpected closing delimiter.");
          break;
        }

        this.take();
      } else {
        this.take();
      }

      last = this.previous();
    }

    if (this.at(";")) {
      last = this.take();
    }

    if (!last || last.end < start) {
      this.fail("expected-content", "Expected content before the line ending.");
    }

    if (["Expression", "Condition", "Property"].includes(kind)) {
      this.validateOperators(startIndex, this.index, children, kind);
    }
    if (kind === "Expression" && this.syntax[startIndex]?.text === "var") {
      this.validateBinding(startIndex + 1, this.index);
    }

    return { kind, start, end: last?.end ?? start, children };
  }

  /** @param {string} kind */
  parseDelimited(kind) {
    const openIndex = this.index;
    if (kind === "Index" && !this.isExpressionTarget(this.previous())) {
      this.fail("invalid-index-target", "FC list literals use braces; indexing requires a target.");
    }
    const open = this.take();
    const startIndex = this.index;
    const closeText = GROUP_CLOSE.get(open.text);
    /** @type {SyntaxNode[]} */
    const children = [];

    while (!this.done() && !this.at(closeText) && !this.failed()) {
      const token = this.current();
      const previous = this.previous();
      const unaryAfterSeparator = ["+", "-"].includes(token.text) &&
        [",", "(", "{"].includes(previous?.text);

      if (previous && this.hasLineBreak(previous.end, token.start) &&
          [",", ".", "&&", "||", "+", "-", "*", "/"].includes(token.text) &&
          !unaryAfterSeparator) {
        this.fail("leading-continuation", "Move the operator or separator to the previous line.");
        break;
      }

      const functionBody = this.functionBodyStart();
      if (functionBody !== undefined) {
        children.push(this.parseFunctionExpression(functionBody));
      } else if (token.text === "(" || token.text === "[" || token.text === "{") {
        const role = token.text === "{" && this.previous()?.text === "LocString" ? "LocalizedString" :
          token.text === "(" ? this.parenthesisRole(false) : GROUP_KIND.get(token.text);
        children.push(this.parseDelimited(role));
      } else if (token.text === "<" && this.looksLikeTypeArguments()) {
        children.push(this.parseDelimited("TypeArguments"));
      } else if (token.text === ")" || token.text === "]" || token.text === "}") {
        this.fail("mismatched-delimiter", "Mismatched closing delimiter.");
      } else {
        this.take();
      }
    }

    if (!this.at(closeText)) {
      this.fail("unclosed-delimiter", "Expected closing " + closeText + ".", open);
      return { kind, start: open.start, end: this.previous()?.end ?? open.end, children };
    }

    const close = this.take();

    // NOTE: FC distinguishes an isolated close from a trailing-comma close.
    // The latter is accepted by bare calls and multiline collections.
    const beforeClose = this.syntax[this.index - 2];
    const closeOnOwnLine = beforeClose && this.hasLineBreak(beforeClose.end, close.start);
    const trailingComma = beforeClose?.text === ",";

    if (closeOnOwnLine && !trailingComma && this.index - 1 > startIndex &&
        ["Collection", "ValueCall", "Parenthesized", "Index", "Signature", "FunctionTypeSignature", "TypeArguments", "LocalizedString"].includes(kind)) {
      this.fail("isolated-close", kind + " closing delimiter needs the final item on the same line or a trailing comma.", close);
    }

    if (trailingComma && ["ValueCall", "Parenthesized", "Index", "Signature", "FunctionTypeSignature", "TypeArguments", "LocalizedString"].includes(kind)) {
      this.fail("invalid-trailing-comma", kind + " does not allow a trailing comma.", close);
    }

    if (!["Signature", "FunctionTypeSignature", "TypeArguments", "Decorator"].includes(kind)) {
      this.validateOperators(startIndex, this.index - 1, children, kind);
    }
    if (["Signature", "FunctionTypeSignature"].includes(kind)) {
      const tokens = this.syntax.slice(openIndex, this.index);
      const end = readParameters(tokens, 0, this.fail.bind(this));
      if (end !== tokens.length) this.fail("invalid-signature", "Unexpected token in parameter list.", tokens[end]);
    } else if (kind === "Decorator") {
      const tokens = this.syntax.slice(startIndex, this.index - 1);
      this.decoratorHeads.set(open.start, tokens[0]);
      if (["READONLY", "BRIDGING", "IDENTIFIER"].includes(tokens[0]?.kind)) {
        if (tokens.length !== 1) this.fail("invalid-decorator", "This decorator contains a single name.", tokens[1]);
      } else if (["ACCEPT", "ELEMENT", "COMBINE"].includes(tokens[0]?.kind)) {
        let index = readType(tokens, 1, this.fail.bind(this));
        while (tokens[0].kind !== "ELEMENT" && tokens[index]?.text === ",") index = readType(tokens, index + 1, this.fail.bind(this));
        if (index !== tokens.length) this.fail("invalid-decorator", "Unexpected decorator argument.", tokens[index]);
      } else this.fail("invalid-decorator", "Expected an FC decorator name.", tokens[0] ?? open);
    } else if (["Collection", "LocalizedString"].includes(kind)) {
      this.validateCollection(openIndex, this.index - 1, children, kind);
    }

    return { kind, start: open.start, end: close.end, children };
  }

  /** Function types and literals share a signature; only literals own a body. */
  functionBodyStart() {
    if (!this.at("func") || this.syntax[this.index + 1]?.text !== "(") return undefined;
    const end = readType(this.syntax, this.index, this.fail.bind(this));
    return this.syntax[end]?.text === "{" ? end : undefined;
  }

  parseFunctionExpression(bodyIndex) {
    const start = this.take().start;
    const children = [];
    while (this.index < bodyIndex && !this.failed()) {
      if (this.at("(")) children.push(this.parseDelimited("FunctionTypeSignature"));
      else if (this.at("<")) children.push(this.parseDelimited("TypeArguments"));
      else this.take();
    }
    const body = this.parseBlock("CodeBlock", "statement");
    children.push(body);
    return { kind: "FunctionExpression", start, end: body.end, children };
  }

  /**
   * Check operator operands at the syntax boundary. Child groups are atoms here;
   * their contents have already been checked in their own grammatical context.
   * Declaration names/types remain structural; this is not type checking.
   */
  validateOperators(start, end, children, kind) {
    if (this.failed()) return;

    let needsOperand = true;
    let pending;
    let update;
    let childIndex = 0;
    let valueContext = kind !== "Expression";

    for (let index = start; index < end && !this.failed(); index += 1) {
      const token = this.syntax[index];
      if (token.text === ";" && index === end - 1) continue;

      if (update) {
        this.fail("postfix-update-position", "A postfix update must end its statement.", token);
        break;
      }

      const child = children[childIndex];
      if (child?.start === token.start) {
        childIndex += 1;
        while (index + 1 < end && this.syntax[index + 1].start < child.end) index += 1;
        if (child.kind !== "TypeArguments") {
          needsOperand = false;
          pending = undefined;
        }
        continue;
      }

      const spelling = token.text;
      if (["var", "return", "out", "wait", "start", "break", "continue"].includes(spelling)) {
        if (["var", "return"].includes(spelling)) valueContext = true;
        continue;
      }

      if (UPDATE_OPERATORS.has(spelling)) {
        if (needsOperand || valueContext) {
          this.fail("postfix-update-position", "++ and -- require a target and a standalone postfix statement.", token);
        } else {
          update = token;
        }
        continue;
      }

      if (needsOperand && PREFIX_OPERATORS.has(spelling)) {
        pending = token;
        continue;
      }

      if (ASSIGNMENT_OPERATORS.has(spelling) || BINARY_OPERATORS.has(spelling)) {
        if (needsOperand) {
          this.fail("invalid-operator-sequence", "Expected an operand before '" + spelling + "'. Compound operators must be written as one token.", token);
          break;
        }
        // Ordinary shifts are two angle tokens in the FC lexicon, even when
        // whitespace separates them. Consume the pair as one operator role.
        if (["<", ">"].includes(spelling) && this.syntax[index + 1]?.text === spelling) index += 1;
        if (ASSIGNMENT_OPERATORS.has(spelling)) valueContext = true;
        needsOperand = true;
        pending = token;
        continue;
      }

      if (PREFIX_OPERATORS.has(spelling)) {
        this.fail("invalid-operator-sequence", "Unexpected unary operator after an operand.", token);
        break;
      }

      if ([",", ":"].includes(spelling)) {
        if (needsOperand) {
          this.fail("missing-operand", "Expected an operand before '" + spelling + "'.", token);
          break;
        }
        needsOperand = true;
        pending = undefined;
        continue;
      }

      if (spelling === ".") {
        if (needsOperand) this.fail("missing-operand", "Member access needs a target before '.'.", token);
        needsOperand = true;
        pending = token;
        continue;
      }

      needsOperand = false;
      pending = undefined;
    }

    if (needsOperand && pending && !this.failed()) {
      this.fail("missing-operand", "Operator '" + pending.text + "' needs a following operand.", pending);
    }
  }

  /** Validate the type-bearing part of a property/local variable. */
  validateBinding(begin, end) {
    if (this.failed()) return;
    const tokens = this.syntax.slice(begin, end).filter(token => token.text !== ";");
    if (!isName(tokens[0])) return this.fail("expected-binding", "Bindings require an identifier.", tokens[0]);
    let index = 1;
    if (!["=", ":="].includes(tokens[index]?.text)) index = readType(tokens, index, this.fail.bind(this));
    if (index < tokens.length && !["=", ":="].includes(tokens[index]?.text)) {
      this.fail("invalid-binding-type", "Unexpected token after binding type.", tokens[index]);
    }
  }

  validateSignature(begin, end) {
    if (this.failed()) return;
    const tokens = this.syntax.slice(begin, end).filter(token => token.text !== ";");
    let index = 0;
    if (!isName(tokens[index])) return this.fail("expected-function-name", "Function/event declarations require a name.", tokens[index]);
    index += 1;
    while (tokens[index]?.text === "." && isName(tokens[index + 1])) index += 2;
    if (tokens[index]?.text !== "(") return this.fail("expected-signature", "Expected a parameter list.", tokens[index]);
    index = readParameters(tokens, index, this.fail.bind(this));
    if (index < tokens.length) index = readType(tokens, index, this.fail.bind(this));
    if (index !== tokens.length) this.fail("invalid-result-type", "Unexpected token after result type.", tokens[index]);
  }

  validateHeader(head, begin, end) {
    if (this.failed()) return;
    if (["func", "event"].includes(head.text)) return this.validateSignature(begin, end);
    const tokens = this.syntax.slice(begin, end).filter(token => token.text !== ";");
    let index = 0;
    if (head.text === "declare") {
      if (tokens[index]?.text === "static") index += 1;
      if (tokens[index]?.text !== "graph") return this.fail("expected-graph-declaration", "Expected 'graph' in a declare header.", tokens[index]);
      index += 1;
    }
    if (!isName(tokens[index])) return this.fail("expected-declaration-name", "Declaration requires a name.", tokens[index]);
    index += 1;
    if (["define", "alias"].includes(head.text)) {
      const separators = head.text === "define" ? [":", "="] : ["="];
      if (!separators.includes(tokens[index]?.text)) return this.fail("expected-type-separator", "Expected " + separators.join(" or ") + " after declaration name.", tokens[index]);
      index = readType(tokens, index + 1, this.fail.bind(this));
      while (head.text === "alias" && ["&", "|"].includes(tokens[index]?.text)) index = readType(tokens, index + 1, this.fail.bind(this));
    }
    if (index !== tokens.length) this.fail("invalid-declaration", "Unexpected token in declaration header.", tokens[index]);
    if (["enum", "tuple", "component", "declare"].includes(head.text) && !this.at("{")) this.fail("expected-declaration-body", "Declaration requires a body.", head);
  }

  /** Direct entries exclude child groups, which own their own grammar checks. */
  validateCollection(openIndex, closeIndex, children, kind) {
    if (this.failed()) return;
    const items = [];
    let item = [];
    let childIndex = 0;
    for (let index = openIndex + 1; index < closeIndex; index += 1) {
      const token = this.syntax[index];
      const child = children[childIndex];
      if (child?.start === token.start) {
        item.push({ ...token, child });
        childIndex += 1;
        while (index + 1 < closeIndex && this.syntax[index + 1].start < child.end) index += 1;
      } else if (token.text === ",") {
        items.push(item); item = [];
      } else item.push(token);
    }
    if (item.length) items.push(item);
    let previous = this.syntax[openIndex - 1];
    if (previous?.text === ">") {
      const open = this.angleOpens.get(openIndex - 1);
      if (open !== undefined) previous = this.syntax[open - 1];
    }
    const constructor = previous?.text;
    if (kind === "LocalizedString") {
      const argumentsList = items[1]?.at(-1)?.child;
      const bareList = items[1]?.length === 1 && argumentsList?.kind === "Collection";
      const typedList = items[1]?.length === 3 && items[1][0]?.text === "List" && items[1][1]?.child?.kind === "TypeArguments";
      if (items.length !== 2 || !items[0].length || !(bareList || typedList) ||
          this.collectionShapes.get(argumentsList?.start) !== "list") {
        this.fail("invalid-localized-string", "LocString requires a key expression and a positional list literal.", this.syntax[openIndex]);
      }
      return;
    }
    if (["List", "Map"].includes(constructor)) {
      const typeOpen = this.angleOpens.get(openIndex - 1);
      const typeStart = typeOpen === undefined ? openIndex - 1 : typeOpen - 1;
      const end = readType(this.syntax, typeStart, this.fail.bind(this));
      if (end !== openIndex) this.fail("invalid-collection-type", "Collection constructor requires complete type arguments.", this.syntax[typeStart]);
    }
    const shape = constructor === "Map" || items.some(row => row.some(token => token.text === ":")) ? "map" :
      items.some(row => row.some(token => token.text === "=")) ? "struct" : "list";
    this.collectionShapes.set(this.syntax[openIndex].start, shape);
    const tuple = previous?.kind === "IDENTIFIER";
    for (const row of items) {
      const colon = row.findIndex(token => token.text === ":");
      const assignment = row.findIndex(token => token.text === "=");
      if (!row.length || constructor === "Map" && (colon <= 0 || colon === row.length - 1) ||
          tuple && (row[0]?.kind !== "IDENTIFIER" || assignment !== 1 || row.length < 3) ||
          ["List", "Vector2", "Vector3", "Quaternion"].includes(constructor) && (colon >= 0 || assignment >= 0)) {
        this.fail("invalid-collection-entry", "Collection entry does not match its constructor.", row[0] ?? this.syntax[openIndex]);
        return;
      }
    }
  }

  /** A call after a return, variable head or assignment is a value call. */
  isValueContext(startIndex) {
    for (let index = startIndex; index < this.index; index += 1) {
      const text = this.syntax[index].text;

      if (text === "var" || text === "return" || ASSIGNMENT_OPERATORS.has(text)) {
        return true;
      }
    }

    return false;
  }

  /** Operators/keywords introduce grouping; expression targets introduce calls. */
  parenthesisRole(bare) {
    const previous = this.previous();
    if (previous?.text === "func") return "FunctionTypeSignature";
    const callable = this.isExpressionTarget(previous) || previous?.text === "typeof" || SCALAR_TYPES.has(previous?.text);

    return callable ? bare ? "BareCall" : "ValueCall" : "Parenthesized";
  }

  isExpressionTarget(token) {
    return token && (token.kind === "IDENTIFIER" || token.kind.endsWith("_LIT") || [")", "]", ">", "}"].includes(token.text));
  }

  looksLikeTypeArguments() {
    const previous = this.previous();

    if (!previous) {
      return false;
    }

    const canNameType = previous.kind === "IDENTIFIER" ||
      [">", "]", ")", "List", "Map", "entity", "thisEntity", "globalEntity"].includes(previous.text);

    if (!canNameType) {
      return false;
    }

    const closeIndex = this.angleCloses.get(this.index);
    if (closeIndex === undefined) return false;

    // Whitespace is allowed in builtin types and component access. Retain the
    // conservative adjacency heuristic for other ambiguous comparison heads.
    return previous.end === this.current().start ||
      ["List", "Map", "entity", "thisEntity", "globalEntity"].includes(previous.text) ||
      this.syntax[closeIndex + 1]?.text === ".";
  }

  /** @param {string} message */
  expectIdentifier(message) {
    const token = this.current();

    if (!token || token.kind !== "IDENTIFIER") {
      this.fail("expected-identifier", message);
      return;
    }

    this.take();
  }

  /** @param {number} start @param {number} end */
  hasLineBreak(start, end) {
    return /[\r\n]/.test(this.source.slice(start, end));
  }

  /** @param {string} code @param {string} message @param {Token} [token] */
  fail(code, message, token = this.current() ?? this.previous()) {
    if (this.failed()) {
      return;
    }

    this.diagnostics.push({
      phase: "parser",
      code,
      message,
      start: token?.start ?? this.source.length,
      end: token?.end ?? this.source.length,
      line: token?.line ?? 1,
      column: token?.column ?? 0,
    });
  }

  /** @param {string} text */
  at(text) {
    return this.current()?.text === text;
  }

  current() {
    return this.syntax[this.index];
  }

  previous() {
    return this.syntax[this.index - 1];
  }

  take() {
    const token = this.current();
    this.index += 1;
    return token;
  }

  done() {
    return this.index >= this.syntax.length;
  }

  failed() {
    return this.diagnostics.length > 0;
  }
}
