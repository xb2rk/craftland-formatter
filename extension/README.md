# FC Format v2 - VS Code Extension

Deterministic formatter and structural linter for Craftland Studio `.fcg` / `.fcc` (FC Language). Delegates 100% of behavior to `tools/fc-format-v2` - no duplicated grammar.

## Features

- **Format** - `Format Document` + `Format Selection` (full-document fallback to preserve the delimiter tree). Respects `editor.formatOnSave` and `[ffugclanguage].editor.defaultFormatter`.
- **Lint** - off by default (`fcFormatV2.enableLint: false`) to avoid noise. `Lint Document`, `Fix All Auto-Fixable`, and per-diagnostic QuickFix + `SourceFixAll` code actions.
- **Status bar** - `FC` indicator (hidden when lint is off, `$(warning) FC N` when diagnostics exist).
- **Settings** - `fcFormatV2.*` maps 1:1 to the core `Config` (17 knobs: `printWidth`, `tabWidth`, `endOfLine`, `bracketSpacing`, `spaceInside*`, `wrapCalls`, `trailingComma`, …).

## Quick Install (VSIX)

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

Enable format on save and the default formatter (once):

```jsonc
// settings.json
"[ffugclanguage]": {
  "editor.defaultFormatter": "fc-format.fc-format-v2-vscode",
  "editor.formatOnSave": true
},
"fcFormatV2.printWidth": 100,
"fcFormatV2.enableLint": true // optional - off by default
```

One-command dev install (skips if `code` CLI is missing):

```powershell
npm run build:install
```

## Commands

- `FC Format v2: Format Document` - format the active `.fcc`/`.fcg` file.
- `FC Format v2: Lint Document` - refresh diagnostics on demand.
- `FC Format v2: Fix All Auto-Fixable` - apply all safe fixes (sorted bottom-up, then re-format).

Range formatting is provided via VS Code's `Format Selection` but falls back to full-document formatting to keep the block/call/data tree valid.

## Settings

All `fcFormatV2.*` settings mirror `src/format/config.ts` (`Config`). See `tools/fc-format-v2/README.md` for the knob table and the 17-knob spec. The extension registers `configurationDefaults` so `[ffugclanguage]` already defaults to this formatter.

## Development

- Open `tools/fc-format-v2/extension` as a workspace and press `F5` (Run Extension) - `launch.json` uses `preLaunchTask: npm: build`.
- `npm run typecheck` - `tsc --noEmit` (extension only).
- Core formatter lives in `tools/fc-format-v2/src` - `npm --prefix .. run build` must run before `npm run build` in `extension/` (bundled via `esbuild --bundle --external:vscode`).

## License

MIT - see `LICENSE`.
