/**
 * @fileoverview Type grammar productions and parameter parsing shared by
 * declaration headers and function-pointer type boundaries in Craftland FC.
 */

/** @typedef {import("../types/ast.d.ts").Token} Token */

/** Built-in primitive and math scalar types in FC. */
export const SCALAR_TYPES = new Set([
  "object",
  "bool",
  "int",
  "int64",
  "float",
  "string",
  "Vector2",
  "Vector3",
  "Quaternion",
  "LocString",
  "Color",
  "Type",
  "entity",
]);

/** Token kinds accepted as domain, type, or parameter identifiers. */
const NAME_KINDS = new Set([
  "IDENTIFIER",
  "ELEMENT",
  "FROM",
  "TYPE",
  "COLOR",
  "LIST",
  "MAP",
  "ENTITY",
]);

/**
 * Check whether a token qualifies as an identifier or contextual domain name.
 *
 * @param {Token | undefined} token
 * @returns {boolean}
 */
export function isName(token) {
  return Boolean(token && NAME_KINDS.has(token.kind));
}

/**
 * Test whether a token can syntactically begin an FC type specification.
 *
 * @param {Token | undefined} token
 * @returns {boolean}
 */
export function isTypeStart(token) {
  if (!token) {
    return false;
  }

  return (
    isName(token) ||
    SCALAR_TYPES.has(token.text) ||
    token.text === "List" ||
    token.text === "Map" ||
    token.text === "func"
  );
}

/**
 * Callback function to report syntactic type errors.
 * @callback FailCallback
 * @param {string} code - Machine-readable error code.
 * @param {string} message - Human-readable diagnostic description.
 * @param {Token} [token] - Offending token.
 */

/**
 * Parse an FC type specification starting at the given token cursor index.
 *
 * Handles:
 * - Simple scalar types: `int`, `string`, `bool`, etc.
 * - Qualified types: `Domain.Type`, `Package.SubPackage.Type`
 * - Generic types: `List<T>`, `Map<K, V>`, `entity<Component>`
 * - Function pointer types: `func(param1 Type, out var param2 Type) ReturnType`
 *
 * @param {readonly Token[]} tokens - Stream of syntax tokens.
 * @param {number} index - Starting token index.
 * @param {FailCallback} fail - Failure callback for grammar errors.
 * @returns {number} The next unconsumed token index.
 */
export function readType(tokens, index, fail) {
  const first = tokens[index];

  if (!isTypeStart(first)) {
    fail("expected-type", "Expected an FC type.", first);
    return index;
  }

  let name = first.text;
  index += 1;

  // Handle dot-qualified type paths (e.g. Domain.CustomType)
  while (tokens[index]?.text === ".") {
    const next = tokens[index + 1];

    if (!isTypeStart(next) || next.text === "func") {
      fail("expected-type", "Expected a type after its domain.", next);
      return index;
    }

    name = next.text;
    index += 2;
  }

  // Handle function pointer types: func(...) [ReturnType]
  if (name === "func") {
    if (tokens[index]?.text !== "(") {
      fail("expected-signature", "Function types require a parameter list.", tokens[index]);
      return index;
    }

    index = readParameters(tokens, index, fail);

    // Optional return type following parameter signature
    if (isTypeStart(tokens[index])) {
      index = readType(tokens, index, fail);
    }

    return index;
  }

  // Handle generic collections: List<T>, Map<K, V>, entity<T>
  const isGeneric = ["List", "Map"].includes(name) || (name === "entity" && tokens[index]?.text === "<");

  if (isGeneric) {
    if (tokens[index]?.text !== "<") {
      fail("expected-type-arguments", `${name} requires type arguments.`, tokens[index]);
      return index;
    }

    index += 1;
    const argumentCount = name === "Map" ? 2 : 1;

    for (let argumentIndex = 0; argumentIndex < argumentCount; argumentIndex += 1) {
      if (argumentIndex > 0) {
        if (tokens[index]?.text !== ",") {
          fail("type-argument-count", `${name} requires ${argumentCount} type arguments.`, tokens[index]);
          return index;
        }

        index += 1;
      }

      const nextIndex = readType(tokens, index, fail);

      if (nextIndex === index) {
        return index;
      }

      index = nextIndex;
    }

    if (tokens[index]?.text !== ">") {
      fail("type-argument-count", `Unexpected or missing type argument in ${name}.`, tokens[index]);
      return index;
    }

    index += 1;
  }

  return index;
}

/**
 * Parse a parameter list enclosed in parentheses `(...)`.
 * Shared by function declarations, listener declarations, and `func(...)` function pointer types.
 *
 * @param {readonly Token[]} tokens - Stream of syntax tokens.
 * @param {number} index - Index pointing to the opening '(' token.
 * @param {FailCallback} fail - Failure callback for grammar errors.
 * @returns {number} The next unconsumed token index following the closing ')'.
 */
export function readParameters(tokens, index, fail) {
  index += 1; // Consume opening '('

  while (tokens[index] && tokens[index].text !== ")") {
    // Check for output parameter qualifier: out var <name> <Type>
    if (tokens[index].text === "out") {
      index += 1;

      if (tokens[index]?.text !== "var") {
        fail("expected-out-var", "Out parameters require 'out var'.", tokens[index]);
        return index;
      }

      index += 1;
    }

    // Parameter identifier name
    if (!isName(tokens[index])) {
      fail("expected-parameter", "A parameter requires a name and type.", tokens[index]);
      return index;
    }

    index += 1;

    // Parameter type specification
    const nextIndex = readType(tokens, index, fail);

    if (nextIndex === index) {
      return index;
    }

    index = nextIndex;

    // Closing parenthesis means we finished the parameter list
    if (tokens[index]?.text === ")") {
      break;
    }

    // Multiple parameters must be comma-separated
    if (tokens[index]?.text !== ",") {
      fail("expected-parameter-separator", "Expected ',' between parameters.", tokens[index]);
      return index;
    }

    index += 1;

    // Trailing comma before ')' is forbidden in FC parameter signatures
    if (tokens[index]?.text === ")") {
      fail("invalid-trailing-comma", "Parameters do not allow a trailing comma.", tokens[index]);
      return index;
    }
  }

  if (tokens[index]?.text !== ")") {
    fail("unclosed-signature", "Expected ')' after parameters.", tokens[index]);
    return index;
  }

  return index + 1;
}
