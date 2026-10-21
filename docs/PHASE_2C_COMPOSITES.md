# Phase 2C - composite expressions

## Scope

Add typed AST nodes and parser productions for positional, map, struct, and `LocString`
composites. This phase remains parser-only: no alignment, wrapping, comma rewriting, declarations,
or graph statements.

## Improvement gate

### Precedent

The extension's `vectorV`, `listV`, `mapV`, `tupleV`, `locStrV`, `literalList`, and
`mapLiteralList` parser productions are authoritative. Corpus examples establish deeply nested
`Vector*`, `List`, `Map`, struct, and `LocString` values. v2's missing struct/map alignment is a
printer regression to avoid later, not a parser design to reuse.

### Alternatives

1. Infer composite kind while printing from brace text - rejected: repeats the known heuristic
   trap and cannot safely align map/struct columns.
2. One untyped brace node - rejected: loses the separator and `LocString` contracts.
3. Dedicated AST variants with entries/fields/separator token indices - chosen.

### Ownership and cost

`src/syntax/nodes.ts` owns composite node shapes; the type/expression parser owns structural
classification. The pass is linear in each composite token range. The future printer owns only
layout policy; protected source token ownership remains with `src/lex/`.

### Contracts-first

`LocString` is exactly `LocString{ key, listV }`: both values are required and the argument is a
bare or typed `List` composite. `entity<T>` is a type, not an entity composite value. Map entries
use `:`, struct fields use `=`, and trailing commas are retained as syntax facts for the fixed
formatter contract.

## Verification

Tests cover tagged/bare positional values, nested collections, map/struct separators and trailing
commas, `LocString`, missing `LocString` arguments, and the rejected entity-composite shape.
The whole parser still deliberately stops short of file/declaration parsing; corpus-wide parse
conformance remains the Phase 2E gate.
