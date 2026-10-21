// Token kinds for the FC (Free Fire Craftland Code) language.
// Indexes match the authoritative token type IDs extracted from the official
// Craftland Studio FCG grammar (FCGLexer token constants).
export enum TokenKind {
  DEFINE = 1,
  ALIAS = 2,
  ENUM = 3,
  TUPLE = 4,
  ABSTRACT = 5,
  COMPONENT = 6,
  STRUCT = 7,
  EXPORT = 8,
  PARTIAL = 9,
  READONLY = 10,
  ACCEPT = 11,
  BRIDGING = 12,
  COMBINE = 13,
  DECLARE = 14,
  ELEMENT = 15,
  IMPORT = 16,
  FROM = 17,
  STATIC = 18,
  GRAPH = 19,
  BIND = 20,
  EVENT = 21,
  FUNC = 22,
  START = 23,
  WAIT = 24,
  ASYNC = 25,
  IF = 26,
  ELSE = 27,
  FOR = 28,
  IN = 29,
  WHILE = 30,
  BREAK = 31,
  CONTINUE = 32,
  RETURN = 33,
  SWITCH = 34,
  CASE = 35,
  VAR = 36,
  AS = 37,
  THISENTITY = 38,
  GLOBALENTITY = 39,
  OUT = 40,
  TYPEOF = 41,
  OBJECT = 42,
  TYPE = 43,
  BOOL = 44,
  INT = 45,
  INT64 = 46,
  FLOAT = 47,
  STRING = 48,
  COLOR = 49,
  VECTOR2 = 50,
  VECTOR3 = 51,
  QUATERNION = 52,
  LIST = 53,
  MAP = 54,
  LOC_STRING = 55,
  ENTITY = 56,
  TRUE = 57,
  FALSE = 58,
  NIL_LIT = 59,
  IDENTIFIER = 60,
  L_PAREN = 61,
  R_PAREN = 62,
  L_CURLY = 63,
  R_CURLY = 64,
  L_BRACKET = 65,
  R_BRACKET = 66,
  COMMA = 67,
  SEMI = 68,
  COLON = 69,
  DOT = 70,
  PLUS_PLUS = 71,
  MINUS_MINUS = 72,
  DECLARE_ASSIGN = 73,
  HASHTAG = 74,
  LOGICAL_OR = 75,
  LOGICAL_AND = 76,
  EQUALS = 77,
  NOT_EQUALS = 78,
  LESS = 79,
  LESS_OR_EQUALS = 80,
  GREATER = 81,
  GREATER_OR_EQUALS = 82,
  ASSIGN = 83,
  PLUS_ASSIGN = 84,
  MINUS_ASSIGN = 85,
  STAR_ASSIGN = 86,
  DIV_ASSIGN = 87,
  MOD_ASSIGN = 88,
  AND_ASSIGN = 89,
  XOR_ASSIGN = 90,
  OR_ASSIGN = 91,
  RSHIFT_ASSIGN = 92,
  LSHIFT_ASSIGN = 93,
  OR = 94,
  DIV = 95,
  MOD = 96,
  AND = 97,
  XOR = 98,
  EXCLAMATION = 99,
  BIT_NOT = 100,
  PLUS = 101,
  MINUS = 102,
  STAR = 103,
  DECIMAL_LIT = 104,
  BINARY_LIT = 105,
  OCTAL_LIT = 106,
  HEX_LIT = 107,
  COLOR_HEX_LIT = 108,
  FLOAT_LIT = 109,
  DECIMAL_FLOAT_LIT = 110,
  HEX_FLOAT_LIT = 111,
  IMAGINARY_LIT = 112,
  RUNE_LIT = 113,
  RAW_STRING_LIT = 119,
  INTERPRETED_STRING_LIT = 120,
  WS = 121,
  COMMENT = 122,
  TERMINATOR = 123,
  LINE_COMMENT = 124,
  WS_NLSEMI = 125,
  COMMENT_NLSEMI = 126,
  LINE_COMMENT_NLSEMI = 127,
  EOS = 128,
  OTHER = 129,
  EOF = -1,
}

export interface Token {
  kind: TokenKind;
  text: string;
  line: number; // 1-based
  column: number; // 1-based
  offset: number; // 0-based char offset
  // True when this token is followed by a newline that triggers EOS insertion
  // (Go-style NLSEMI). Set on the token *before* the newline.
  newlineAfter?: boolean;
}

