# Phase 1B - Lossless Lexical Foundation

## Scope

This phase implements only the lexical boundary required by the future parser:
a reproducible FC token vocabulary, a lossless scanner, UTF-16 source ranges,
trivia classification, recoverable diagnostics, and source reconstruction. It
does not format, parse, rewrite imports, synthesize EOS, or expose a public
formatter API.

## Improvement gate

### Precedent

- `tools/fc-format-v2/scripts/gen-grammar.mjs` proved the extension-to-committed-vocabulary
  workflow; its implementation was adapted, not copied as a runtime dependency.
- The extension's `FCGLexer` table and `docs/GRAMMAR.md` are the token spelling and numeric-id
  authorities.
- The Phase 1A audit established the lexer-sensitive contracts: separate `<`/`>` tokens,
  protected literals/comments, and no synthetic EOS token.

### Alternatives

1. Load the VS Code extension at formatter runtime: rejected because the bundle starts a language
   server on import and makes formatter behavior machine-dependent.
2. Hand-maintain token ids: rejected because extension upgrades would silently drift.
3. Generate a committed table from the extension, then use authored TypeScript lexical rules:
   chosen. The build remains portable while `verify:grammar` detects installed-extension drift.

### Ownership

`src/grammar/token-vocabulary.generated.ts` is generated evidence. `src/grammar/lexical.ts` owns
authored spelling/category rules. `src/lex/` owns source-preserving tokenization and diagnostics.
The lexer never decides parser context or output layout. `Assets/Scripts` is read-only test input.

### Performance cost model

Lexing is one forward scan: O(n) time and O(n) tokens for an n-code-unit source file. The full
corpus reconstruction test is an integration test with a 30-second budget; editor integration
later operates per open document rather than walking the corpus.

### Contracts-first

The lexer implements only `GRAMMAR.md` §2 plus Phase 1A's extension evidence. It emits every
source region and a zero-width EOF sentinel, so `reconstructSource(tokens)` is byte-exact. Invalid
protected tokens receive diagnostics but remain single tokens. The parser, not the lexer, will
derive automatic statement boundaries and type/expression context.

## Verification

- `npm run verify:grammar` checks generated vocabulary provenance against the installed extension.
- Unit tests pin keyword/operator spellings, shift tokenization, protected atoms, malformed-token
  recovery, UTF-16 positions, no EOS synthesis, and every `Assets/Scripts` source's reconstruction.
- `npm run ci` runs strict typecheck, tests, and production build.
