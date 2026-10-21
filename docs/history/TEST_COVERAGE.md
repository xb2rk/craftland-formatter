# Test coverage and v4 migration

Test totals describe executed checks; they do not establish every formatting
choice. A formatter needs explicit expected output as well as grammar, token,
compiler, and idempotence checks. Each checks a different property.

## What the gates prove

| Gate | Evidence | Limit |
| --- | --- | --- |
| Exact output or spacing fragments | Named style contracts have the expected layout | Covers the listed inputs and options |
| Pinned grammar oracle | Tested input/output is accepted by the installed grammar | Acceptance permits multiple spacing styles |
| Token identity | Protected tokens retain kind and spelling | A safety rejection still needs a regression to expose unsupported valid input |
| Parser diagnostics plus CLI/editor integration | Named invalid operator/import/decorator/type/collection inputs return no tree/output, fail CLI preflight, and preserve the editor buffer | Does not cover every declaration/type grammar alternative |
| Corpus idempotence | Current source stabilizes after one pass | A stable layout can still be undesirable |
| Compiler fixtures | Selected formatted constructs compile | Does not assert readability or in-game behavior |
| Installed VSIX host | Packaged runtime agrees with the shared core and named operator expectations | Does not cover every editor state |

## Targeted review of v4 operator tests

V5 has a separate implementation and suite. V4 assertions must be reviewed
before adapting them; copying their expected output can preserve an unwanted
style. This review is about operator formatting, not a claim that every v4
test has been migrated.

| V4 evidence | V5 treatment |
| --- | --- |
| `tests/format/formatter.test.ts`: postfix EOS test expects `x ++` before the next statement | `tests/operator-spacing.test.mjs` retains the statement-boundary check and expects `abcd++`; also covers decrement, member/index targets and a trailing comment |
| Same file: unary boundaries include returns, calls, map values, negation, bitwise not and binary signs | Adapted into explicit expected fragments with valid graph imports |
| `tests/format/formatter-differential.test.ts`: output must match v3 except two known cases | Not used as the v5 style oracle; legacy parity can retain old formatting defects |
| `tests/format/formatter-corpus.test.ts`: parse, semantic fingerprint and idempotence | V5 uses the pinned oracle, token identity and idempotence; explicit style tests provide separate expectations |
| `tests/format/formatter-hardening.test.ts`: unary/shift layout, whitespace repair and alignment | V5 tests shifts, unary layout and collection alignment; token-changing repairs are outside its contract |

The new operator matrix additionally covers every compound assignment and
comparison with a negative operand, a positive operand after `-=`, and
repeated unary signs. Before the correction, `a += -b` became `a += - b`, and
valid `- -a` could fail the safety check after the printer merged it into `--a`.
The compiler fixture and installed-VSIX host input now include these forms.

## 0.6.0 operator and distribution checks

The operator suite now asserts spacing before parenthesized compound-assignment
and comparison operands. Negative cases cover split compounds, missing operands,
prefix updates and updates inside values, including nested calls, collections
and conditions. Valid cases retain repeated prefixes, separated shifts,
numeric/range loop headers, out variables and component access on global,
index and call targets.

CLI tests check exit 2, empty stdout and all-file preflight on invalid input.
Editor tests check diagnostics, no provider edits and unchanged unsaved text.
The installed-VSIX host independently exercises named valid operator layouts
and suppression of edits on malformed operator input.

The build test loads the copied runtime and checks the shipped schema, docs and
extension schema contribution. The test launcher discovers the project tests
without shell wildcard expansion. Release metadata is checked against CLI
`--version`. Current release evidence and measured corpus inventory are in
[the rollout report](PHASE6_ROLLOUT.md).

When moving another v4 behavior to v5, record the intended output, adapt the
fixture to the current grammar/API, and assert that output before relying on
corpus acceptance or legacy byte parity. Features deferred in the public
config reference remain deferred even if v4 had tests for them.

## 0.7.0 layout review

The v4 hardening test for broken map/struct separators and the formatter tests
for flat-or-break-all logical headers, fitting headers, independent parentheses
and mixed logical chains were reviewed. V5 implements those contracts in its
Doc printer and adds value-expression coverage beyond the old header cases.

`collection-alignment.test.mjs` asserts the reported rarity table, `:` and `=`,
flat/broken/disabled styles, compact assignment spacing, nested collections,
Unicode display widths, tabs and protected groups. `logical-layout.test.mjs`
asserts both reported boolean cases, assignments/returns, call-versus-grouping
roles, else-if/while/for, independent nested fitting, nested calls, group items,
continuation levels, tabs, preserve mode and malformed closes. These tests use
explicit expected bytes, oracle acceptance and idempotence as distinct gates.

CLI tests exercise config, overrides, flags, provenance and invalid settings.
Editor tests compare those settings against the CLI on an unsaved buffer. The
installed-VSIX host asserts named map/boolean output independently of shared
core parity. A new compiler fixture exercises nested boolean values and broken
maps. Spaced builtin type arguments/component access and shift pairs have
separate syntax/layout regressions.

## 0.8.0 P0/P1 review

`grammar-parity.test.mjs` asserts oracle rejection and no tree/output for the
audited malformed import, decorator, binding/signature, alias, generic-arity,
tuple, LocString and bracket-list cases. Positive counterparts retain script
and raw imports, contextual List/Map aliases and parameter names, header/property
decorators, typed decorators in their permitted contexts, function types,
localized list arguments, static declared graphs and qualified tuples.
Anonymous functions have a statement body role instead of a collection role.
Exact output tests check their block indentation, function-pointer wrapping,
snug casts and sorted raw import spelling. These checks close the reported
gaps without claiming a complete semantic parser or a v4 AST replacement.

`style-parity.test.mjs` covers compact binary/compound spacing and mandatory
lexical separators, explicit assignment overrides, flat bracket padding,
comment-row reflow/alignment, raw bytes, import unit grouping/attachments,
duplicates, detached banners and multiline trailing comments. Source pragma
tests cover complete entries, trailing comments, nested regions, exact bytes,
literal marker text, malformed markers and invalid ignored syntax.

CLI tests check config/overrides/flags/provenance and all-file preflight for P0
errors. Editor tests compare P1 output with the CLI on an unsaved buffer and
refuse P0 errors. The installed-VSIX host covers import sorting, commented maps,
function pointers, source ignores and malformed operator/list/type suppression
in addition to EOL, cursor, manual format and real format-on-save contracts.
Compiler positives now include continued function types, commented maps with
source ignores, anonymous function statements and raw import paths.

## 0.9.0 source-boundary and expression review

`layout-regressions.test.mjs` asserts the reported logging expression's exact
output, arithmetic/bitwise continuations, prefix signs, precedence grouping,
logical operand fitting, compact spacing, call policy, parentheses and tabs.
It covers commented collections with capped gaps, leading/footer-only comments,
nested collections, forced-flat policy and CRLF. Read-only live FeatureFlags
and Client/Server_EntityPool sources check the reported section/call contracts.

Parameter cases check the default beyond width, partial func/event breaks,
event declarations and function types, nested/anonymous signatures, tabs/CRLF,
blank-line caps and protected comments. Explicit auto/always/never remain
covered, and other wrap fields must reject preserve. Exact bytes, oracle
acceptance and idempotence are separate assertions.

CLI tests cover preserve defaults, overrides, flags and provenance; editor tests
compare unsaved output with CLI output for all three reported layout contracts.
The installed host additionally asserts long single-line and partially broken
declarations, map sections and concatenations with fitting nested calls. Four
compiler positives exercise preserved signatures, long logging arguments and
commented collection sections; the previous positive fixtures remain selected.