// Reserved keywords (keyword -> token kind). "Type", "Color", etc. are
// case-sensitive reserved type names per the grammar literal names.
const KEYWORDS: Record<string, TokenKind> = {
  define: TokenKind.DEFINE,
  alias: TokenKind.ALIAS,
  enum: TokenKind.ENUM,
  tuple: TokenKind.TUPLE,
  abstract: TokenKind.ABSTRACT,
  component: TokenKind.COMPONENT,
  struct: TokenKind.STRUCT,
  export: TokenKind.EXPORT,
  partial: TokenKind.PARTIAL,
  readonly: TokenKind.READONLY,
  accept: TokenKind.ACCEPT,
  bridging: TokenKind.BRIDGING,
  combine: TokenKind.COMBINE,
  declare: TokenKind.DECLARE,
  element: TokenKind.ELEMENT,
  import: TokenKind.IMPORT,
  from: TokenKind.FROM,
  static: TokenKind.STATIC,
  graph: TokenKind.GRAPH,
  bind: TokenKind.BIND,
  event: TokenKind.EVENT,
  func: TokenKind.FUNC,
  start: TokenKind.START,
  wait: TokenKind.WAIT,
  async: TokenKind.ASYNC,
  if: TokenKind.IF,
  else: TokenKind.ELSE,
  for: TokenKind.FOR,
  in: TokenKind.IN,
  while: TokenKind.WHILE,
  break: TokenKind.BREAK,
  continue: TokenKind.CONTINUE,
  return: TokenKind.RETURN,
  switch: TokenKind.SWITCH,
  case: TokenKind.CASE,
  var: TokenKind.VAR,
  as: TokenKind.AS,
  thisEntity: TokenKind.THISENTITY,
  globalEntity: TokenKind.GLOBALENTITY,
  out: TokenKind.OUT,
  typeof: TokenKind.TYPEOF,
  object: TokenKind.OBJECT,
  Type: TokenKind.TYPE,
  bool: TokenKind.BOOL,
  int: TokenKind.INT,
  int64: TokenKind.INT64,
  float: TokenKind.FLOAT,
  string: TokenKind.STRING,
  Color: TokenKind.COLOR,
  Vector2: TokenKind.VECTOR2,
  Vector3: TokenKind.VECTOR3,
  Quaternion: TokenKind.QUATERNION,
  List: TokenKind.LIST,
  Map: TokenKind.MAP,
  LocString: TokenKind.LOC_STRING,
  entity: TokenKind.ENTITY,
  true: TokenKind.TRUE,
  false: TokenKind.FALSE,
  nil: TokenKind.NIL_LIT,
};

