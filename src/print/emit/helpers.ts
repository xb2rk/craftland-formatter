/**
 * @module print/emit/helpers - pure helpers shared by the emitter.
 */

import { TokenId } from "../../lex/grammar.generated.js";
import { isNode, type Content, DelimKind, type Node } from "../../syntax/classifier.js";
import type { Item, Trivia } from "../../lex/items.js";
import { concat, nil, text, type Doc } from "../doc.js";
import type { Enclosure } from "../../syntax/spacing.js";
import { hasComment, renderTrivia } from "./trivia.js";
import type { TriviaDoc } from "./trivia.js";

/** Token kinds that behave like type names (affects generic detection). */
export const TYPE_LIKE_KINDS: ReadonlySet<TokenId> = new Set<TokenId>([
  TokenId.OBJECT,
  TokenId.TYPE,
  TokenId.BOOL,
  TokenId.INT,
  TokenId.INT64,
  TokenId.FLOAT,
  TokenId.STRING,
  TokenId.COLOR,
  TokenId.VECTOR2,
  TokenId.VECTOR3,
  TokenId.QUATERNION,
  TokenId.LIST,
  TokenId.MAP,
  TokenId.LOC_STRING,
  TokenId.ENTITY,
]);

/** Token kinds that may precede an index bracket `[...]`. */
export const INDEX_PRECEDER_KINDS: ReadonlySet<TokenId> = new Set<TokenId>([
  TokenId.IDENTIFIER,
  TokenId.R_PAREN,
  TokenId.R_BRACKET,
  TokenId.R_CURLY,
]);

/** Token kinds that may hold a generic `entity < Type >` (FC cast/get). */
const ENTITY_GENERIC_HOLDER_KINDS: ReadonlySet<TokenId> = new Set<TokenId>([
  TokenId.IDENTIFIER,
  TokenId.THISENTITY,
  TokenId.GLOBALENTITY,
  TokenId.ENTITY,
  TokenId.R_PAREN,
  TokenId.R_BRACKET,
  TokenId.R_CURLY,
]);

/**
 * Check if an item is a type name (builtin or capitalized identifier).
 *
 * @param item - item to test.
 * @returns true for type-like names.
 */
export function isTypeName(item: Item): boolean {
  return (
    TYPE_LIKE_KINDS.has(item.token.kind) ||
    (item.token.kind === TokenId.IDENTIFIER && /^[A-Z]/u.test(item.token.text))
  );
}

/**
 * Scan forward to determine if a `<` has a matching `>` that closes a generic.
 *
 * @param lookahead - remaining content after `<`.
 * @returns true if a generic close exists.
 */
export function hasGenericClose(lookahead: readonly Content[]): boolean {
  let sawType = false;
  let nested = 0;
  for (const entry of lookahead) {
    if (isNode(entry)) {
      continue;
    }
    // Logical `&&` / `||` before `>` means `<` is a comparison (e.g. `if a < B && c >= d {`), not `a<B>`.
    if ((entry.token.kind === TokenId.LOGICAL_AND || entry.token.kind === TokenId.LOGICAL_OR) && nested === 0) {
      return false;
    }
    if (entry.token.kind === TokenId.LESS) {
      if (!sawType && nested === 0) {
        return false;
      }
      nested += 1;
      continue;
    }
    if (entry.token.kind === TokenId.GREATER) {
      if (!sawType && nested === 0) {
        return false;
      }
      if (nested === 0) {
        return true;
      }
      nested -= 1;
      continue;
    }
    if (entry.token.kind === TokenId.GREATER_OR_EQUALS) {
      // `>=` without space after `>` generic close (e.g. `List<int>=`) would be
      // lexed as `>=`. Treat as `>` for generic detection, the `=` is assignment.
      if (!sawType && nested === 0) {
        return false;
      }
      if (nested === 0) {
        return true;
      }
      nested -= 1;
      continue;
    }
    if (entry.token.kind === TokenId.COMMA && nested === 0) {
      continue;
    }
    if (entry.token.kind === TokenId.RSHIFT_ASSIGN || entry.token.kind === TokenId.LSHIFT_ASSIGN) {
      // `>>=` / `<<=` never appear in type args.
      return false;
    }
    if (!sawType) {
      if (!isTypeName(entry)) {
        return false;
      }
      sawType = true;
      continue;
    }
    // After seeing a type, only generics-relevant tokens are allowed before `>`.
    // `ki < List.Length(...)` must stay a comparison, not `ki<List.Length...>` generic.
    // Any `.`, `(` , `)` , `=` , operator etc. before `>` means `<` is comparison.
    const kind = (entry as Item).token.kind as TokenId;
    if (
      kind !== TokenId.COMMA &&
      kind !== TokenId.LESS &&
      kind !== TokenId.GREATER &&
      kind !== TokenId.GREATER_OR_EQUALS &&
      kind !== TokenId.RSHIFT_ASSIGN &&
      kind !== TokenId.LSHIFT_ASSIGN &&
      !isTypeName(entry as Item)
    ) {
      return false;
    }
    // Do not fail on line breaks inside generics (e.g. `Map<string,\n  object>`).
    // Keep scanning for the closing `>`.
  }
  return false;
}

