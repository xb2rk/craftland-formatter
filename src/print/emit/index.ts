/**
 * @module print/emit/index - convert the ordered delimiter tree into the pure Doc algebra.
 */

import { TokenId } from "../../lex/grammar.generated.js";
import type { Config } from "../../format/config.js";
import { concat, group, hardline, ifBreak, indent, line, nil, softline, text, type Doc } from "../doc.js";
import { isNode, type Content, DelimKind, type Node } from "../../syntax/classifier.js";
import type { Enclosure } from "../../syntax/spacing.js";
import type { Trivia } from "../../lex/items.js";
import { closeParts, enclosureOf, hasBlankLine, hasDirectContent, hasTrailingComma, isIndexNode } from "./helpers.js";
import { hasComment, renderTrivia } from "./trivia.js";
import { appendItem, type SequenceState } from "./state.js";
import { resolveWrap } from "./wrap.js";

/**
 * Walk a content array, delegating nodes to `renderNode` and items to `appendItem`.
 *
 * @param content - entries to render.
 * @param state - mutable accumulator.
 * @param config - formatter config.
 * @param omitTrailingComma - whether to drop a trailing comma item.
 * @returns concatenated doc.
 */
function renderSequence(
  content: readonly Content[],
  state: SequenceState,
  config: Config,
  omitTrailingComma = false,
): Doc {
  for (let index = 0; index < content.length; index += 1) {
    const entry = content[index]!;
    if (omitTrailingComma && index === content.length - 1 && !isNode(entry) && entry.token.kind === TokenId.COMMA) {
      const trivia = renderTrivia(entry.before);
      if (trivia.forcesBreak || trivia.leadingSpaceNeeded) {
        state.parts.push(trivia.doc);
      }
      continue;
    }
    if (isNode(entry)) {
      renderNode(entry, state, config);
      continue;
    }
    appendItem(state, entry, config, undefined, content.slice(index + 1));
    if (state.mode === "delimited" && entry.token.kind === TokenId.COMMA) {
      const isTrailing = content.at(-1) === entry;
      if (!isTrailing) {
        state.parts.push(config.spaceAfterComma ? line : softline);
        state.suppressNextSpace = true;
      }
    }
  }
  return concat(state.parts);
}

/**
 * Render a delimited node (paren/bracket/brace) with wrapping and inside-space policy.
 *
 * @param node - delimiter node.
 * @param prefix - already-rendered opening token doc.
 * @param state - parent state (unused beyond enclosure propagation).
 * @param config - formatter config.
 * @param enclosure - enclosure kind.
 * @returns doc.
 */
