# Phase 7D.1–7D.3E: Workspace Diagnostics

**Status:** Implemented as conservative workspace diagnostics over the P7D.0
snapshot index. P7D.3 adds a complete-project declaration surface,
unqualified namespace-import resolution, named-import validity, and
CLI/editor parity fixtures; see
[PHASE_7D3_IMPORT_SURFACE.md](PHASE_7D3_IMPORT_SURFACE.md) for the focused
contract and design review.

## Scope and boundary

P7D.1 adds a caller-owned workspace adapter and two high-confidence import
checks. P7D.2 adds import-aware binding and unused-import analysis. P7D.3A–E
adds complete project declaration facts and conservative resolution of bare
names through namespace-style imports plus named-import validity. The core
still has two explicit entry points:

- `lintSource` analyzes one complete document and retains the P7B/P7C
  document-only contract.
- `lintWorkspace(index, options)` analyzes a P7D.0 snapshot and returns
  workspace diagnostics with canonical file paths.

The CLI enables the second entry point with `--workspace <directory>`. The VS
Code adapter builds an index from the first workspace folder, overlays open
unsaved buffers, incrementally updates changed documents, and refreshes the
same workspace rules. Neither adapter invokes the compiler, edits FC source,
or imports Craftland's private semantic bundle.

Malformed or incomplete records are retained for parse UX but contribute no
workspace facts. Generated libraries and non-relative library imports remain
opaque. The index's SCC/cycle data is available to hosts for invalidation and
visualization; import cycles are valid FC structure and are **not** a lint
diagnostic.

## Shipped rules

### `fc/no-unresolved-project-import`

Reports a relative import whose candidate `.fcc`/`.fcg` target is not present
in the indexed root. A resolved file is considered a project fact even if that
file itself has syntax diagnostics; parser feedback remains the separate
blocking diagnostic. Bare imports, configured generated libraries, and
`EditorGenLib.fcc` are deliberately excluded from this rule.

### `fc/no-platform-import-isolation`

Reports only an explicit platform crossing between complete graph files:

- `[platform_server]` graph → `[platform_client]` graph;
- `[platform_client]` graph → `[platform_server]` graph.

Contracts (`.fcc`) are shared type boundaries and are allowed. Graphs without
exactly one recognized platform decorator, conflicting decorators, and opaque
libraries fail closed and produce no isolation diagnostic. This follows the
architecture rule that server/client communication uses events rather than
cross-platform graph imports.

### `fc/no-unused-import`

Reports an import only when the binder and workspace facts can prove that its
binding is unused. Named project imports (`import Name [as Alias] from "path"`)
retain direct binder-backed checking. Namespace uses such as `Alias.Member()`
count as a use; member names themselves do not become local references.
Imported names used in domain types, generic types, casts, `typeof`, composites,
decorators, and function/event signatures are tracked by the same binder.

P7D.3 extends this to a complete relative project target for
`import "path" as Alias`: unresolved `read`, `call`, and `type-use` names are
matched against the target's indexed declaration surface. A unique match
(for example `ResultCode`, `HitRecord`, `StatType`, or a project function)
marks the namespace import as used. Current-file declarations shadow candidates;
ambiguous matches remain unknown and suppress the unused report. A complete
target with neither a direct alias read nor a resolved bare use may therefore
produce `Imported name 'Alias' is never used.`

External/generated libraries and unresolved/incomplete project targets remain
opaque. The implementation does not infer exports from filenames or token
spelling, and it does not depend on Craftland's private semantic bundle. The
grammar reserves `export`, but v3 still has no established export-visibility
contract; indexed complete-source names are therefore called
*import-visible declarations*, not general exports. A future public/versioned
library contract may extend the same resolver to opaque libraries.

This rule is run by `lintWorkspace` because its result is surfaced alongside
the workspace adapter. The binder remains independent and can be reused by
future document/workspace consumers.

### `fc/no-unresolved-imported-symbol`

