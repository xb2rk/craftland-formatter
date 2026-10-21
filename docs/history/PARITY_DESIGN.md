# Grammar and formatter parity review

The v3/v4 audit identified missing grammar checks and formatter controls. The
user approved P0 and P1 implementation. Runtime remains independent of the
extension oracle and legacy formatter implementations.

## Ownership and alternatives

- Syntax validation belongs to the parser. A small type reader shared by
  declaration/signature boundaries is preferred to importing ANTLR at runtime
  or copying the legacy AST. It validates syntax, not symbol existence.
- Operator spacing uses context-specific controls rather than arbitrary token
  pair rules. `spacing.operators` controls binary/compound operators;
  `spacing.assignment: "inherit"` follows it, while explicit spaced/compact
  assignment settings retain their override. Mandatory lexical separators win.
- `spacing.brackets` controls flat collection padding. Broken delimiters remain
  grammar-owned. Collections with comments receive row-level attachment rather
  than preserving the entire group; raw multiline literals remain protected.
- `imports.sort` defaults to false. Enabling it moves complete import/comment
  units into standard, Contracts and relative-depth groups. This is preferred
  to sorting arbitrary text lines or deleting/deduplicating declarations.
- Source pragmas preserve complete next syntax entries or marked regions.
  Lexical comment tokens identify markers; strings cannot trigger them. They
  never bypass parsing. An overlapping group is preserved as a whole when its
  internal boundary cannot be printed independently.

The registry owns public validation/schema/help/reference; the parser owns
roles and grammar; dedicated import/pragma modules own source transformations;
the printer owns Docs and safety checks. Existing config precedence, CLI
preflight and shared editor service remain the integration points.

Type parsing is linear in each disjoint type/signature boundary. Comment rows
are built once per collection. Imports require O(n log n) sorting and a reparse
only when the import source changes. No runtime dependency is added. Token
identity remains strict after an authorized import-unit permutation; protected
comment and literal spelling must remain exact.
