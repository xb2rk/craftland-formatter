# Phase 2A - Statement-boundary foundation

## Scope

Phase 2A implements only the audited FC automatic-semicolon boundary model.
It creates no AST, recursive-descent productions, formatter layout, import
rewrite, public parser API, or FC source changes.

## Improvement gate

### Precedent

`FCGLexer` in the installed Craftland Studio extension (`1.10.1`) has an
`NLSEMI` lexer mode and emits `TERMINATOR`/`EOS`. The compiled bundle is the
authoritative executable evidence; `docs/GRAMMAR.md` documents the resulting
contract. The older formatter's newline heuristics are not reused.

### Alternatives

1. Treat every newline as a statement terminator. Rejected: it breaks operator,
   assignment, comma, and open-delimiter continuations.
2. Load the extension at formatter runtime. Rejected: bundle startup launches a
   language server, and an installed editor is not a formatter dependency.
3. Reproduce the observable lexer state machine over lossless tokens and
   continuously compare it against a test-only isolated lexer loader. Chosen.

### Ownership

`src/lex/` preserves source and emits no EOS. `src/parser/statement-boundary.ts`
owns virtual-boundary derivation. `tests/helpers/extension-lexer.ts` is test
only and safely bypasses the bundle's language-server entry. Parser productions
added later own whether a lexical boundary is valid in their grammar context.

### Cost model

Boundary derivation is O(n) in tokens and allocates only discovered boundaries.
The extension differential check is local-development verification; portable CI
skips it when Craftland Studio is not installed. `npm run verify:eos` requires
the extension and fails if it is unavailable.

### Contracts-first

No public API/configuration was introduced. `GRAMMAR.md` remains normative.
The EOS-capable token set and source ranges are pinned through extension
differential fixtures, not inferred from formatting preference.

## Verification

- `npm run test` covers expected boundary behavior without editor dependencies.
- `npm run verify:eos` compares virtual EOS ranges against the installed
  `FCGLexer` for every pinned fixture.
- Parser Phase 2B may consume these facts but must not reimplement NLSEMI.
