/**
 * Immutable document nodes shared by every FC printer.
 *
 * `line` is a space in flat mode and a newline in broken mode. `softline` is
 * empty in flat mode. `hardline` always breaks. `verbatim` preserves protected
 * source bytes, including its own line endings.
 *
 * @typedef {{ type: "text" | "verbatim", value: string, absolute?: boolean } |
 *   { type: "line" | "softline" | "hardline" } |
 *   { type: "concat", parts: readonly Doc[] } |
 *   { type: "group", contents: Doc, mode: "auto" | "always" | "never" } |
 *   { type: "indent", contents: Doc, levels: number } |
 *   { type: "ifBreak", broken: Doc, flat: Doc }} Doc
 */

export const line = Object.freeze({ type: "line" });
export const softline = Object.freeze({ type: "softline" });
export const hardline = Object.freeze({ type: "hardline" });

/** @param {string} value @returns {Doc} */
export function text(value) {
  return { type: "text", value };
}

/** @param {string} value @returns {Doc} */
export function verbatim(value, absolute = false) {
  return { type: "verbatim", value, absolute };
}

/** @param {...Doc} parts @returns {Doc} */
export function concat(...parts) {
  return { type: "concat", parts };
}

/** @param {Doc} contents @param {"auto" | "always" | "never"} [mode] @returns {Doc} */
export function group(contents, mode = "auto") {
  return { type: "group", contents, mode };
}

/** @param {Doc} contents @param {number} [levels] @returns {Doc} */
export function indent(contents, levels = 1) {
  return { type: "indent", contents, levels };
}

/** @param {Doc} broken @param {Doc} [flat] @returns {Doc} */
export function ifBreak(broken, flat = text("")) {
  return { type: "ifBreak", broken, flat };
}
