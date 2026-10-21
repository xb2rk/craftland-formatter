/**
 * grammar.ts - hand-written lookup tables layered on top of the
 * `@generated` {@link TokenId} table in `grammar.generated.ts`.
 *
 * This file is the (only) *hand-maintained* source of truth for:
 *   - keywords (reserved words → token ids),
 *   - multi-char operators (longest-first match order),
 *   - punctuation token text,
 *   - trivia classification.
 *
 * If you add a keyword or operator, add it here AND verify the lexer accepts
 * it (run `npm run grammar:gen` again; the ids it contains are authoritative).
 *
 * The numeric ids themselves live only in `grammar.generated.ts`. Keeping the
 * hand-written lookup tables separate lets the generator be re-run any time
 * without risk of clobbering curated metadata.
 */

import { TokenId } from "./grammar.generated.js";

/**
 * Reserved words → token id. These are the DECLARATION and EXPRESSION
 * keywords the FC lexer recognizes. All lowercase except the four pulled-in
 * type identifiers. They intentionally remain here rather than in the scanner
 * so lexical policy is auditable in one table.
 */
export const KEYWORDS: Readonly<Record<string, TokenId>> = {
  // declarations
  define: TokenId.DEFINE,
  alias: TokenId.ALIAS,
  enum: TokenId.ENUM,
  tuple: TokenId.TUPLE,
  abstract: TokenId.ABSTRACT,
  component: TokenId.COMPONENT,
  struct: TokenId.STRUCT,
  export: TokenId.EXPORT,
  partial: TokenId.PARTIAL,
  readonly: TokenId.READONLY,
  accept: TokenId.ACCEPT,
  bridging: TokenId.BRIDGING,
  combine: TokenId.COMBINE,
  declare: TokenId.DECLARE,
  element: TokenId.ELEMENT,
  import: TokenId.IMPORT,
  from: TokenId.FROM,
  static: TokenId.STATIC,
  graph: TokenId.GRAPH,
  bind: TokenId.BIND,
  event: TokenId.EVENT,
  func: TokenId.FUNC,

  // flow/control
  start: TokenId.START,
  wait: TokenId.WAIT,
  async: TokenId.ASYNC,
  if: TokenId.IF,
  else: TokenId.ELSE,
  for: TokenId.FOR,
  in: TokenId.IN,
  while: TokenId.WHILE,
  break: TokenId.BREAK,
  continue: TokenId.CONTINUE,
  return: TokenId.RETURN,
  switch: TokenId.SWITCH, // dead in grammar; kept so tokenization stays in lockstep with the lexer
  case: TokenId.CASE, // dead in grammar (same reason as `switch`)

  // introductory keywords used inside expressions/statements
  var: TokenId.VAR,
  as: TokenId.AS,
  thisEntity: TokenId.THISENTITY,
  globalEntity: TokenId.GLOBALENTITY,
  out: TokenId.OUT,
  typeof: TokenId.TYPEOF,

  // primitive / builtin type names
  object: TokenId.OBJECT,
  Type: TokenId.TYPE,
  bool: TokenId.BOOL,
  int: TokenId.INT,
  int64: TokenId.INT64,
  float: TokenId.FLOAT,
  string: TokenId.STRING,
  Color: TokenId.COLOR,
  Vector2: TokenId.VECTOR2,
  Vector3: TokenId.VECTOR3,
  Quaternion: TokenId.QUATERNION,
  List: TokenId.LIST,
  Map: TokenId.MAP,
  LocString: TokenId.LOC_STRING,
  entity: TokenId.ENTITY,

  // boolean / nil literals
  true: TokenId.TRUE,
  false: TokenId.FALSE,
  nil: TokenId.NIL_LIT,
};

/**
 * Multi-character operators in **longest-first** order. The tokenizer must
 * match against this list before single characters. The `<<` / `>>` are
 * absent on purpose: FC lexes them as two `LBRACK` (`{`) / `RBRACK` (`}`)
 * shifts of the *assignment* operators `<<=` and `>>=`.
 */
export const OPERATORS: ReadonlyArray<readonly [string, TokenId]> = [
  // multi-char, longest first
  ["<<=", TokenId.LSHIFT_ASSIGN],
  [">>=", TokenId.RSHIFT_ASSIGN],
  ["++", TokenId.PLUS_PLUS],
  ["--", TokenId.MINUS_MINUS],
  [":=", TokenId.DECLARE_ASSIGN],
  ["||", TokenId.LOGICAL_OR],
  ["&&", TokenId.LOGICAL_AND],
  ["==", TokenId.EQUALS],
  ["!=", TokenId.NOT_EQUALS],
  ["<=", TokenId.LESS_OR_EQUALS],
  [">=", TokenId.GREATER_OR_EQUALS],
  ["+=", TokenId.PLUS_ASSIGN],
  ["-=", TokenId.MINUS_ASSIGN],
  ["*=", TokenId.STAR_ASSIGN],
  ["/=", TokenId.DIV_ASSIGN],
  ["%=", TokenId.MOD_ASSIGN],
  ["&=", TokenId.AND_ASSIGN],
  ["^=", TokenId.XOR_ASSIGN],
  ["|=", TokenId.OR_ASSIGN],
] as const;

/**
 * Single-character punctuators and their token ids. Matched AFTER operators.
 */
export const PUNCTUATORS: Readonly<Record<string, TokenId>> = {
  // brackets
  "(": TokenId.L_PAREN,
  ")": TokenId.R_PAREN,
  "{": TokenId.L_CURLY,
  "}": TokenId.R_CURLY,
  "[": TokenId.L_BRACKET,
  "]": TokenId.R_BRACKET,

  // separators
  ",": TokenId.COMMA,
  ";": TokenId.SEMI,
  ":": TokenId.COLON,
  ".": TokenId.DOT,
  "#": TokenId.HASHTAG,

  // single-char ops
  "+": TokenId.PLUS,
  "-": TokenId.MINUS,
  "*": TokenId.STAR,
  "/": TokenId.DIV,
  "%": TokenId.MOD,
  "&": TokenId.AND,
  "|": TokenId.OR,
  "^": TokenId.XOR,
  "!": TokenId.EXCLAMATION,
  "~": TokenId.BIT_NOT,
  "=": TokenId.ASSIGN,
  "<": TokenId.LESS,
  ">": TokenId.GREATER,
};

/**
 * Token ids that carry no semantic payload (whitespace and comments).
 * `EOS` is deliberately absent. It is produced by ANTLR's parser-aware lexer
 * modes, not by this lossless source scanner; formatting derives line-break
 * facts from raw trivia instead of guessing a semicolon token here.
 */
export const TRIVIA_KINDS: ReadonlySet<TokenId> = new Set<TokenId>([
  TokenId.WS,
  TokenId.WS_NLSEMI,
  TokenId.COMMENT,
  TokenId.COMMENT_NLSEMI,
  TokenId.LINE_COMMENT,
  TokenId.LINE_COMMENT_NLSEMI,
  TokenId.TERMINATOR,
]);

/** True iff `id` is whitespace / comment trivia. */
export function isTrivia(id: TokenId): boolean {
  return TRIVIA_KINDS.has(id);
}

/** Look up the token id for `word`, falling back to `IDENTIFIER`. */
export function keywordKind(word: string): TokenId {
  return KEYWORDS[word] ?? TokenId.IDENTIFIER;
}