/**
 * Check if a `<` is a generic opening rather than less-than.
 *
 * Covers `Type<`, `Capital<...>` and `entity < ComponentType >` (FC `entity < Comp >`
 * cast/get pattern) such as `spawned < PlantEntityScript >.Set`, `thisEntity < UIPlantInfo >`,
 * `player < Player >.UserUID`. The latter would otherwise be mis-spaced as a comparison.
 *
 * @param last - previous significant item.
 * @param item - current item (`<` candidate).
 * @param lookahead - remaining content after `<`.
 * @returns true for generic open.
 */
export function isGenericOpen(last: Item | undefined, item: Item, lookahead: readonly Content[] = []): boolean {
  if (item.token.kind !== TokenId.LESS || !last) {
    return false;
  }
  if (TYPE_LIKE_KINDS.has(last.token.kind)) {
    return hasGenericClose(lookahead);
  }
  // Any identifier / entity keyword followed by `< Type ... >` with a matching close.
  // This captures `spawned < PlantEntityScript >`, `thisEntity < CustomUI >`,
  // `player < Player >`, etc. where the holder is a lowercase variable/entity.
  if (ENTITY_GENERIC_HOLDER_KINDS.has(last.token.kind) && hasGenericClose(lookahead)) {
    return true;
  }
  return last.token.kind === TokenId.IDENTIFIER && /^[A-Z]/u.test(last.token.text) && hasGenericClose(lookahead);
}

/**
 * Check if a bracket node is an index (`arr[0]`) vs a literal (`[1,2]`).
 *
 * @param node - bracket node to test.
 * @returns true if it is an index access.
 */
export function isIndexNode(node: Node): boolean {
  if (node.kind !== DelimKind.Bracket) {
    return false;
  }
  if (!node.parent) {
    return false;
  }
  const index = node.parent.content.indexOf(node);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const entry = node.parent.content[cursor]!;
    if (isNode(entry)) {
      const token = entry.close ?? entry.open;
      if (!token) {
        continue;
      }
      return INDEX_PRECEDER_KINDS.has(token.token.kind);
    }
    if (entry.token.kind === TokenId.DOT) {
      continue;
    }
    return INDEX_PRECEDER_KINDS.has(entry.token.kind);
  }
  return false;
}

/**
 * Check if a node has non-comma content.
 *
 * @param node - node to test.
 * @returns true if it contains a token or nested node beyond commas.
 */
export function hasDirectContent(node: Node): boolean {
  return node.content.some((entry) => isNode(entry) || entry.token.kind !== TokenId.COMMA);
}

/**
 * Check if a node contains a top-level comma.
 *
 * @param node - node to test.
 * @returns true if any direct child is `,`.
 */
export function hasComma(node: Node): boolean {
  return node.content.some((entry) => !isNode(entry) && entry.token.kind === TokenId.COMMA);
}

/**
 * Check if a node ends with a trailing comma.
 *
 * @param node - node to test.
 * @returns true if the last direct child is `,`.
 */
export function hasTrailingComma(node: Node): boolean {
  const last = node.content.at(-1);
  return Boolean(last && !isNode(last) && last.token.kind === TokenId.COMMA);
}

/**
 * Check if trivia contains a blank line (two newlines with optional indentation, CRLF-aware).
 *
 * @param trivia - trivia slice.
 * @returns true if any token contains a blank line.
 */
export function hasBlankLine(trivia: readonly Trivia[]): boolean {
  return trivia.some((entry) => /\r?\n[ \t]*\r?\n/u.test(entry.token.text));
}

/**
 * Map a delimiter kind to its `Enclosure` for spacing inside-space knobs.
 *
 * @param kind - delimiter kind.
 * @returns enclosure.
 */
export function enclosureOf(kind: DelimKind): Enclosure {
  if (kind === DelimKind.Block) {
    return "block";
  }
  if (kind === DelimKind.Paren) {
    return "paren";
  }
  if (kind === DelimKind.Bracket) {
    return "bracket";
  }
  return "brace";
}

/**
 * Build trivia + token docs for a closing delimiter.
 *
 * @param close - closing item or undefined for unclosed nodes.
 * @returns trivia and token docs.
 */
export function closeParts(close: Item | undefined): { trivia: TriviaDoc; token: Doc } {
  if (!close) {
    return {
      trivia: { doc: nil, forcesBreak: false, leadingBreak: false, leadingSpaceNeeded: false },
      token: nil,
    };
  }
  return { trivia: renderTrivia(close.before), token: text(close.token.text) };
}

export { hasComment };
