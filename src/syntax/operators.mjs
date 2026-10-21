/** FC operator spellings shared by structural validation and layout. */
export const ASSIGNMENT_OPERATORS = new Set([
  "=", ":=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=",
]);

export const BINARY_OPERATORS = new Set([
  "+", "-", "*", "/", "%", "&", "|", "^", "&&", "||", "==", "!=",
  "<", ">", "<=", ">=", "as", "in",
]);

export const PREFIX_OPERATORS = new Set(["+", "-", "!", "~"]);
export const UPDATE_OPERATORS = new Set(["++", "--"]);
export const PREFIX_CONTEXTS = new Set([
  ...ASSIGNMENT_OPERATORS, ...BINARY_OPERATORS, ...PREFIX_OPERATORS,
  "return", "(", "[", "{", ",", ":",
]);
