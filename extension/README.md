# FC Format

FC Format is a deterministic, compiler-safe formatter for Craftland Studio FC source files: `.fcg` graph files and `.fcc` declarations. It is powered by the same grammar-aware v3 core used by the CLI; the extension contains no duplicated FC parser or printer.

## Features

- **Format Document** through VS Code's standard formatter command, including `editor.formatOnSave`.
- **Format Selection is intentionally unavailable for now.** A selection cannot be reformatted safely without first rendering a syntactically enclosing AST subtree in its surrounding width context; global import normalization must also remain excluded from a range edit.
- **Compiler-safe refusal**: malformed input is never partially rewritten. Details are written to the **FC Format** Output channel.
- **Integrated P7B/P7C linting**: scope-aware and conservative intraprocedural diagnostics for unused locals, duplicate declarations/import aliases, self-assignment, unreachable code, empty blocks, constant conditions, and dead stores. Linting is deterministic and never invokes the compiler.
- **P7D workspace diagnostics**: the extension indexes the first workspace folder, overlays unsaved buffers, and reports unresolved project imports, missing named project declarations, explicit server/client import isolation violations, and unused imports. Complete relative project namespace imports use the indexed declaration surface to recognize unique unqualified enum, tuple, type, define, and function uses. Generated and bare libraries stay opaque until a public symbol surface exists; import cycles remain graph metadata, not errors. Dirty-buffer and incremental target invalidation follow the same core contract as the CLI.
- **Real settings**: every exposed setting maps to a tested v3 formatter option. No cosmetic setting silently does nothing.

## Install from VSIX

1. Build the extension from this directory: `npm install` then `npm run package`.
2. In VS Code, open **Extensions** → **…** → **Install from VSIX…**.
3. Choose the generated `.vsix`, then run **Developer: Reload Window**.

For development, open this folder in VS Code, run `npm install`, then press `F5`. The build bundles the formatter core into `dist/extension.js` and does not depend on files outside the installed extension.

## Quick start

Set FC Format as the formatter and enable format on save:

```jsonc
"[ffugclanguage]": {
  "editor.defaultFormatter": "fc-format.fc-format-v3-vscode",
  "editor.formatOnSave": true
}
```

Use **FC Format: Format Document** from the Command Palette at any time.
Use **FC Format: Lint Document** to refresh diagnostics manually; diagnostics also update as FC documents change.

## Settings

All settings live under `fcFormat.*` and can be scoped per workspace or per language.

| Setting | Default | Purpose |
| --- | --- | --- |
| `printWidth` | `120` | Preferred width for automatic wrapping. |
| `tabWidth` / `useTabs` | `2` / `false` | Indentation style. |
| `spaceAroundOperators` | `true` | Binary operator spacing where tokenization remains safe. |
| `spaceAfterComma` | `true` | Inline comma spacing. |
| `wrapCalls` | `auto` | `never`, `auto`, or `always` call/signature wrapping. |
| `wrapCollections` | `auto` | `never`, `auto`, or `always` composite wrapping. |
| `collapseBlankLines` | `true` | Collapse repeated blank lines. |
| `insertFinalNewline` | `true` | Add exactly one final newline. |
| `lint.enabled` | `true` | Show P7B/P7C/P7D.3E static-analysis diagnostics. |
| `lint.suppressions` | `true` | Honor `fc-lint-disable-next-line` comments. |
| `lint.ignoredOutVariables` | `true` | Ignore intentionally write-only `out var` bindings. |
| `lint.rules` | `{}` | Override `fc/*` rule severities (`off`, `error`, `warning`, `information`, `hint`). |

FC Format intentionally does not offer arbitrary trailing commas, spacing inside every delimiter, or global EOL conversion. Those choices can change FC tokenization or protected multiline literal/comment bytes.
Lint rules are intentionally separate from formatting. See the core package's [P7A design](../docs/PHASE_7A_LINTER_DESIGN.md), [P7C control-flow record](../docs/PHASE_7C_CONTROL_FLOW.md), [P7D workspace record](../docs/PHASE_7D_WORKSPACE_RULES.md), and [P7D.3 import-surface record](../docs/PHASE_7D3_IMPORT_SURFACE.md) for rule IDs, named-import validity, CLI/editor parity, suppression policy, and conservative analysis boundaries.

## Development and release checks

```powershell
npm run typecheck
npm test
npm run build
npm run package
```

Before publishing, replace the placeholder `publisher` in `package.json` with the verified Visual Studio Marketplace publisher ID and increment the version. Marketplace publishing is intentionally not performed by this repository workflow.

## License

MIT. See [LICENSE](LICENSE).
