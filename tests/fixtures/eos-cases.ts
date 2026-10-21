export interface EosCase {
  readonly expectedVirtualEosText: readonly string[];
  readonly name: string;
  readonly source: string;
}

/** Cases pinned against the extension's FCGLexer NLSEMI behavior. */
export const EOS_CASES: readonly EosCase[] = [
  { name: "identifier", source: "value\nnext", expectedVirtualEosText: ["\n"] },
  { name: "return keyword", source: "return\nvalue", expectedVirtualEosText: ["\n"] },
  { name: "literal", source: "42\nnext", expectedVirtualEosText: ["\n"] },
  { name: "closing delimiters", source: "call()\nnext\n]\n}\nnext", expectedVirtualEosText: ["\n", "\n", "\n", "\n"] },
  { name: "postfix increment", source: "count++\nnext", expectedVirtualEosText: ["\n"] },
  { name: "type keyword", source: "List\nnext", expectedVirtualEosText: ["\n"] },
  { name: "generic close", source: "List<int>\nnext", expectedVirtualEosText: ["\n"] },
  { name: "operator continuation", source: "left +\nright", expectedVirtualEosText: [] },
  { name: "comparison open", source: "left <\nright", expectedVirtualEosText: [] },
  { name: "comma continuation", source: "call(\nleft,\nright\n)", expectedVirtualEosText: ["\n"] },
  { name: "ordinary whitespace before newline", source: "value \n  next", expectedVirtualEosText: ["\n"] },
  { name: "CRLF", source: "value\r\nnext", expectedVirtualEosText: ["\r\n"] },
  { name: "consecutive blank lines", source: "value\n\nnext", expectedVirtualEosText: ["\n\n"] },
  { name: "line comment", source: "value // comment\nnext", expectedVirtualEosText: ["\n"] },
  { name: "multiline block comment", source: "value /* before\n after */ next", expectedVirtualEosText: ["/* before\n after */"] },
  { name: "comment after a boundary", source: "value\n// comment\nnext", expectedVirtualEosText: ["\n"] },
  { name: "explicit semicolon", source: "value;\nnext", expectedVirtualEosText: [] },
];
