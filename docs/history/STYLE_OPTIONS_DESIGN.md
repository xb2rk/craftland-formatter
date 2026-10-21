# Style controls after Phase 5

## Design review

The existing printer owns syntactic spacing and entry boundaries; the option
registry owns the public config, CLI flags, schema, and reference. The v5
extension calls the same service as the CLI. The closest precedent is the
current `lineBreaks` and `wrap` settings: one leaf has one behavior and one
source of precedence.

Two viable approaches were considered. A general token-pair spacing table would
expose more switches, but it would also let users request lexically invalid FC
and make operator roles ambiguous. Context-specific controls retain predictable
behavior and can be tested against the grammar oracle. For blank lines, a single
global maximum alone cannot express the import boundary or member separation;
separate boundary policies with a shared cap can.

The printer owns these choices. Config resolution and adapters only pass values
through. Spacing decisions are constant-time per boundary. Blank-line decisions
inspect only adjacent entries. No extra parser pass or editor process is added.
The existing reparse and token-identity check remains the safety boundary.

## Contract

- `spacing.assignment`: `inherit` (default), `spaced` or `compact` for `=` and `:=`.
  Inherit follows `spacing.operators`, which defaults to spaced.
- `spacing.comma`: `spaced` (default) or `compact` for flat comma-separated
  groups and other comma boundaries. A broken group still uses a line break.
- `blankLines.maxConsecutive`: 0, 1 (default), or 2 source blank lines between
  entries. This caps every optional boundary; mandatory statement newlines
  remain.
- `blankLines.afterImports`: `always` (default), `preserve`, or `never`.
- `blankLines.betweenMembers`: `preserve` (default), `always`, or `never` for
  adjacent syntax members in graph/declaration blocks. Comments are not
  detached to enforce a member boundary.

`lineBreaks` applies inside safe groups. Blank-line policies apply between
top-level entries or block entries. Source comments and multiline literals stay
byte-identical. An empty block still prints `{}`.

Logical continuations and collection alignment are specified in
[Layout design](LAYOUT_DESIGN.md). Operators, bracket padding, import sorting,
source pragmas and collection comment ownership are specified in
[Parity design](PARITY_DESIGN.md). Arbitrary token-pair switches remain outside
the public contract.
