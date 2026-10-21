/**
 * @module syntax/classifier - delimiter tree shared by formatting and linting.
 *
 * `content` deliberately interleaves tokens and nested nodes in source order.
 * Keeping separate `items` and `children` arrays would make it impossible to
 * reconstruct or safely print nested calls/composites without positional bugs.
 */

import { TokenId } from "../lex/grammar.generated.js";
import type { Item, LexedDocument, Trivia } from "../lex/items.js";
import { findTopLevelSeparator, isBlockOpen } from "./query.js";

/**
 * Delimiter kind for `Node`.
 * - Root: synthetic top-level container.
 * - Paren/Bracket/Block: `( )`, `[ ]`, `{ }` blocks that are scopes.
 * - Data/Struct/Map: `{ }` composites classified in `finalize` (see `classifyCurly`).
 */
export enum DelimKind {
  /** Synthetic root. */
  Root = "root",
  /** Parenthesized enclosure `(...)`. */
  Paren = "paren",
  /** Bracket enclosure `[...]`. */
  Bracket = "bracket",
  /** Block scope `{...}` (func/graph/if/for etc). */
  Block = "block",
  /** Generic data composite `{...}` (no `:` or `=`). */
  Data = "data",
  /** Struct-style composite `{ field = value }`. */
  Struct = "struct",
  /** Map-style composite `{ key: value }`. */
  Map = "map",
}

export type Content = Item | Node;

export interface Node {
  /** Delimiter kind (root/blocks/composites). */
  kind: DelimKind;
  /** Opening token; absent only for the synthetic root. */
  open?: Item;
  /** Closing token; undefined for malformed, unclosed source enclosure. */
  close?: Item;
  /** Source-ordered direct children (tokens and nested nodes). */
  content: Content[];
  /** Parent node; undefined for root. */
  parent?: Node;
  /** Root-only trivia after the final significant token. */
  trailingTrivia?: readonly Trivia[];
}

/**
 * Type guard for `Node`.
 *
 * @param content - content entry to test.
 * @returns true if entry is a delimiter node.
 */
export function isNode(content: Content): content is Node {
  return "content" in content;
}

/**
 * Expected closing token for an opening delimiter.
 *
 * @param kind - opening token kind.
 * @returns matching closing kind or undefined.
 */
function expectedClose(kind: TokenId): TokenId | undefined {
  switch (kind) {
    case TokenId.L_PAREN: {
      return TokenId.R_PAREN;
    }
    case TokenId.L_BRACKET: {
      return TokenId.R_BRACKET;
    }
    case TokenId.L_CURLY: {
      return TokenId.R_CURLY;
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Initial delimiter kind from the opening token.
 *
 * @param item - opening item.
 * @returns `Paren`, `Bracket`, or provisional `Data` (curly refined later).
 */
function initialKind(item: Item): DelimKind {
  switch (item.token.kind) {
    case TokenId.L_PAREN: {
      return DelimKind.Paren;
    }
    case TokenId.L_BRACKET: {
      return DelimKind.Bracket;
    }
    default: {
      // Curly braces are initially `Data`; `finalize` reclassifies via `classifyCurly`.
      return DelimKind.Data;
    }
  }
}

/**
 * Classify a curly enclosure as block, map, struct, or data.
 *
 * @param node - curly node to classify.
 * @returns precise delimiter kind.
 */
function classifyCurly(node: Node): DelimKind {
  if (isBlockOpen(node)) {
    return DelimKind.Block;
  }
  if (findTopLevelSeparator(node, TokenId.COLON)) {
    return DelimKind.Map;
  }
  if (
    findTopLevelSeparator(node, TokenId.ASSIGN) ||
    findTopLevelSeparator(node, TokenId.DECLARE_ASSIGN)
  ) {
    return DelimKind.Struct;
  }
  return DelimKind.Data;
}

/**
 * Recursively finalize curly kinds bottom-up.
 *
 * @param node - node to finalize.
 */
function finalize(node: Node): void {
  for (const child of node.content) {
    if (isNode(child)) {
      finalize(child);
    }
  }
  if (node.open?.token.kind === TokenId.L_CURLY) {
    node.kind = classifyCurly(node);
  }
}

/**
 * Build a tolerant delimiter tree without discarding unmatched source tokens.
 *
 * @param document - partitioned document.
 * @returns root node with nested delimiter tree.
 */
export function classify(document: LexedDocument): Node {
  const root: Node = { kind: DelimKind.Root, content: [], trailingTrivia: document.trailingTrivia };
  const stack: Node[] = [root];

  for (const item of document.items) {
    const current = stack.at(-1)!;
    const close = expectedClose(item.token.kind);
    if (close !== undefined) {
      // Opening delimiter: push a new node onto the stack.
      const node: Node = { kind: initialKind(item), open: item, content: [], parent: current };
      current.content.push(node);
      stack.push(node);
      continue;
    }

    if (
      item.token.kind === TokenId.R_PAREN ||
      item.token.kind === TokenId.R_BRACKET ||
      item.token.kind === TokenId.R_CURLY
    ) {
      const candidate = stack.at(-1)!;
      if (candidate.open && expectedClose(candidate.open.token.kind) === item.token.kind) {
        // Matching close: pop the stack.
        candidate.close = item;
        stack.pop();
      } else {
        // Unmatched close: treat as a plain token.
        current.content.push(item);
      }
      continue;
    }

    current.content.push(item);
  }

  finalize(root);
  return root;
}
