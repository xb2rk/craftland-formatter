# Phase 7D.3A–7D.3E: Project Import Surface Resolution

**Status:** D.3A–D.3E implemented for complete project `.fcc`/`.fcg` sources;
semantic collision diagnostics and code actions remain deferred.

P7D.3 makes namespace-style project imports useful to the workspace linter. FC
allows an import such as `import "../Contracts/CustomEnum.fcc" as CustomEnum`
to make declarations such as `ResultCode`, `StatType`, or `HitRecord` usable
without spelling the namespace alias. A lexical, single-file binder cannot
attribute those bare names to their source import. This phase adds the smallest
authoritative project-side declaration surface needed to do that attribution.

## D.3A - Import-visible contract

The contract is intentionally narrower than a general FC type checker:

- A complete, successfully parsed project source contributes its declaration
  names as an **import-visible declaration surface**.
- Header sources contribute their top-level `define`, `alias`, `enum`, `tuple`,
  `component`, `func`, `event`, and `declare graph` names. Declared graph
  fields and functions are retained as member facts.
- Graph sources contribute the graph name and complete graph field/function
  member names. Event listener names are retained as source declarations; no
  separate semantic event-dispatch model is assumed.
- The surface is a name-presence contract, not a type signature or overload
  contract. Declaration kind and source range are retained for later rules.
- A malformed or incomplete source contributes no surface. Its parse
  diagnostics remain available through the workspace record.
- A relative project import is eligible only when it resolves to one of those
  complete indexed records. External and generated libraries remain opaque.

This contract is backed by the v3 grammar's header/graph declaration forms and
the real project corpus: namespace imports of `CustomEnum`, `CustomTuple`, and
other contracts are followed by unqualified enum, tuple, type, and function
names. It does not assert a new FC `export` keyword or compiler schema. The
grammar reserves `export`, but v3 still has no public export-visibility rule;
the implementation therefore calls the indexed facts *import-visible*, not
*exports*.

## D.3B - Declaration index

`src/workspace/index.ts` now records a declaration surface for every complete
file in `WorkspaceFileRecord.declarations`:

- `.fcc` top-level declarations are indexed by their declaration kind/name;
- `.fcc` `declare graph` fields and functions are indexed as member facts;
- `.fcg` graph names, fields, and functions are indexed as member facts;
- all ranges remain source-referential UTF-16 ranges;
- file paths and records retain the existing canonical, deterministic ordering;
- syntax reuse and update invalidation continue to follow P7D.0.

The index has no filesystem watcher, compiler call, private Craftland semantic
bundle, or transitive “re-export” inference. It only exposes facts from the
complete source snapshot supplied by the caller.

## D.3C - Cross-file resolver and lint behavior

The binder now retains unresolved `read`, `call`, and `type-use` name
references, including their source names and ranges. Local bindings still win:
an unresolved reference is only a resolver candidate after lexical binding has
failed and the current file's own declarations do not shadow the name.

For each namespace-style import (`import "path" as Alias`):

1. Resolve only complete project targets and obtain their indexed declaration
   names.
2. Match each unresolved bare name against those target surfaces.
3. A unique match marks that import as used. This covers enum names, tuple/type
   names, constants/defines, graph functions, and contract functions/events.
4. Zero matches remain unknown and do not affect the import diagnostic.
5. Multiple matches mark every candidate uncertain; no candidate is reported
   unused. This avoids inventing a precedence rule for ambiguous imports.

`Alias.Member` remains a direct namespace use through the existing binder. Named
project imports keep their existing explicit binding behavior. External/generated
imports (including named forms) and unresolved project targets remain
non-reportable for `fc/no-unused-import` until a public/versioned symbol surface
exists.

The resulting policy is deliberately asymmetric: it reports a namespace import
only when a complete project surface proves that no direct or uniquely resolved
bare use exists, and suppresses the report whenever semantic ownership is
opaque or ambiguous. Import cycles remain valid metadata and never become lint
errors.

## D.3D - Named-import validity

Named project imports now have a separate, conservative existence check:
`fc/no-unresolved-imported-symbol`. For `import Name [as Alias] from "path"`,
the rule reports the imported `Name` only when the target is a complete relative
project source and its import-visible declaration surface has no declaration
named `Name`. Unresolved, malformed/incomplete, generated, and external targets
remain opaque and do not produce an existence diagnostic.

