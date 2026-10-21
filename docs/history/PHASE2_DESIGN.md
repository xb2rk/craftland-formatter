# Phase 2 design review

## Precedent and alternatives

The v4 parser/formatter is a reference for old behavior only. The Phase 1 oracle proves the currently installed extension grammar and 287 corpus files; it is development-only.

1. Ship the extension parser at runtime: high parity but couples v5 to a private webpack bundle, extension licensing/distribution, and editor installation. Rejected.
2. Keep only a flat token stream and defer structure to printers: easy lossless lexing but would repeat context guesses for calls, signatures, types, blocks, and virtual EOS. Rejected.
3. Write an independent lossless lexer and conservative structural parser, then compare it with the pinned oracle. Chosen.

## Ownership and cost

The lexer owns exact source slices, trivia, positions, and lexical diagnostics. The parser owns grammar roles and syntactic diagnostics. The tree owns only immutable source spans and token references; it does not rewrite text. Printers in Phase 3 will consume this tree and must refuse a parse with diagnostics.

The lexer and parser are linear or near-linear over input tokens. Oracle and full compiler probes run only in development tests. Generated token spellings are a small, pinned data module, not generated parser code. New syntax must enter with a fixture and an oracle comparison.

## Phase 2 gate

Reconstruct every source byte from tokens, including CRLF and raw literals. Parse the complete target corpus and rare fixtures, or document exact exceptions. Reject malformed input with diagnostics and no printable tree. Verify role nodes for imports, declarations, blocks, calls, signatures, collections, conditions, and types. Record every remaining grammar gap before moving to Phase 3.

## Implementation evidence

- The independent lexer reconstructs the complete source from its tokens and matches the oracle's syntax token spellings and offsets on all 287 target files. Oracle `EOS` tokens are grammar-generated line boundaries; the new lexer retains their source bytes as newline trivia.
- The structural parser accepts 287/287 target files and all four rare-rule fixtures. It exposes import, graph, declaration, block, signature, condition, call-role, collection, and type-argument nodes with source spans. The root retains every token for later comment attachment.
- The nine rejected compiler fixtures and a separate role-sensitive line-break matrix return a diagnostic and `tree: null`. The parser refuses to return a partial tree after any lexical or structural error.
- Tests run with `npm test` or `npm run test:syntax`. The pinned extension bundle is used only by the tests and grammar probe.

## Remaining grammar gaps before the printer

The parser currently recognizes file and block structure plus the syntax roles needed for printer design. It does not yet validate every expression, type, and declaration alternative among the 124 oracle rules. In particular, type arguments are recognized from adjacency and a matching `>`, while call role uses statement context. These rules passed the target corpus and role fixtures, but crafted ambiguous expressions may still be accepted or classified incorrectly. The printer should be added only with golden output tests, oracle reparsing, compiler fixtures, and a regression case for every newly discovered ambiguity.

Comment ownership, `fc-format-ignore`, and selection/range semantics belong to the printer and editor phases; the lexer retains their exact tokens but does not assign them to nodes yet.
