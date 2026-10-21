# Phase 2D - File and Declaration Parsing

## Scope

Add a source-referential AST and parser for top-level imports and `.fcc` header declarations:
defines, aliases, enums, tuples, components, function signatures, event signatures, and declared
graphs. Parse `.fcg` imports and the graph declaration shell, retaining its body as a token span
until Phase 2E supplies graph-element and statement nodes. This phase adds neither formatting nor
import sorting.

## Improvement gate

### Precedent

The compiled Craftland extension parser is authoritative. An isolated audit ran `headerFile` for
every `.fcc` and `graphFile` for every `.fcg` in `Assets/Scripts`: all 165 current files parsed
with zero errors and consumed EOF. The existing Phase 2B source-referential AST/parser and Phase
2A statement-boundary model are the local precedent. The v2 formatter's import pre-pass is not
reused because it could delete declarations and emit undefined aliases.

### Alternatives

1. Parse imports with a separate line-based pass, then parse declarations. Rejected: it recreates
   the unsafe import rewrite split and loses comment/trivia ownership.
2. Parse every graph body now. Rejected: graph fields, statements, and control flow belong to
   Phase 2E; a partial body parser would manufacture unreliable nodes.
3. Parse one ordered file AST, with graph bodies represented by exact token spans until Phase 2E.
   Chosen: imports and declarations gain stable structural ownership now without pretending the
   graph body is understood.

### Ownership

`src/syntax/` owns discriminated declaration/import/file node contracts. `src/parser/` owns
grammar recognition and diagnostics. Import ordering and attached-comment movement stay out of
this phase; a later shared import subsystem consumes this ordered AST plus the lossless token
stream. No FC asset, schema, generated project symbol, or public package API is created.

### Cost

One linear cursor pass per file. Declaration body parsing is linear in its token span; temporary
graph-body spans avoid duplicate scanning. Full-corpus conformance remains an explicit test, not
an editor keystroke cost.

### Contracts first

`docs/GRAMMAR.md` and the compiled extension grammar govern accepted forms. Both import forms are
first-class nodes. Library-path aliases are mandatory; named `from` imports begin with one plain
identifier and have an optional alias. AST token ranges remain half-open indices into the original
lossless stream, so later import sorting can never cross a declaration boundary.

## Completion gate

Positive/negative fixtures cover each top-level declaration and decorator form, import aliases,
type-alias `&`/`|`, field defaults, signatures, and recovery. Every `.fcc` must parse with zero
diagnostics and consume EOF. `.fcg` must parse imports plus exactly one graph shell without
rewriting or claiming that its body is complete. `npm run ci` must pass.