function renderDelimited(node: Node, prefix: Doc, state: SequenceState, config: Config, enclosure: Enclosure): Doc {
  const hasContent = hasDirectContent(node);
  const close = closeParts(node.close);
  const { flatRequired, wrapMode, leadingBreak, trailingBreak, trailing } = resolveWrap(node, config, enclosure);
  if (!hasContent || !node.close) {
    const innerState: SequenceState = {
      parts: [],
      last: node.open,
      mode: "flat",
      enclosure,
      genericDepth: 0,
      suppressFirstBreak: true,
      // Flat data uses explicit boundary spaces below; do not let the generic
      // spacing policy add a second one after the opening brace.
      suppressOpeningSpace: true,
      suppressNextSpace: false,
      hasLogical: false,
    };
    const inner = renderSequence(node.content, innerState, config, flatRequired);
    return concat([prefix, inner, close.trivia.doc, close.token]);
  }

  const innerState: SequenceState = {
    parts: [],
    last: node.open,
    mode: flatRequired ? "flat" : "delimited",
    enclosure,
    genericDepth: 0,
    suppressFirstBreak: true,
    // Flat spacing is expressed with ifBreak below so a broken group does not
    // leave a stray space after its opening delimiter.
    suppressOpeningSpace: true,
    suppressNextSpace: false,
    hasLogical: false,
  };
  // Normalize trailing commas: flat never keeps `,}` / `,)`; broken respects `trailingComma`.
  // For CALL, assignment (var/return) never has trailing even when broken; bare CALL follows trailingComma.
  const omitTrailing =
    flatRequired ||
    (hasTrailingComma(node) && !flatRequired && (enclosure === "brace" || enclosure === "bracket" || enclosure === "paren"));
  const inner = renderSequence(node.content, innerState, config, omitTrailing);
  const wantsInsideSpace = (enclosure === "brace" && config.spaceInsideBraces) ||
    (enclosure === "paren" && config.spaceInsideParens) ||
    (enclosure === "bracket" && config.spaceInsideBrackets);
  // A grouped layout needs the space only in flat mode; an ungrouped flat
  // layout (signatures, conditions, value calls, or `wrap: never`) has no
  // enclosing group whose mode could resolve `ifBreak`, so use a plain text
  // node for that path below.
  const openSpace = wantsInsideSpace ? ifBreak(text(" "), nil) : nil;
  const flatInsideSpace = wantsInsideSpace ? text(" ") : nil;
  const closeSpace = openSpace;
  const closeLeadingSpace = close.trivia.leadingSpaceNeeded ? text(" ") : nil;
  const closeLeadingBreak = close.trivia.leadingBreak && hasComment(node.close?.before ?? []) ? hardline : nil;
  const closeTrivia = concat([closeLeadingBreak, closeLeadingSpace, close.trivia.doc]);
  // Avoid double blank line when the first element already starts with a leading
  // comment on its own line (`{ // comment`): the comment trivia already emits
  // a hardline, so the group's leadingBreak would duplicate it.
  let effectiveLeadingBreak = leadingBreak;
  const firstEntry = node.content[0];
  if (firstEntry && !isNode(firstEntry) && hasComment(firstEntry.before)) {
    const firstTrivia = renderTrivia(firstEntry.before);
    if (firstTrivia.leadingBreak || firstTrivia.forcesBreak) {
      effectiveLeadingBreak = nil;
    }
  }
  const layout = concat([
    prefix,
    group(
      concat([
        indent(concat([effectiveLeadingBreak, openSpace, inner, trailing, closeSpace, closeTrivia])),
        close.trivia.forcesBreak ? nil : trailingBreak,
        close.token,
      ]),
    ),
  ]);
  if (wrapMode === "never") {
    return concat([prefix, flatInsideSpace, inner, trailing, flatInsideSpace, closeTrivia, close.token]);
  }
  return layout;
}

/**
 * Render a single delimiter node into its parent's accumulator.
 *
 * @param node - node to render.
 * @param parentState - parent accumulator (provides `last` for spacing of the opening token).
 * @param config - formatter config.
 */
