# Phase 2B - type and expression parser

## Scope

Implement the internal recursive-descent parser kernel, typed syntax nodes, `domainType`, FC type
forms, and expression precedence/postfix productions. This phase does not parse files,
declarations, statement blocks, composites, imports, or perform formatting.

## Improvement gate

### Precedent

`tools/fc-format/src` establishes a broad token-to-structure-to-print flow, while v2 provides
only regression inputs. The authoritative parser behavior is the installed Craftland extension's
compiled `FCGParser`: `expression`, `domainType`, `type_`, `listT`, `mapT`, `entityT`, and
`anonFuncHeaderDecl`. The extension probes performed during this phase pin `as` binding and the
ambiguous generic-access cases in unit tests.

### Alternatives

1. Reuse v2 classifier heuristics - rejected: they created generic/comparison spacing regressions.
2. Parse expressions but store untyped delimiter spans - rejected: printer and linter would have
   to rediscover node intent.
3. Use lossless tokens plus discriminated, source-referential AST nodes - chosen. The parser
   resolves grammatical context once and leaves literal/comment bytes owned by the lexer.

### Ownership

`src/syntax/nodes.ts` owns internal AST shapes; `src/parser/` owns cursor, diagnostics, and
productions. `src/lex/` owns tokens/trivia; no parser node rewrites source text. Package-root
exports remain empty until a stable public API is explicitly approved.

### Cost model

The cursor builds one O(n) significant-token index. Parsing each expression/type is linear in its
token range; generic-access speculation restores an O(1) cursor/diagnostic checkpoint and is
bounded by its candidate span. Full-file parsing is intentionally deferred to Phase 2D/2E.

### Contracts-first

`docs/GRAMMAR.md` is corrected to match verified extension behavior: `domainType` has an optional
qualifier, casts use `domainType`, and only `List`/`Map`/`entity` are generic *types*. Generic
postfix access is an expression production. The fixed project formatting profile remains outside
this parser.

## Verification

Unit tests cover nested generic types, function-point types, all current precedence-sensitive
operators, shifts, casts, postfix chains, `out var`, ambiguity pins, diagnostics, and consumption.
`npm run verify:eos` remains the separate extension differential gate; `npm run ci` typechecks,
tests, and builds without requiring the editor extension.
