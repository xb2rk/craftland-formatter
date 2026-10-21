# Phase 7A: Linter Architecture and Feasibility

**Status:** Design complete; no production lint code is included in this phase.

## Goal and boundary

Build a trustworthy FC linter on the v3 lexer/parser/AST. It must support a fast
single-document experience in the CLI and VS Code, then grow into conservative
control-flow and workspace analysis without creating a second FC parser or making
the formatter depend on editor-only services.

Phase 7A defines the contracts and evidence gates for P7B--P7D. P7B's delivered
implementation and verification are recorded in [PHASE_7B_LINTER.md](PHASE_7B_LINTER.md),
and the delivered P7D workspace rules are recorded in [PHASE_7D_WORKSPACE_RULES.md](PHASE_7D_WORKSPACE_RULES.md).
The P7D.3 import-visible declaration surface is recorded in
[PHASE_7D3_IMPORT_SURFACE.md](PHASE_7D3_IMPORT_SURFACE.md).
This design record itself does **not**
ship rules, modify `Assets/`, add FC APIs, invoke a compiler on user files, or
consume Craftland's private server bundle as a library.

## Evidence, precedent, and decision

### Current evidence

- The v3 parser produces source-referential AST nodes with UTF-16 source ranges
  for imports, declarations, blocks, variables, assignments, expressions,
  `if`/`while`, function/event signatures, and `out var` arguments.
- `ForStatementNode` is intentionally incomplete today: it retains an opaque
  token range for its header. Grammar evidence defines index, range, and
  single-expression forms, so a structured for-header AST is a P7B prerequisite.
- The installed Craftland extension (`ffugclanguage` 1.10.1) contains a separate
  `server_semantic.js`; its documented UX includes diagnostics, definitions,
  references, and semantic highlighting. Its changelog records unused-local
  diagnostics plus a workspace dependency graph. This proves the language has
  semantic information, but it does not establish a public, versioned API for
  external tools.
- Root `CODING_CONVENTION.md` already declares that MUST/MUST NOT rules should
  fail lint, including naming, import order, graph platform, and platform import
  isolation. These rules are requirements to map deliberately, not assumptions
  to encode from memory.

### Alternatives considered

1. **Independent analyzer over the v3 AST - chosen.** It works in CLI, tests,
   and VS Code; parser behavior has one owner; deterministic fixtures can cover
   every rule.
2. **Call/import Craftland's compiled semantic server.** Rejected as a core
   dependency: it is implementation detail, may change with extension releases,
   cannot serve the CLI contract, and has no declared compatibility boundary.
3. **Token-pattern linting.** Rejected: it cannot correctly distinguish scopes,
   reads from writes, generic access, `out var`, or nested blocks.

## Ownership and architecture

```text
lossless lex + parse
        |
        +--> lint document adapter
                 |
                 +--> binder (symbols, scopes, references)
                 |
                 +--> CFG / data-flow (only rules that request it)
                 |
                 +--> workspace index (only workspace rules)
                 |
                 +--> rule engine --> diagnostics / safe fixes
                                      |             |
                                      CLI           VS Code adapter
```

- `src/syntax/` and `src/parser/` continue to own FC recognition. Lint never
  reparses strings or creates a competing grammar.
- Planned `src/lint/` owns rule contracts, diagnostic construction, binding,
  CFG, data-flow, and rule execution. Planned `src/workspace/` owns file
  discovery, fingerprints, dependency edges, and cross-file index invalidation.
- The formatter remains independent. It may share lexer/parser/config loading,
  but formatting never runs lint implicitly.
- The VS Code extension renders diagnostics and invokes fixes. It does not own
  semantic logic. CLI and extension must return the same diagnostics for the
  same document/configuration.
- A future optional `SemanticProvider` adapter may query public VS Code
  definition/reference providers when Craftland's official extension is active.
  It is best-effort enrichment only: no core rule may require it and no code may
  import `server_semantic.js`.

## Contracts

### Lint input and output

`lintSource` will lex and parse once, returning parser/lexer diagnostics as
blocking diagnostics and running rules only for a complete AST. A malformed file
therefore receives syntax feedback but no speculative unused/dead-code reports.

Every lint diagnostic has:

- stable ID (`fc/no-unused-local`);
- severity (`error`, `warning`, `information`, `hint`);
- UTF-16 half-open source range from the existing lossless source model;
- message plus optional related locations;
- an optional fix only when it is parse-preserving, non-overlapping, and tested
  for idempotency.

Rules declare their required capability: `ast`, `binder`, `cfg`, `data-flow`,
`workspace-index`, or `semantic-provider`. The engine builds only the maximum
capability requested by enabled rules.

### Binding model

The binder assigns a unique internal symbol ID; names are never used as identity.
Scopes are file, graph, function/event, block, and for-loop scopes. References
are classified as declaration, read, write, call, type-use, namespace/import
use, or unknown. A member expression is not automatically a reference to an
identically named local symbol.

`out var name` is modeled as a declaration/write at the call site in the
containing scope, subject to grammar/corpus fixtures that establish its lifetime.
Identifiers beginning with `_` are eligible for an explicit ignored-binding
policy rather than being silently discarded by the binder.

### Configuration and suppression

The public configuration will be separate from formatter layout choices:

```json
{
  "fcFormat.lint.enabled": true,
  "fcFormat.lint.rules": {
    "fc/no-unused-local": "warning"
  }
}
```

