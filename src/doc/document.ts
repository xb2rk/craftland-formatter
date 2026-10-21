/** Immutable layout document primitives used by the FC printer. */
export type Doc =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "line"; readonly hard: boolean }
  | { readonly kind: "concat"; readonly parts: readonly Doc[] }
  | { readonly kind: "indent"; readonly amount: number; readonly content: Doc }
  | { readonly kind: "group"; readonly content: Doc };

export const text = (value: string): Doc => ({ kind: "text", value });
export const line = (): Doc => ({ kind: "line", hard: false });
export const hardline = (): Doc => ({ kind: "line", hard: true });
export const indent = (amount: number, content: Doc): Doc => ({ kind: "indent", amount, content });
export const group = (content: Doc): Doc => ({ kind: "group", content });

export function concat(...parts: readonly (Doc | undefined)[]): Doc {
  const flattened: Doc[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (part.kind === "concat") flattened.push(...part.parts);
    else flattened.push(part);
  }
  return { kind: "concat", parts: flattened };
}

export function join(separator: Doc, parts: readonly Doc[]): Doc {
  const result: Doc[] = [];
  parts.forEach((part, index) => { if (index > 0) result.push(separator); result.push(part); });
  return concat(...result);
}
