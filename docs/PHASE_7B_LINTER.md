# Phase 7B: Binder and AST-Local Linting

**Status:** Complete locally.

P7B implements the first conservative lint layer over the v3 lexer, parser, and
source-referential AST. It does not invoke the Craftland compiler, import the
private semantic server bundle, or edit FC sources in `Assets/`.

## Delivered

- Structured index/range/expression `for` nodes with loop binding scopes.
- Qualified event names retained as all source segments.
- A single-pass binder with file, graph, callable, block, and loop scopes.
- Stable internal symbol IDs and reference classification for declarations,
  reads, writes, calls, type uses, and `out var` writes.
- Deterministic diagnostics with UTF-16 half-open ranges and explicit severity.
- Conservative rules:
  - `fc/no-unused-local`
  - `fc/no-unused-parameter` (opt-in by default)
  - `fc/no-duplicate-declaration`
  - `fc/no-duplicate-import-alias`
  - `fc/no-self-assignment`
  - `fc/no-empty-block`
  - `fc/no-unreachable`
- `fc-lint-disable-next-line <rule-id>` suppression, underscore binding policy,
  and configurable `out var` exemption.
- Core `lintSource` API, recursive `lint`/`lint:json` CLI commands, and VS Code
  diagnostics with a debounced document update path.

## Safety boundary

Malformed lexical/parser input produces blocking `fc/parse` diagnostics and does
not run speculative rules. The binder does not infer member references from
matching names. Unreachable analysis is straight-line only; loops, branches,
unknown calls, asynchronous `wait`/`start`, and mutation are reserved for P7C
control-flow/data-flow analysis. No automatic fixes are emitted until a rule has
parse-preserving, non-overlapping fixture coverage.

## Verification

- Strict core typecheck and production build pass.
- Extension core build/typecheck pass; settings tests cover validated rule
  severity mapping.
- Focused parser/linter tests cover loop scopes, qualified names, duplicate
  declarations/import aliases, unused bindings, self-assignment, empty and
  unreachable blocks, suppression, underscore/`out var` policy, malformed-input
  refusal, severity overrides, and UTF-16 ranges.
- The existing 165-file corpus remains parseable through EOF. P7B analysis is
  opt-in for the corpus until project-specific policy chooses rule severities.

## Follow-up

P7C adds a CFG/data-flow layer without changing these rule contracts. P7D.0–
P7D.2 add the snapshot workspace index, adapters, unresolved/platform import
rules, and import-aware unused-import analysis; P7D.3 adds the complete project
declaration surface and conservative namespace resolver; see
[PHASE_7D_WORKSPACE_RULES.md](PHASE_7D_WORKSPACE_RULES.md). All phases preserve
the independent-core boundary and cancel diagnostics whenever unknown effects
make a conclusion unsafe. Import cycles remain valid graph metadata, not a lint
error.
