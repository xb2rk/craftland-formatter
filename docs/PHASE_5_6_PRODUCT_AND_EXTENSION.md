# Phase 5–6: Product and VS Code Extension

## Decision record

**Status:** Complete locally

FC Format v3 is promoted from a verified formatter core into a user-facing tool and a VS Code formatter extension. The public configuration is deliberately smaller than v2: every exposed option must map to tested formatter behavior and remain byte-idempotent. Options that can alter protected literal/comment bytes or violate compiler layout constraints are intentionally not exposed.

### Precedent and alternatives

- v2 proved that a VS Code document/range provider, commands, settings, and VSIX packaging are useful. Its 17-setting surface also showed that unimplemented or context-blind choices create regressions.
- A token-only VS Code formatter would duplicate the v3 grammar/layout engine. It is rejected.
- An extension that edits a selected range structurally is unsafe until the parser can render isolated syntax subtrees. Range formatting is therefore unavailable; it must not masquerade as a full-document edit.

### Ownership and contracts

- `src/format/options.ts` owns normalized, safe public formatter choices.
- `src/format/formatter.ts` owns rendering and must refuse lexical/parser-invalid files.
- `extension/` is an adapter only: it translates VS Code settings to `FormatOptions` and never implements FC syntax.
- The extension’s configuration schema is the source of editor-facing defaults; core tests prove each setting’s behavior.

### Configuration and performance

Supported: width, tabs/spaces, tab width, operator/comma spacing, call/collection wrapping, blank-line collapsing, final newline. Default output remains LF; an EOL option is deferred because a global newline rewrite can mutate multiline comments or literal payloads.

Formatting stays linear in source size except contiguous import-run sorting (`O(r log r)` per run). The extension formats only on an explicit provider/command request; it performs no background full-document work.

### Gates

Each configuration behavior gets an idempotency test. Phase 5 additionally verifies CLI packaging/docs; Phase 6 verifies extension typecheck/bundle/VSIX package and the existing corpus formatter gate.

## Completion evidence

- The core validates all supported settings before rendering, and its 76-test suite includes
  configuration/idempotency coverage plus the 165-file corpus gate.
- The CLI accepts files or recursive directories, `--check`, and a strict JSON `--config` file;
  [.fcformatrc.example.json](../.fcformatrc.example.json) is a copy-ready starting point.
- The extension is a thin adapter over the compiled core. It supplies document formatting,
  commands, configuration schema, diagnostic output, an extension README,
  changelog, license, and Marketplace metadata.
- Extension typecheck and tests pass, and `vsce package --no-dependencies` produces
  `extension/dist/fc-format-v3-vscode.vsix`.

## Release handoff

The checked-in publisher value preserves the v2 development identity. Before publishing to the
Visual Studio Marketplace, replace it with the team's verified publisher ID, set `private` to
`false`, and publish the tested VSIX from CI. No formatter behavior or FC source change is needed
for that release-only step.