// Multi-char operators, longest match first.
const OPERATORS: Array<[string, TokenKind]> = [
  ["<<=", TokenKind.LSHIFT_ASSIGN],
  [">>=", TokenKind.RSHIFT_ASSIGN],
  ["++", TokenKind.PLUS_PLUS],
  ["--", TokenKind.MINUS_MINUS],
  [":=", TokenKind.DECLARE_ASSIGN],
  ["||", TokenKind.LOGICAL_OR],
  ["&&", TokenKind.LOGICAL_AND],
  ["==", TokenKind.EQUALS],
  ["!=", TokenKind.NOT_EQUALS],
  ["<=", TokenKind.LESS_OR_EQUALS],
  [">=", TokenKind.GREATER_OR_EQUALS],
  ["+=", TokenKind.PLUS_ASSIGN],
  ["-=", TokenKind.MINUS_ASSIGN],
  ["*=", TokenKind.STAR_ASSIGN],
  ["/=", TokenKind.DIV_ASSIGN],
  ["%=", TokenKind.MOD_ASSIGN],
  ["&=", TokenKind.AND_ASSIGN],
  ["^=", TokenKind.XOR_ASSIGN],
  ["|=", TokenKind.OR_ASSIGN],
  ["(", TokenKind.L_PAREN],
  [")", TokenKind.R_PAREN],
  ["{", TokenKind.L_CURLY],
  ["}", TokenKind.R_CURLY],
  ["[", TokenKind.L_BRACKET],
  ["]", TokenKind.R_BRACKET],
  [",", TokenKind.COMMA],
  [";", TokenKind.SEMI],
  [":", TokenKind.COLON],
  [".", TokenKind.DOT],
  ["#", TokenKind.HASHTAG],
  ["|", TokenKind.OR],
  ["/", TokenKind.DIV],
  ["%", TokenKind.MOD],
  ["&", TokenKind.AND],
  ["^", TokenKind.XOR],
  ["!", TokenKind.EXCLAMATION],
  ["~", TokenKind.BIT_NOT],
  ["+", TokenKind.PLUS],
  ["-", TokenKind.MINUS],
  ["*", TokenKind.STAR],
  ["<", TokenKind.LESS],
  [">", TokenKind.GREATER],
  ["=", TokenKind.ASSIGN],
];

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}
function isHexDigit(c: string): boolean {
  return (
    (c >= "0" && c <= "9") ||
    (c >= "a" && c <= "f") ||
    (c >= "A" && c <= "F")
  );
}
function isBinDigit(c: string): boolean {
  return c === "0" || c === "1";
}
function isIdentifierStart(c: string | undefined): boolean {
  if (c === undefined) return false;
  return (
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    c === "_" ||
    c.charCodeAt(0) >= 0x80
  );
}
function isIdentifierPart(c: string | undefined): boolean {
  if (c === undefined) return false;
  return isIdentifierStart(c) || isDigit(c);
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let column = 1;
  let offset = 0;
  const n = source.length;

  const advance = (count = 1): void => {
    for (let i = 0; i < count; i++) {
      if (source[offset] === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
      offset++;
    }
  };

  const peek = (k = 0): string | undefined => source[offset + k];

  const make = (kind: TokenKind, text: string): Token => ({
    kind,
    text,
    line,
    column,
    offset,
  });

  while (offset < n) {
    const c = source[offset];

    // Whitespace (non-newline). Newlines are handled separately to support
    // Go-style NLSEMI.
    if (c === " " || c === "\t" || c === "\r" || c === "\u00a0" || c === "\u00ff") {
      const start = offset;
      let startLine = line;
      let startCol = column;
      while (
        offset < n &&
        (source[offset] === " " ||
          source[offset] === "\t" ||
          source[offset] === "\r" ||
          source[offset] === "\u00a0" ||
          source[offset] === "\ufffd")
      ) {
        advance();
      }
      // A line break inside/after whitespace handled below.
      tokens.push({
        kind: startLine < line ? TokenKind.WS_NLSEMI : TokenKind.WS,
        text: source.slice(start, offset),
        line: startLine,
        column: startCol,
        offset: start,
      });
      continue;
    }

    // Newline
    if (c === "\n") {
      const start = offset;
      const startLine = line;
      const startCol = column;
      advance();
      // Mark the previous significant token with newlineAfter for EOS insertion.
      markNewlineAfter(tokens);
      tokens.push({
        kind: TokenKind.WS_NLSEMI,
        text: source.slice(start, offset),
        line: startLine,
        column: startCol,
        offset: start,
      });
      continue;
    }

    // Line comment
    if (c === "/" && peek(1) === "/") {
      const start = offset;
      const startLine = line;
      const startCol = column;
      while (offset < n && source[offset] !== "\n") advance();
      tokens.push({
        kind: TokenKind.LINE_COMMENT,
        text: source.slice(start, offset),
        line: startLine,
        column: startCol,
        offset: start,
      });
      continue;
    }

    // Block comment
    if (c === "/" && peek(1) === "*") {
      const start = offset;
      const startLine = line;
      const startCol = column;
      advance(2);
      let closed = false;
      while (offset < n) {
        if (source[offset] === "*" && peek(1) === "/") {
          advance(2);
          closed = true;
          break;
        }
        advance();
      }
      const multiLine = line > startLine;
      tokens.push({
        kind: multiLine ? TokenKind.COMMENT_NLSEMI : TokenKind.COMMENT,
        text: source.slice(start, offset),
        line: startLine,
        column: startCol,
        offset: start,
      });
      if (multiLine) markNewlineAfter(tokens);
      continue;
    }

    // Raw string literal: `raw text` (backticks)
    if (c === "`") {
      const start = offset;
      const startLine = line;
      const startCol = column;
      advance();
      let closed = false;
      while (offset < n) {
        if (source[offset] === "`") {
          advance();
          closed = true;
          break;
        }
        advance();
      }
      tokens.push({
        kind: TokenKind.RAW_STRING_LIT,
        text: source.slice(start, offset),
        line: startLine,
        column: startCol,
        offset: start,
      });
      continue;
    }

    // Interpreted string literal: "..." with escapes
    if (c === '"') {
      const start = offset;
      const startLine = line;
      const startCol = column;
      advance();
      let closed = false;
      while (offset < n) {
        const ch = source[offset];
        if (ch === "\\") {
          advance(2);
          continue;
        }
        if (ch === '"') {
          advance();
          closed = true;
          break;
        }
        if (ch === "\n") break; // unterminated
        advance();
      }
      tokens.push({
        kind: TokenKind.INTERPRETED_STRING_LIT,
        text: source.slice(start, offset),
        line: startLine,
        column: startCol,
        offset: start,
      });
      continue;
    }

    // Rune literal: '...'
    if (c === "'") {
      const start = offset;
      const startLine = line;
      const startCol = column;
      advance();
      while (offset < n) {
        const ch = source[offset];
        if (ch === "\\") {
          advance(2);
          continue;
        }
        if (ch === "'") {
          advance();
          break;
        }
        if (ch === "\n") break;
        advance();
      }
      tokens.push({
        kind: TokenKind.RUNE_LIT,
        text: source.slice(start, offset),
        line: startLine,
        column: startCol,
        offset: start,
      });
      continue;
    }

    // Numbers and identifiers
    if (isDigit(c) || (c === "." && isDigit(peek(1) ?? ""))) {
      const tok = lexNumber(source, offset, line, column);
      advance(tok.text.length);
      tokens.push(tok);
      continue;
    }

    // Identifier / keyword
    if (isIdentifierStart(c)) {
      const start = offset;
      while (offset < n && isIdentifierPart(source[offset])) advance();
      const text = source.slice(start, offset);
      const kind = KEYWORDS[text] ?? TokenKind.IDENTIFIER;
      tokens.push({
        kind,
        text,
        line,
        column: column - text.length,
        offset: start,
      });
      continue;
    }

    // Color hex literal: `#RRGGBB` / `#RRGGBBAA` (e.g. `#7CCC66`, `#CA3C3CFF`).
    // The official FCGLexer tokenizes these as COLOR_HEX_LIT; match `#` + hex
    // digits before falling through to the `#` HASHTAG operator.
    if (c === "#" && offset + 1 < source.length && isHexDigit(source[offset + 1])) {
      const start = offset;
      const startLine = line;
      const startCol = column;
      advance(); // consume '#'
      while (offset < source.length && isHexDigit(source[offset])) advance();
      tokens.push({
        kind: TokenKind.COLOR_HEX_LIT,
        text: source.slice(start, offset),
        line: startLine,
        column: startCol,
        offset: start,
      });
      continue;
    }

    // Operators / punctuation
    // Note: `<<` and `>>` are NOT single tokens in the grammar; they are
    // two `LESS` (or two `GREATER`) tokens (see expressionBitShiftOp rule).
    const op = OPERATORS.find(([s]) => source.startsWith(s, offset));
    if (op) {
      const start = offset;
      const startLine = line;
      const startCol = column;
      advance(op[0].length);
      tokens.push({
        kind: op[1],
        text: op[0],
        line: startLine,
        column: startCol,
        offset: start,
      });
      continue;
    }

    // Unknown character
    tokens.push({
      kind: TokenKind.OTHER,
      text: c,
      line,
      column,
      offset,
    });
    advance();
  }

  tokens.push({ kind: TokenKind.EOF, text: "", line, column, offset });
  return tokens;
}

function markNewlineAfter(tokens: Token[]): void {
  // Go-style semicolon insertion: a newline terminates a statement only when it
  // follows one of these token kinds. Otherwise the expression continues onto
  // the next line and the newline is insignificant.
  const terminates = new Set<TokenKind>([
    TokenKind.IDENTIFIER,
    TokenKind.DECIMAL_LIT,
    TokenKind.BINARY_LIT,
    TokenKind.OCTAL_LIT,
    TokenKind.HEX_LIT,
    TokenKind.FLOAT_LIT,
    TokenKind.IMAGINARY_LIT,
    TokenKind.RUNE_LIT,
    TokenKind.INTERPRETED_STRING_LIT,
    TokenKind.RAW_STRING_LIT,
    TokenKind.R_PAREN,
    TokenKind.R_BRACKET,
    TokenKind.R_CURLY,
    TokenKind.PLUS_PLUS,
    TokenKind.MINUS_MINUS,
    TokenKind.RETURN,
    TokenKind.BREAK,
    TokenKind.CONTINUE,
    TokenKind.TRUE,
    TokenKind.FALSE,
    TokenKind.NIL_LIT,
  ]);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.kind === TokenKind.WS || t.kind === TokenKind.WS_NLSEMI) continue;
    if (t.kind === TokenKind.COMMENT || t.kind === TokenKind.COMMENT_NLSEMI) continue;
    if (terminates.has(t.kind)) t.newlineAfter = true;
    break;
  }
}

