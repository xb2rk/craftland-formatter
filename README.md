# FC Format

Fresh, deterministic formatting infrastructure for Craftland Studio FC (`.fcg` and `.fcc`) source.

## Status

Phase 0/1 infrastructure, the complete parser (Phases 2A–2E), the formatter (Phases 3B–3D),
Phase 4 hardening, Phase 5 product integration, and Phase 7B–7C linting are complete. Phase 7D.0–7D.3E now provide the
workspace index and conservative cross-file diagnostics. The package provides a lossless lexer,
source-referential parser, deterministic formatter, document printer, import-run sorting, and a
formatting/linting CLI. The linter reports conservative scope and control-flow diagnostics without
requiring the Craftland compiler or a private semantic server.

The formatter contract is [docs/GRAMMAR.md](docs/GRAMMAR.md). The project is a fresh implementation; the `-v3` folder name is only a workspace location.

## Requirements

- Node.js 20.19 or newer
- npm
- Craftland Studio and its FC compiler for the later oracle command

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run verify:grammar
npm run oracle
npm run format -- path/to/file.fcg
npm run format:check -- path/to/file.fcg
npm run format -- --config .fcformatrc.json Assets/Scripts
npm run lint -- Assets/Scripts
npm run lint -- --config .fclintrc.json Assets/Scripts
```

`npm run ci` runs typechecking, tests, and the production build without requiring a local VS Code
extension. `npm run verify:grammar` checks the committed token table against an installed Craftland
Studio extension. `npm run oracle` stages a copy of the project and invokes the FC compiler. Add
`--format` to format only the staged copy before compilation; the working tree and `Assets/` remain
untouched.

The formatting CLI accepts individual files or directories (searched recursively). `--check` prints
files that would change and exits non-zero for CI. Copy [.fcformatrc.example.json](.fcformatrc.example.json)
to `.fcformatrc.json` to begin with a documented configuration. `--config` accepts a JSON object
containing only the supported layout settings, for example:

```json
{
  "printWidth": 120,
  "tabWidth": 2,
  "useTabs": false,
  "wrapCalls": "auto",
  "wrapCollections": "auto"
}
```

See [extension/README.md](extension/README.md) for the complete setting contract and VS Code
installation/development instructions. P7B rule details are recorded in
[docs/PHASE_7B_LINTER.md](docs/PHASE_7B_LINTER.md), and the CFG/data-flow design and gates are
recorded in [docs/PHASE_7C_CONTROL_FLOW.md](docs/PHASE_7C_CONTROL_FLOW.md). The P7D.0–P7D.3E
workspace/index and cross-file rule contract is recorded in [docs/PHASE_7D_WORKSPACE_RULES.md](docs/PHASE_7D_WORKSPACE_RULES.md),
with the declaration-surface resolver in [docs/PHASE_7D3_IMPORT_SURFACE.md](docs/PHASE_7D3_IMPORT_SURFACE.md).

The linter accepts individual files or directories and never modifies source. It emits stable
`fc/*` rule IDs and exits non-zero when diagnostics are found. Use `--json` for machine-readable
output. Copy [.fclintrc.example.json](.fclintrc.example.json) for rule severity overrides. Syntax
errors are blocking `fc/parse` diagnostics; valid files can suppress one following line with
`// fc-lint-disable-next-line fc/no-unused-local`. CFG-backed P7C rules are
`fc/no-unreachable`, `fc/no-constant-condition`, and `fc/no-dead-store`; the latter two default
to `warning` and conservatively stop at unknown effects. Workspace rules are
`fc/no-unresolved-project-import`, `fc/no-unresolved-imported-symbol`,
`fc/no-platform-import-isolation`, and `fc/no-unused-import`.
Use `npm run lint -- --workspace Assets/Scripts` to enable the workspace adapter in the CLI;
the extension builds a snapshot from the first workspace folder and overlays unsaved documents.

## Boundaries

- This package is private and has its own `package-lock.json`, `.npmrc`, `.gitignore`, and TypeScript configuration.
- Generated output, dependencies, coverage, scratch data, and editor state stay untracked beneath this directory.
- The parent repository's FC assets are read-only inputs to the corpus and future compiler-oracle tests. The oracle must operate on a temporary staged copy.
- The linter consumes this parser's syntax tree. It has no separate lexer/parser and does not invoke
  Craftland's private semantic bundle.

## Planned source ownership

- `src/grammar/`: token vocabulary provenance and precedence data.
- `src/lex/`: lossless tokens and trivia.
- `src/parser/`: recursive-descent FC parser.
- `src/syntax/`: syntax-tree nodes and diagnostics.
- `src/doc/` and `src/format/`: layout documents, printer, and formatting rules.
- `src/imports/`: shared import parsing, ordering, and rendering.
- `src/lint/`: validated lint contracts, binder/scopes, AST-local rules, and intraprocedural
  CFG/data-flow analysis.
- `src/workspace/`: pure in-memory workspace snapshots, canonical import resolution, reverse
  dependency edges, cycle components, and workspace diagnostics. Import cycles remain metadata,
  not diagnostics. Complete relative project namespace imports are checked using the indexed
  declaration surface: direct alias uses and uniquely resolved bare enum/tuple/type/define/function
  names count as use; ambiguous or incomplete cases remain unknown. Generated and bare libraries
  remain opaque and are excluded because they may expose members unqualified. Explicit named
  project imports remain checked; complete targets also report missing named
  declarations through `fc/no-unresolved-imported-symbol`. CLI and VS Code
  share the same snapshot/invalidation contract; multi-root indexing and import
  edit code actions remain deferred.

See [docs/PHASE_0_DESIGN.md](docs/PHASE_0_DESIGN.md) for the recorded implementation decision and phase gates.
