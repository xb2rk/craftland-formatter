# Release hardening P0–P1

## Decision

P0 hardens trust boundaries: one default width of 120 across core, document printer, CLI config
examples, and VS Code; no misleading range formatter; and semantic-preservation regression gates.
P1 improves layout only where the grammar identifies the construct: multiline map and struct
composites align their entry separators. Flat composites remain compact.

## Improvement gate

### Precedent

- `src/format/options.ts` is the core owner of public defaults; `extension/package.json` is the
  editor-facing schema. Their prior 100/120 split was a product bug.
- `src/format/formatter.ts` already derives brace, unary, generic, shift, and call roles from
  `src/syntax/nodes.ts`; `docs/GRAMMAR.md` §8.1 and §12.9 require the same AST-first approach for
  repairs and composite alignment.
- `docs/PHASE_5_6_PRODUCT_AND_EXTENSION.md` records that a textual range edit is unsafe, and the
  current extension proved the problem by returning a whole-document edit for a selected range.

### Alternatives

1. Keep selection formatting but label it as whole-document formatting: rejected because it can
   modify text the user did not select.
2. Format a raw substring: rejected because FC EOS, enclosing delimiters, width, comments, and
   import sorting require file context.
3. Withdraw the range provider until an AST-subtree renderer exists: chosen.

For alignment, either pad flat and broken composites or align only broken composites. The latter is
chosen: it preserves compact one-line values and aligns only a clearly tabular multiline layout.

### Ownership

`src/format/options.ts` owns default resolution. `src/format/formatter.ts` owns AST-derived repair
and rendering. The VS Code extension is only an adapter and exposes document formatting, not a
second formatter. Test helpers own semantic fingerprints; they never participate in production
formatting. No FC asset, FC API, contract, generated symbol, or persistence schema changes.

### Performance cost model

Per-document formatting remains linear in token count. Alignment makes one bounded pass over each
map/struct composite and uses the existing flat-width simulator; no filesystem or compiler work is
added to editor formatting. The semantic corpus fingerprint runs only in the explicit test suite.

### Contracts-first

The parser's binary-shift and map/struct nodes are the authoritative facts. The formatter may join
spaced shift tokens only after a binary-shift AST node proves their role. It may pad a separator only
when a parsed map/struct entry identifies it. Compiler verification remains the staged release
command: run `npm run oracle` and `npm run oracle -- --format`; compare against the documented
baseline before release. The formatter never writes the project `Assets` tree.

## Gates

1. Core and extension defaults remain equal at 120.
2. Dirty-but-valid unary, shift, and call-trailing-comma input canonicalizes, reparses, and is
   byte-idempotent.
3. Every corpus file preserves a trivia/range-free semantic AST fingerprint across formatting.
4. Map/struct separator alignment is exact and idempotent in multiline mode, absent in flat mode.
5. Typecheck, production build, formatter tests, corpus convergence, and staged compiler-oracle
   release checks remain green.