Reports a named imported `Name` when its complete relative project target has
no import-visible declaration named `Name`. Generated/external imports,
unresolved targets, and malformed/incomplete targets remain opaque and produce
no existence diagnostic. The rule does not infer `export` visibility, type
compatibility, overloads, or transitive re-exports. It points at the imported
name and follows the same suppression, severity, UTF-16, and deterministic
ordering contract as the other workspace rules.

## Import cycles and deferred candidates

Architecture.md does not prohibit import cycles, and the real corpus contains
cyclic project edges. Therefore `cycles` remains deterministic index metadata,
never `fc/no-dependency-cycle`.

The following candidates stay deferred until an authoritative contract exists:

- duplicate exported declarations: the v3 parser has no established `export`
  visibility semantics;
- unused internal functions: generated entrypoints, event dispatch, and
  dynamic calls are not represented by a complete public reachability model;
- platform isolation for opaque/generated symbols: no source-level platform
  fact exists to validate it.
- ambiguity/import-collision diagnostics: FC precedence is not established,
  and the current corpus has no genuine ambiguous unresolved names after local
  declarations are excluded;
- remove-unused-import code actions: edits need comment/import-run preservation
  and parse/idempotency proof;
- multi-root indexing: cross-root containment and configuration precedence are
  not yet part of the workspace contract.

No rule infers exports from filenames, declarations, or token text.

## Design review

### Precedent and alternatives

P7A chose the independent v3 lexer/parser/AST. P7B owns AST/binder-local
rules, P7C owns intraprocedural CFG/data-flow, and P7D.0 owns canonical source
snapshots and graph edges. P7D.3 composes those owners without adding a second
parser.

Rejected alternatives are compiler/private-bundle queries, filename/token
heuristics, and a core-owned filesystem watcher/cache. They would make
diagnostics installation-dependent, fail on unsaved buffers, or bypass the
source-referential parser contract.

### Ownership and performance

`src/workspace/index.ts` owns paths, import classification, declaration facts,
platform facts, reverse edges, and cycle metadata. `src/workspace/linter.ts`
owns the four workspace rules, namespace matching, named-import validity, and
suppression/rule severity application. `src/lint/binder.ts` owns symbol identity,
import declarations, type-use traversal, and unresolved name capture. CLI and
VS Code only supply snapshots and render diagnostics.

Initial indexing remains O(F + I + D) plus parsing; cycle detection is O(F + E).
An update reparses changed content, reuses unchanged syntax records, and
rebuilds deterministic edge tables. Namespace matching is bounded by unresolved
names × complete namespace imports; no interprocedural search or compiler query
is performed.

### Contracts/API-first review

New public IDs are:

```text
fc/no-unresolved-project-import
fc/no-unresolved-imported-symbol
fc/no-platform-import-isolation
fc/no-unused-import
```

All default to `warning`, accept the existing `off/error/warning/information/hint`
levels, preserve UTF-16 ranges, honor `fc-lint-disable-next-line`, and sort
deterministically by canonical file, source offset, and rule ID. There is no
new FC API, schema, asset edit, compiler dependency, or formatter option.

## Verification gates

Focused workspace fixtures cover project/generated/external classification,
unresolved imports, platform crossings and allowed contracts, qualified and
unqualified namespace uses, enum/tuple/type/define/function surfaces,
shadowing, ambiguity, named-import validity, malformed-target opacity,
suppression, severity, UTF-16 ranges, and deterministic repeat runs. CLI
`--workspace` and the VS Code adapter consume the same `lintWorkspace` contract;
dirty-buffer overlays and incremental-vs-rebuilt invalidation are covered by
the parity fixtures. The extension still indexes the first workspace folder;
multi-root and code actions remain deferred. The existing P7D.0 corpus smoke
remains a read-only 165-file index check; cycle components remain
non-diagnostic. Full core/extension gates and compiler-oracle checks remain
staged and must not modify `Assets/`.