The CLI config equivalent uses a `lint` object. Rule defaults are versioned and
documented. Suppressions use an explicit comment directive such as
`fc-lint-disable-next-line <rule-id>`; P7B validates malformed/unknown rule IDs
and records suppressions in tests. File-wide disabling is deferred until a
concrete operational need exists.

## Capability roadmap

| Phase | Deliverable | Candidate rules | Feasibility / prerequisites |
|---|---|---|---|
| P7B | Binder, scope model, CLI/VS Code diagnostics | duplicate import alias, duplicate local declaration, unused local, unused parameter, self-assignment, empty block, unreachable statement | Fully feasible in v3. First add structured `for` headers and traversal fixtures. |
| P7C | CFG and conservative intraprocedural data-flow | dead store, assigned-but-never-read, constant condition, redundant branch | Fully feasible, but calls/`wait`/`start`/member mutation must conservatively create unknown effects. No type checker required. |
| P7D.0–7D.2 | Snapshot workspace index, adapters, and conservative workspace rules | unused import, unresolved project import, import/platform isolation | Shipped from parsed imports, explicit graph decorators, and import-aware binding. Cycles remain valid graph metadata. |
| P7D.3A–7D.3E | Complete project declaration surface, namespace resolver, named-import validity, and CLI/editor parity | unqualified enum/tuple/type/define/function use, sound namespace unused-import checks, missing named project symbols | Shipped for complete relative project targets. Unique bare-name matches mark an import used; missing named declarations are reported only from complete target surfaces; ambiguous, malformed, unresolved, generated, and external cases remain unknown/opaque. No `export` visibility or private semantic-bundle dependency is inferred. |
| Optional P7E | Public editor semantic enrichment | definition/reference-aware diagnostics, rename assistance | Feasible only behind a version-tolerant VS Code adapter. Do not couple core or CLI to Craftland's private bundle. |

### Rule policy

The first shipped rules must be high-confidence. Formatter-owned style (spacing,
commas, indentation, wrapping) is never duplicated as lint.

- `fc/no-unused-local`: report a local with zero reads; default exemption for
  `_` names and configurable exemption for intentionally ignored `out var`.
- `fc/no-unused-parameter`: disabled for event/public signatures by default
  until visibility is known; enabled for private function bodies where binding
  evidence is sufficient.
- `fc/no-unreachable`: report only statements after a terminator on every
  incoming path; loops and conditionals require CFG, so its initial rule stays
  conservative.
- `fc/no-self-assignment`: only exact bound-symbol `x = x`; member/index forms
  are not auto-reported because getters/setters and aliasing are unknown.
- `fc/no-dead-store`: report a write only when every CFG path reaches an
  overwrite/scope exit before a read. Unknown calls and async boundaries cancel
  the report rather than risk a false positive; formal `out var` parameters are
  caller-visible outputs and are excluded. Graph fields are externally
  observable state, so the rule only analyzes local/loop/regular-parameter
  writes.
- Import usage and project-wide unused declarations are workspace rules, not
  token searches. A qualified `Alias.Member` is a namespace use; a matching
  field/local name is not. For complete relative project namespace imports,
  unresolved bare reads/calls/type uses are matched against indexed declaration
  names. Ambiguous or missing matches are unknown, while opaque
  generated/external imports remain excluded because FC may expose their
  members unqualified.

## Parser prerequisites

Before P7B rules are enabled, extend internal AST/parser contracts and fixtures
for:

1. index `for name = start, end, step`;
2. range `for key, value in expression`;
3. any compiler-accepted single-expression `for` form;
4. explicit loop binding scopes, including `_` placeholders;
5. qualified event names retained as full segments, not only the first segment.

This is an internal v3 syntax-contract change. It must retain the existing
165-file parse/EOF corpus gate and add focused grammar fixtures before binder
work begins.

## Performance model

- Open document: lex, parse, bind, and AST rules are O(n) per requested run;
  no full-project scan on keystroke.
- CFG/data-flow: O(V + E) per function; bounded to one function/document update.
- Workspace index: O(changed file size) for incremental changes and O(project
  source size) only for explicit first index/reindex; cache by file content hash
  and invalidate dependents through import edges.
- Semantic-provider queries: debounced, cancellable, and never on the critical
  formatting path.

## Verification gates

P7B cannot start until the structured-for AST audit passes typecheck, focused
fixtures, and the full corpus parse/EOF gate. Every shipped rule requires
positive, negative, suppression, UTF-16 range, and repeat-run determinism tests.

P7C additionally requires CFG fixtures for nested loops, `if`/`else`, return,
break, continue, and `wait`/`start` calls. A rule may not claim a dead store when
an unknown effect is reachable.

P7D additionally required a temporary-workspace fixture suite covering imports,
file deletion/change invalidation, cycles, generated-library boundaries, and CLI
vs VS Code diagnostic parity. P7D.0–P7D.2 provide the index, adapter, and
conservative rule layer; P7D.3 adds declaration-surface, bare-name, shadowing,
and ambiguity fixtures; D.3D adds missing named-import and malformed-target
fixtures; D.3E adds dirty-buffer and incremental-vs-rebuilt parity fixtures.
Multi-root and code actions remain deferred. Compiler/oracle use remains an
explicit staged validation, never an editor-keystroke dependency.

## Release criterion for P7A

P7A is complete when this record has been checked against current AST/parser,
the official syntax workflow, root coding conventions, corpus forms, and the
installed Craftland extension's documented semantic capabilities. The decision
to begin P7B remains explicit: it authorizes internal parser and lint-package
work, not any FC asset/API/schema change.