function renderNode(node: Node, parentState: SequenceState, config: Config): void {
  if (!node.open) {
    return;
  }
  const prefixState: SequenceState = {
    parts: [],
    last: parentState.last,
    mode: parentState.mode,
    enclosure: parentState.enclosure,
    genericDepth: parentState.genericDepth,
    suppressFirstBreak: parentState.suppressFirstBreak,
    suppressOpeningSpace: false,
    suppressNextSpace: parentState.suppressNextSpace,
    hasLogical: false,
  };
  const enclosure = enclosureOf(node.kind);
  appendItem(prefixState, node.open, config, enclosure);
  const rawPrefix = concat(prefixState.parts);
  // Header conditions like `if a || b || c {` use after-style `a ||\n  b` with indent.
  // Wrap the whole header when it contains `||`/`&&` so softline after `||` breaks indented.
  const prefix = prefixState.hasLogical ? group(indent(rawPrefix)) : rawPrefix;

  let doc: Doc;
  if (node.kind === DelimKind.Block) {
    const innerState: SequenceState = {
      parts: [],
      last: node.open,
      mode: "block",
      enclosure: "block",
      genericDepth: 0,
      suppressFirstBreak: true,
      suppressOpeningSpace: false,
      suppressNextSpace: false,
      hasLogical: false,
    };
    const inner = renderSequence(node.content, innerState, config);
    const close = closeParts(node.close);
    const closeLeadingSpace = close.trivia.leadingSpaceNeeded ? text(" ") : nil;
    const closeLeadingBreak = close.trivia.leadingBreak && hasComment(node.close?.before ?? []) ? hardline : nil;
    const innerWithCloseTrivia = concat([inner, closeLeadingBreak, closeLeadingSpace, close.trivia.doc]);
    doc = node.close
      ? concat([
        prefix,
        indent(concat([hardline, innerWithCloseTrivia])),
        close.trivia.forcesBreak ? nil : hardline,
        close.token,
      ])
      : concat([prefix, hardline, indent(inner)]);
  } else if (isIndexNode(node)) {
      const innerState: SequenceState = {
        parts: [],
        last: node.open,
        mode: "flat",
        enclosure: "bracket",
        genericDepth: 0,
        suppressFirstBreak: true,
        suppressOpeningSpace: true,
        suppressNextSpace: false,
        hasLogical: false,
      };
      const inner = renderSequence(node.content, innerState, config);
      const close = closeParts(node.close);
      const wantsInside = config.spaceInsideBrackets;
      const hasCommentTrivia = node.content.some((entry) => !isNode(entry) && hasComment(entry.before));
      const flatInsideSpace = wantsInside && !hasCommentTrivia ? text(" ") : nil;
      const closeLeadingSpace = close.trivia.leadingSpaceNeeded ? text(" ") : nil;
      const closeLeadingBreak = close.trivia.leadingBreak && hasComment(node.close?.before ?? []) ? hardline : nil;
      doc = concat([prefix, flatInsideSpace, inner, flatInsideSpace, closeLeadingBreak, closeLeadingSpace, close.trivia.doc, close.token]);
  } else {
    doc = renderDelimited(node, prefix, prefixState, config, enclosure);
  }

  parentState.parts.push(doc);
  parentState.beforeLast = parentState.last;
  parentState.last = node.close ?? node.open;
  parentState.genericDepth = prefixState.genericDepth;
  parentState.suppressFirstBreak = false;
  parentState.suppressOpeningSpace = false;
  parentState.suppressNextSpace = false;
}

/**
 * Render trailing trivia after the root (e.g. final comments/newlines).
 *
 * Unlike leading trivia on an item, trailing trivia has no `appendItem`
 * hardline insertion. If the original source placed the trailing comment
 * on a new line (`leadingBreak`) or with a blank line, we must emit that
 * break explicitly; otherwise `body` and `/**` fuse into `StdLibrary/**`.
 *
 * @param trivia - trailing trivia.
 * @param hasBody - whether the file has body content before the trailing trivia.
 * @returns doc.
 */
function renderTrailingTrivia(trivia: readonly Trivia[], hasBody: boolean): Doc {
  const rendered = renderTrivia(trivia);
  if (!hasBody) {
    return rendered.doc;
  }
  // Mirror `appendItem`'s leading-break logic for trailing context.
  if (rendered.leadingBreak) {
    const leading = hasBlankLine(trivia) ? concat([hardline, hardline]) : hardline;
    return concat([leading, rendered.doc]);
  }
  if (rendered.leadingSpaceNeeded) {
    return concat([text(" "), rendered.doc]);
  }
  return rendered.doc;
}

/**
 * Build a Doc from a classified root (or a root-content array for callers).
 *
 * @param root - classified root or array of nodes.
 * @param config - formatter config.
 * @returns doc.
 */
export function emit(root: Node | readonly Node[], config: Config): Doc {
  const document: Node = Array.isArray(root)
    ? { kind: DelimKind.Root, content: root as Node[] }
    : root as Node;
  const state: SequenceState = {
    parts: [],
    mode: "root",
    genericDepth: 0,
    suppressFirstBreak: true,
    suppressOpeningSpace: false,
    suppressNextSpace: false,
    hasLogical: false,
  };
  const body = renderSequence(document.content, state, config);
  const hasBody = state.parts.length > 0 || document.content.length > 0;
  return concat([body, document.trailingTrivia ? renderTrailingTrivia(document.trailingTrivia, hasBody) : nil]);
}
