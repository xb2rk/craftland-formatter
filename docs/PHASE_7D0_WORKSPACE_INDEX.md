# Phase 7D.0: Workspace Index Foundation

**Status:** Implemented as the in-memory foundation for the P7D.1–P7D.3E
workspace diagnostics recorded in [PHASE_7D_WORKSPACE_RULES.md](PHASE_7D_WORKSPACE_RULES.md).

## Purpose and boundary

P7D.0 introduces the smallest shared foundation needed for workspace-aware
analysis: a deterministic snapshot of FC source files and their import graph.
It is deliberately separate from `lintSource`. The index does not add lint
rules, compiler calls, filesystem access, formatter dependencies, or semantic
assumptions that are not established by the v3 parser and the workspace
caller.

The public index entry points are:

- `createWorkspaceIndex(sources, options)` builds a snapshot from caller-owned
  `{ path, source }` values.
- `updateWorkspaceIndex(index, changes)` applies additions, replacements, and
  deletions. An omitted `source` deletes a file; unchanged content reuses its
  parsed syntax record.
- `canonicalWorkspacePath(root, path)` exposes the same path normalization used
  by the index.

The snapshot is immutable by convention. Maps and arrays returned by the API
are newly constructed for each revision, and `revision` increases for every
update operation. The core never reads or writes `Assets/`, `Temp/`, or any
other directory.

## Indexed facts

Each `.fcc`/`.fcg` source record contains its canonical path, root-relative
path, file kind, SHA-256 source hash, complete-parse status, source-referential
AST when parsing succeeds, syntax diagnostics, imports, and declaration facts.
Complete header and graph declaration names (including graph fields/functions)
form the import-visible surface consumed by P7D.3; they are not general
`export` semantics or a compiler visibility claim.

An import retains its exact source range, specifier, alias/imported name, and
candidate project paths. Imports are classified conservatively:

- `project`: a relative import resolved to an indexed `.fcc` or `.fcg` file;
- `unresolved-project`: a relative import with no indexed target (or one that
  escapes the root);
- `generated-library`: an opaque generated-library specifier, including the
  default `EditorGenLib.fcc` boundary;
- `external-library`: a non-relative library specifier not identified as
  generated.

Only resolved project imports create dependency edges. The index also stores
reverse `dependents` edges, which lets a future adapter invalidate the changed
file and its importer closure without rescanning every document. A
deterministically ordered Tarjan pass records strongly connected components
with more than one file (or a self-loop) as `cycles`; this is graph data, not a
diagnostic.

## Resolution contract

Paths are absolute, slash-normalized, and lower-cased on Windows for stable
identity. Source paths must remain under the declared root and use `.fcc` or
`.fcg`. Relative imports normalize `\\` to `/`, reject paths outside the root,
and probe the literal path followed by `.fcc` and `.fcg` when no extension is
given. Bare imports are opaque: they are never guessed to be project files.
Generated-library names are configurable and merged with
`EditorGenLib.fcc`; generated files are not required to be present in the
snapshot.

Files with lexer errors, parser diagnostics, a missing AST, or trailing input
are retained for diagnostics/UX but contribute no import edges or declaration
facts. This prevents a malformed edit from poisoning the workspace graph.

## Design review

### Precedent

P7A established the independent v3 lexer/parser/AST boundary and reserved
workspace indexing for P7D. P7B owns syntax/binder-local rules, and P7C owns
intraprocedural CFG/data-flow. P7D.0 composes those parser contracts without
moving semantic ownership into the formatter or importing Craftland's private
semantic bundle.

### Alternatives considered

1. Re-run `lintSource` independently for each file and infer imports from text.
   Rejected: it cannot provide canonical graph identity, reverse edges, or
   safe invalidation, and token-pattern inference would violate the P7A
   boundary.
2. Read the compiler/editor generated semantic bundle as the workspace index.
   Rejected: it is private/generated, unavailable to a standalone package, and
   would make the linter version- and installation-dependent.
3. Add filesystem watchers and a persistent cache to the core module.
   Rejected for 7D.0: those are host concerns. The pure snapshot API is
   testable, works with unsaved buffers, and leaves caching policy to a later
   adapter.

### Ownership

- `src/lex/`, `src/parser/`, and `src/syntax/` own source parsing and ranges.
- `src/workspace/index.ts` owns canonical file identity, import resolution,
  snapshot records, reverse edges, and cycle components.
- `src/lint/` remains the owner of document rules, symbol binding, and CFG/data
  flow. Workspace rules are owned by `src/workspace/` and remain separate from
  `lintSource`.
- CLI and VS Code adapters supply disk snapshots and unsaved overlays and
  consume the same index contract. Their workspace diagnostics are documented
  in [PHASE_7D_WORKSPACE_RULES.md](PHASE_7D_WORKSPACE_RULES.md).

### Performance

Initial indexing parses each supplied source once and builds dependency tables
in O(F + I), where F is the number of files and I the number of imports. Cycle
detection is O(F + E) for resolved project edges. An update reparses only
changed content, reuses unchanged syntax records, and rebuilds deterministic
tables from the in-memory records; a host can use `dependents` to bound later
diagnostic invalidation. No interprocedural or compiler search occurs.

### Contracts/API-first review

P7D.0 adds only snapshot/index types and functions. It does not add a rule ID,
diagnostic shape, FC API, schema, compiler dependency, or formatter option.
Malformed input remains non-fatal to indexing and contributes no edges.
Unknown/generated libraries remain opaque. Workspace rules document their
compiler evidence, severity, suppression/range behavior, and CLI/VS Code
ownership in [PHASE_7D_WORKSPACE_RULES.md](PHASE_7D_WORKSPACE_RULES.md).

## Verification gates

The focused workspace suite covers project/generated/external classification,
deterministic cycles, add/change/delete invalidation, unchanged parse reuse,
malformed sources, root containment, duplicate paths, and deterministic map
ordering. Before a future 7D rule is enabled, the workspace adapter must add
CLI/VS Code parity fixtures, dirty-buffer behavior, and compiler-oracle
evidence for the rule's semantic contract. P7D.1–P7D.3E provide the workspace
adapter/rule layer while keeping cycles non-diagnostic. A read-only corpus smoke indexed all
165 `Assets/Scripts` files: all 165 parsed completely, 994 project edges were
resolved, 7 cycle components were recorded as data, and reversing input order
produced the same file/cycle ordering. These cycle components are intentionally
not diagnostics in 7D.0.