The diagnostic points at the imported name and follows the existing suppression,
severity, UTF-16 range, and deterministic-order contracts. This rule checks
existence only; it does not infer type compatibility, overloads, `export`
visibility, or transitive re-exports. It uses the provisional declaration
surface from D.3A and therefore adds no new FC visibility semantics.

Ambiguous namespace matches remain non-diagnostics. The resolver has no
authoritative FC precedence rule, and the corpus has no genuine ambiguity after
local declarations are excluded. Duplicate-export and opaque-library checks
remain deferred rather than guessed.

## D.3E - CLI/editor parity and invalidation

CLI and VS Code consume the same `lintSource` plus `lintWorkspace` contracts.
The editor materializes open buffers over disk sources, while the CLI
materializes its disk snapshot; both receive identical diagnostic ordering,
severity, suppression, and UTF-16 range behavior. Incremental editor updates
must be equivalent to rebuilding a snapshot after a target change, addition,
deletion, or rename. Focused parity fixtures cover dirty target overlays,
incremental target invalidation, and unresolved/missing-import transitions.

The extension continues to index the first workspace folder only. Multi-root
indexing is deferred until cross-root containment and configuration precedence
have an explicit contract. Related locations and a remove-unused-import code
action are also deferred: a code action requires proof-preserving edits that
retain comments, import runs, parse validity, and format idempotency.

## Design review

### Precedent and alternatives

P7A owns the independent v3 lexer/parser/AST, P7B owns lexical binding, and
P7D.0 owns canonical workspace snapshots and project edges. P7D.3 composes
those owners without adding a second parser or moving semantic ownership into
the formatter.

Two alternatives were rejected:

1. **Keep every namespace import opaque.** This has no false positives, but
   makes `fc/no-unused-import` ineffective for the project's dominant import
   style and cannot distinguish an actually unused contract import.
2. **Treat every unresolved bare name as use of every library.** This removes
   warnings by guessing and hides real unused imports, especially when several
   libraries share common names.
3. **Query Craftland's private semantic bundle or compiler on every lint.**
   This would break CLI/VS Code parity, unsaved-buffer analysis, installation
   independence, and deterministic editor latency.

The selected index/resolver gives useful first-party coverage while keeping the
opaque and ambiguous cases fail-closed.

### Ownership and performance

- `src/workspace/index.ts` owns declaration facts and their update/reuse
  lifecycle alongside paths/imports/dependencies.
- `src/lint/binder.ts` owns lexical symbol identity and unresolved reference
  capture; it does not know workspace paths or declarations.
- `src/workspace/linter.ts` owns cross-file candidate matching, named-import
  validity, ambiguity handling, suppressions, severity, and deterministic
  diagnostics.
- CLI and VS Code continue to provide snapshots and render results; formatter
  code remains independent.

Index construction remains linear in parsed files, imports, and declarations
(`O(F + I + D)`) plus the existing cycle pass (`O(F + E)`). For a document with
`U` unresolved names and `N` namespace imports, matching is bounded by the
complete target surfaces (`O(U × N)` in the intentionally simple implementation).
Named-import validity adds one declaration-surface lookup per named project
import. Future large-workspace optimization can invert the surface into a
name-to-import map without changing the contract.

### API/contracts review

The phase adds no FC API, event, enum, tuple, generated symbol, schema, compiler
dependency, or formatter option. The TypeScript binder result exposes unresolved
references for workspace consumers, and the lint contract adds the
`fc/no-unresolved-imported-symbol` workspace rule. Existing `lintSource` behavior
remains compatible. No automatic fix is emitted: removing an import requires a
later proof-preserving edit/code-action phase.

## Verification gates

Focused fixtures cover:

- unqualified enum, tuple, define/type, and function uses;
- qualified namespace member use;
- a genuinely unused complete namespace import;
- local declaration shadowing;
- ambiguous names from two namespace imports;
- named imports, opaque generated/external imports, suppression, UTF-16
  ranges, and deterministic repeat runs;
- target add/change/delete invalidation through the existing workspace index;
- missing named declarations, declaration-kind/alias coverage, malformed-target
  opacity, dirty-buffer overlays, and incremental-vs-rebuilt parity.

Before enabling additional semantic rules, retain these gates and run the full
core test/typecheck/build suite plus a read-only corpus lint. No `.fcc`/`.fcg`
asset is edited by this phase, so the FC source lint/fix and full compiler
workflow is not invoked for the implementation itself.
