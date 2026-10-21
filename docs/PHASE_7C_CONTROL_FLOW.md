# Phase 7C: Control-Flow and Data-Flow Linting

**Status:** Implemented in the independent v3 core; verification is recorded
below.

## Goal and boundary

P7C adds conservative intraprocedural analysis for FC function and event bodies.
It uses the v3 lossless lexer, parser, source-referential AST, and P7B binder.
It does not invoke Craftland's compiler, import the extension's private
semantic bundle, scan other files, or run on the formatter path. P7D remains the
phase for workspace/indexed rules.

The shipped P7C rules are:

- `fc/no-unreachable`: statements unreachable from the callable entry node;
- `fc/no-constant-condition`: literal `if`, `while`, and expression-form `for`
  conditions whose value is statically known;
- `fc/no-dead-store`: a local/loop-symbol write overwritten or discarded on
  every reachable path before a read.

`fc/no-constant-condition` and `fc/no-dead-store` default to `warning`. The
candidate `assigned-but-never-read` and redundant-branch rules remain deferred
until they can meet the same confidence contract.

## Design review

### Precedent and evidence

P7A established the independent-core boundary, the capability model, and the
requirement that unknown calls, `wait`, `start`, and member mutation cancel
unsafe dead-store conclusions. P7B established source ranges, binder symbol
IDs, structured `for` nodes, suppression, severity, and deterministic
diagnostic contracts. Those existing contracts are the precedent for P7C.

The grammar and AST retain all forms needed by this phase: `if`/`else`, nested
`while`, index/range/expression `for`, `return`, `break`, `continue`, ordinary
calls, and prefixed `wait`/`start` calls. The binder distinguishes local and
loop symbols from fields, callable names, and member-name text, so the data
flow does not use token or spelling heuristics.

### Alternatives considered

1. **Statement-level CFG plus binder-backed liveness (chosen).** It fits the
   existing AST, provides deterministic source ranges, and is available to the
   CLI and VS Code without a project service.
2. **Import Craftland's compiled semantic server.** Rejected: it is private,
   version-dependent, unavailable to the standalone CLI, and has no supported
   compatibility contract.
3. **Token-pattern or formatter-based analysis.** Rejected: it cannot model
   scopes, structured loop exits, `out var`, member/index aliasing, or nested
   control flow, and would duplicate parser/formatter ownership.
4. **A type-checker-dependent analysis.** Deferred: P7C's rules can be made
   high-confidence with conservative unknown effects, while type information
   has no authorized public API in this package.

### Ownership

- `src/syntax/` and `src/parser/` own recognition and source-referential ranges.
- `src/lint/binder.ts` owns symbol identity, scopes, and reference classes.
- `src/lint/cfg.ts` owns statement CFG construction and structured exits.
- `src/lint/data-flow.ts` owns reachability, constant evaluation, effects, and
  liveness.
- `src/lint/linter.ts` owns rule gating, suppression, severity, and diagnostic
  ordering.
- The CLI and extension are adapters; neither contains semantic analysis.

No FC source, generated symbol file, FC API, schema, or compiler contract was
changed for P7C.

### Performance model

Analysis is requested only when an enabled rule requires binding/CFG. For one
callable, graph construction and reachability are O(V + E). Backward liveness
uses set transfers over the callable's bounded symbol universe and converges on
the finite structured graph; it never performs an interprocedural search.
Calls and non-name mutation use a full-symbol conservative barrier. No
full-project scan occurs on a document update, and formatting never invokes
these passes.

### Contracts / API-first review

The public `lintSource` input/output and `fc/*` rule IDs remain the P7B
contracts. P7C only registers two IDs, assigns their documented default
severity, and consumes the existing `rules`, suppression, UTF-16 range, and
deterministic-sort contracts. `analyzeControlFlow` and its graph/effect types
are internal implementation contracts; no new FC language API or external
schema is introduced.

Malformed lexer/parser input remains blocking `fc/parse` and suppresses all
semantic rules. Diagnostics are emitted only for reachable statements and use
the exact condition/write source range. Suppressions apply through the existing
`fc-lint-disable-next-line <rule-id>` mechanism; invalid IDs and levels remain
`fc/config` diagnostics.

## Analysis model

The CFG creates synthetic `entry`, `exit`, and loop-join nodes. Every statement
has a source-referential node. `if` has true/false edges; loops have a true body
edge, a false edge to the after-loop join, and body back-edges to the loop
condition. `return` targets the callable exit. `break` targets the nearest loop
join and `continue` targets the nearest loop condition. Nested loops therefore
retain independent exits and back-edges.

Reachability evaluates only boolean literals, parentheses, and unary `!` (with
the same source tokens used by the parser). A known branch prunes the opposite
edge. This applies uniformly to `if`, `while`, and expression-form `for`; an
unknown expression keeps both edges.

Data-flow records bound local/loop reads and writes. Declaration writes are
retained for liveness but excluded from dead-store reports so they do not
duplicate `fc/no-unused-local`. Compound assignments read their target before
writing it. `out var` is a declaration/write at its call site. Member/index
assignment, unknown-name targets, ordinary calls, and prefixed `wait`/`start`
calls are unknown effects. Unknown effects conservatively make every tracked
symbol live across the operation. Liveness and dead-store checks are restricted
to the reachable subgraph, so unreachable reads cannot hide a reachable dead
store.

## Verification gates

Focused fixtures cover positive and negative branch/loop cases, nested loops,
`if`/`else`, `return`, `break`, `continue`, expression-form `for`, ordinary and
`wait`/`start` unknown barriers, overwritten writes, suppression, severity
overrides, UTF-16 offsets, and repeat-run determinism. Existing parser-blocking,
structural-rule, suppression, and ordering tests continue to run in the same
Vitest suite.

The release gate is:

1. strict core typecheck and production build with the package-local binaries;
2. the complete Vitest suite;
3. generated token vocabulary check;
4. recursive parse/lint of all 165 corpus `.fcc`/`.fcg` files with zero
   `fc/parse` diagnostics and deterministic output;
5. staged compiler-oracle validation when compiler evidence is required. The
   oracle operates on a temporary copy and never edits `Assets/`; pre-existing
   semantic compiler errors are reported separately from added syntax errors.

P7D builds on the binder and parser contracts for workspace indexing, while
preserving this unknown-effect and independent-core boundary. P7D.0 provides
the snapshot/index contract recorded in
[PHASE_7D0_WORKSPACE_INDEX.md](PHASE_7D0_WORKSPACE_INDEX.md); P7D.1–P7D.3E
workspace adapters and conservative import rules are recorded in
[PHASE_7D_WORKSPACE_RULES.md](PHASE_7D_WORKSPACE_RULES.md). General `export`
visibility, internal-function reachability, and dependency-cycle diagnostics
remain deferred or intentionally absent where no authoritative contract exists.

### Current workspace evidence

- Core typecheck, production build, grammar vocabulary check, and the full
  Vitest suite pass (15 files, 93 tests).
- The recursive corpus gate finds 165 FC files, zero `fc/parse` diagnostics,
  and identical diagnostics on repeat runs.
- Extension typecheck, its two node tests, esbuild bundle, and VSIX packaging
  pass using the installed package-local binaries.
- Baseline and formatted staged compiler-oracle runs both exit 1 with the same
  eight pre-existing undefined-identifier errors (`FlushPlayerForReset`,
  `Map`, and `StorageDefault`); neither run adds a syntax/parse diagnostic.
