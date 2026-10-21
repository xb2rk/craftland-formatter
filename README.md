# fc-format-v2

Deterministic formatter and structural linter for Craftland Studio `.fcg` / `.fcc`,
written from scratch against the compiled ANTLR grammar shipped in the VS Code
extension. This is the successor to `tools/fc-format` (v1) and intentionally
shares no code with it.

## Ground rules

- **Grammar authority** - token ids come from `scripts/gen-grammar.mjs`, which
  parses `%VSCEXT%/dist/server_syntax.js`. Never hand-edit `src/grammar.generated.ts`.
- **Single classifier** - `src/classifier.ts` is the *only* structural model;
  both the formatter and linter consume it so rules cannot drift.
- **Pipeline** - `tokenize → items → classify → emit → printDoc → normalize`.
  Higher phases never re-interpret source text directly.
- **Style is explicit** - grammar-required layout is fixed; implemented Tier-3
  knobs are validated by tests and exposed through `Config`.

## Quick start

```bash
cd tools/fc-format-v2
npm install
npm run grammar:gen       # regenerate grammar.generated.ts (idempotent)
npm run typecheck         # tsc --noEmit
npm test                    # vitest
npm run fmt -- <file>       # format in place (uses src/ via tsx during dev)
npm run check -- <path>     # fail if any file would change
npm run lint -- <path>      # convention/grammar diagnostics
npm run oracle -- --json    # disposable full-project compiler check
```

### Formatting a whole folder

The CLI recursively discovers `.fcc` and `.fcg` files (skipping `.git`,
`node_modules`, and `dist`). From the repository root:

```powershell
cd tools/fc-format-v2
npm run fmt -- ..\..\Assets\Scripts       # format in place
npm run check -- ..\..\Assets\Scripts     # CI check; exit 1 on drift
npm run lint -- --json ..\..\Assets\Scripts
```

After `npm run build`, the same commands can be run through the packaged
binary: `node dist/cli.js fmt <folder>` (or install/link the package to expose
the `fc-format-v2` command).

### VS Code extension

The adapter lives in `extension/` and delegates all behavior to the core API;
it does not replace the official `ffugclanguage` extension.

**Install via VSIX:**

```powershell
cd tools/fc-format-v2
npm run build
cd extension
npm install
npm run build              # build core + bundle dist/extension.js
npx vsce package            # -> fc-format-v2-vscode-0.1.0.vsix
code --install-extension fc-format-v2-vscode-0.1.0.vsix --force
# or: Extensions → … → Install from VSIX
```

Reload Window after install: `Ctrl+Shift+P → Developer: Reload Window`.

Format on save and the default formatter:

```jsonc
// settings.json
"[ffugclanguage]": {
  "editor.defaultFormatter": "fc-format.fc-format-v2-vscode",
  "editor.formatOnSave": true
},
"fcFormatV2.printWidth": 100
```

**Development host** - open `tools/fc-format-v2/extension` in VS Code and press `F5` (Run Extension, `preLaunchTask: npm: build`). In the new window, open any `.fcc`/`.fcg` file. `Format Document`, range formatting (full-document fallback), live diagnostics (when `fcFormatV2.enableLint: true`), and `Fix All` are provided by the adapter. Settings under `fcFormatV2.*` map 1:1 to the core `Config` fields (17 knobs).

## Module map (`src/`)

| File | Role |
|---|---|
| `lex/grammar.generated.ts` | `@generated` token id table - re-run `npm run grammar:gen` to refresh. |
| `lex/grammar.ts` | Keyword/punctuator/operator lookup tables on top of `grammar.generated.ts`. |
| `lex/tokens.ts` | `Token` / `TokenKind` types and trivia helpers. |
| `lex/reader.ts` | `StringReader` - peek/advance/span over source; tokenizer's cursor. |
| `lex/tokenizer.ts` | Source text → lossless raw `Token[]`; it never invents parser `EOS`. |
| `lex/items.ts` | Raw tokens → ordered `LexedDocument` trivia/items with source spans. |
| `syntax/classifier.ts` | Lexed document → source-ordered delimiter tree (`BLOCK`/`CALL`/`DATA`/`STRUCT`/`MAP`). |
| `syntax/query.ts` | Structural predicates (`isBlockOpen`, `isStatementCall`, …). |
| `syntax/spacing.ts` | `shouldSpaceBefore` - the single Tier 1/2/3 spacing policy surface. |
| `print/emit/index.ts` | Classifier tree + spacing → `Doc` (`helpers.ts`/`trivia.ts` extracted). |
| `print/doc.ts` | Wadler/Prettier `Doc` IR + `printDoc` (greedy width fitting). |
| `print/normalize.ts` | §15 output hygiene (EOL, BOM, trailing whitespace, final newline). |
| `format/config.ts` | Implemented formatter knobs (17) + defaults + runtime validation. |
| `format/imports.ts` | Import block collect/sort/render (grammar-correct library vs script). |
| `format/format.ts` | Orchestrator: `tokenize → items → classify → emit → printDoc → normalize`. |
| `lint/analysis.ts` | Shared lint analysis (`buildAnalysis`, `collectImports`, diagnostics). |
| `lint/index.ts` | Linter orchestrator + 7 `push*Rules` families. |
| `cli/cli.ts` | `fmt` / `check` / `lint` command entry point. |
| `shared/import-bucket.ts` | Deduplicated 5-bucket import sort (used by formatter + linter). |
| `index.ts` | Public API re-exports for programmatic use. |

## Tests & goldens

- Unit tests live in `tests/unit/` (mirroring `src/`), fixtures in `tests/fixtures/` (8 canonical `.fcc` files: `imports`, `graphs`, `enums`, `collections`, `flow`, `operators`, `comments`, `vectors`). Run `npm test` (vitest, `tests/**/*.test.ts`).
- Invariants: every fixture is idempotent (`format(fixture) === fixture`) + chaos-convergent (`format(chaos(canonical)) === canonical`). Real corpus `Assets/Scripts` is checked for lossless tokenization and idempotency when present (skipped on CI).
- To update a golden: edit the `.fcc` in place, then `node --import tsx -e "import{readFileSync,writeFileSync}from'node:fs';import{formatSource}from'./src/format/format.ts';const p='tests/fixtures/<name>.fcc';writeFileSync(p,formatSource(readFileSync(p,'utf8')))"`.

## Adding a rule / knob

1. Decide the tier (`FC_FORMATTER_SPEC.md` §2). Tier 3 knobs land in `src/config.ts` only with behavior and tests.
2. Implement the behavioural hook in the *single* applicable layer (spacing →
   `spacing.ts`, punctuation → `emit.ts`, structure → `classifier.ts`).
3. Add a focused regression/golden test under `tests/unit/**/*.test.ts` or a new fixture in `tests/fixtures/` that pins the output.

## Related docs

- `docs/FC_FORMATTER_SPEC.md` (co-located) - user-facing rules + Tier model (§16: 17 knobs).
- `docs/FC_LINTER_SPEC.md` - linter rule contract (shares `syntax/classifier.ts`).
- `docs/V2_ROADMAP.md` - phase decisions and verification evidence.