function lexNumber(
  source: string,
  start: number,
  line: number,
  column: number,
): Token {
  let i = start;
  const n = source.length;

  const isHexFloatColon = (): boolean => {
    // Hex float: 0x1.8p3 form or 0x1
    return false;
  };

  // hex float / hex
  if (
    source[i] === "0" &&
    (source[i + 1] === "x" || source[i + 1] === "X")
  ) {
    i += 2;
    let hasPoint = false;
    let hasExp = false;
    while (i < n && (isHexDigit(source[i]) || source[i] === "_")) i++;
    if (source[i] === ".") {
      hasPoint = true;
      i++;
      while (i < n && (isHexDigit(source[i]) || source[i] === "_")) i++;
    }
    if (source[i] === "p" || source[i] === "P") {
      hasExp = true;
      i++;
      if (source[i] === "+" || source[i] === "-") i++;
      while (i < n && isDigit(source[i])) i++;
    }
    let kind: TokenKind;
    if (hasPoint || hasExp) kind = TokenKind.HEX_FLOAT_LIT;
    else kind = TokenKind.HEX_LIT;
    return {
      kind,
      text: source.slice(start, i),
      line,
      column,
      offset: start,
    };
  }

  // binary
  if (
    source[i] === "0" &&
    (source[i + 1] === "b" || source[i + 1] === "B")
  ) {
    i += 2;
    while (i < n && (isBinDigit(source[i]) || source[i] === "_")) i++;
    return {
      kind: TokenKind.BINARY_LIT,
      text: source.slice(start, i),
      line,
      column,
      offset: start,
    };
  }

  // octal
  if (
    source[i] === "0" &&
    (source[i + 1] === "o" || source[i + 1] === "O")
  ) {
    i += 2;
    while (i < n && ((source[i] >= "0" && source[i] <= "7") || source[i] === "_"))
      i++;
    return {
      kind: TokenKind.OCTAL_LIT,
      text: source.slice(start, i),
      line,
      column,
      offset: start,
    };
  }

  // decimal / float
  let hasDigits = false;
  while (i < n && (isDigit(source[i]) || source[i] === "_")) {
    i++;
    hasDigits = true;
  }
  let isFloat = false;
  if (source[i] === ".") {
    isFloat = true;
    i++;
    while (i < n && (isDigit(source[i]) || source[i] === "_")) i++;
  }
  if (source[i] === "e" || source[i] === "E") {
    isFloat = true;
    i++;
    if (source[i] === "+" || source[i] === "-") i++;
    while (i < n && isDigit(source[i])) i++;
  }
  // imaginary
  if (source[i] === "i") {
    return {
      kind: TokenKind.IMAGINARY_LIT,
      text: source.slice(start, i + 1),
      line,
      column,
      offset: start,
    };
  }
  // color hex literal (# not handled here; HASHTAG + HEX would be separate).
  return {
    kind: isFloat ? TokenKind.FLOAT_LIT : TokenKind.DECIMAL_LIT,
    text: source.slice(start, i),
    line,
    column,
    offset: start,
  };
}

// Filter a token stream down to the significant tokens (drop WS/comments),
// useful for parser and linter logic.
export function significant(tokens: Token[]): Token[] {
  return tokens.filter(
    (t) =>
      t.kind !== TokenKind.WS &&
      t.kind !== TokenKind.WS_NLSEMI &&
      t.kind !== TokenKind.COMMENT &&
      t.kind !== TokenKind.COMMENT_NLSEMI &&
      t.kind !== TokenKind.LINE_COMMENT &&
      t.kind !== TokenKind.LINE_COMMENT_NLSEMI &&
      t.kind !== TokenKind.EOF,
  );
}