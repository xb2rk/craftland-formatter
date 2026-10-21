<p align="center">
  <img src="resources/icon.png" width="128" height="128" alt="Free Fire Craftland Code Formatter Logo" />
</p>

<h1 align="center">Free Fire Craftland Code Formatter &amp; Linter</h1>

<p align="center">
  <strong>High-performance, zero-dependency code formatter, static linter, and range-formatting engine for Free Fire Craftland Code (<code>.fcg</code>, <code>.fcc</code>).</strong>
</p>

<p align="center">
  <a href="https://img.shields.io/badge/VS%20Code-%3E%3D%201.96-blue"><img src="https://img.shields.io/badge/VS%20Code-%3E%3D%201.96-blue" alt="VS Code" /></a>
  <a href="https://img.shields.io/badge/FC%20Grammar-1.11.0-orange"><img src="https://img.shields.io/badge/FC%20Grammar-1.11.0-orange" alt="FC Grammar" /></a>
  <a href="https://img.shields.io/badge/Runtime-Pure%20.mjs%20(0%20deps)-brightgreen"><img src="https://img.shields.io/badge/Runtime-Pure%20.mjs%20(0%20deps)-brightgreen" alt="Zero Dependencies" /></a>
  <a href="https://img.shields.io/badge/Tests-237%20Passed-success"><img src="https://img.shields.io/badge/Tests-237%20Passed-success" alt="Tests" /></a>
</p>

---

## Overview

**Free Fire Craftland Code Formatter** brings production-grade code formatting, surgical range formatting, and static code linting to Free Fire Craftland UGC development. It shares the exact same Wadler-Leijen layout engine, CST parser, and config resolver as the standalone `fcfmt` CLI.

- ⚡ **Zero Runtime Dependencies**: Pure `.mjs`, instant activation, 0 npm bloat.
- 🎯 **Format Document & Selection**: Whole-file formatting (`Shift+Alt+F`) and surgical range formatting (`Ctrl+K, Ctrl+F`).
- 🛡️ **Dual-Layer AST Defense**: Mathematical token invariance guarantees that formatting will never alter your code semantics or introduce compiler errors.
- 🔍 **Integrated FC Linter**: Detects freeze hazards (step 0 loops), unreachable code, self-comparisons, and unused imports with zero false positives.
- ⚙️ **Native VS Code Settings**: Configure all 20 options directly in VS Code UI (`Ctrl+,` &rarr; `fc-format.*`) or commit `.fcfmt.json` for team-wide Git synchronization.
- 🗂️ **Active Editor Fallback**: Automatically inherits your editor's `tabSize` and `insertSpaces` when not explicitly locked in project configuration.

---

## Installation & Setup

### 1. Install from VSIX
1. Open VS Code.
2. Go to **Extensions** (`Ctrl+Shift+X`).
3. Click the **`...`** (Views and More Actions) menu in the top-right corner.
4. Select **Install from VSIX...** and pick `fc-format-v5-vscode-0.9.0.vsix`.

### 2. Configure Default Formatter
Add the following to your VS Code `settings.json` (or configure via **Format Document With... &rarr; Configure Default Formatter**):

```json
{
  "[ffugclanguage]": {
    "editor.defaultFormatter": "craftland-community.fc-format-v5-vscode",
    "editor.formatOnSave": true
  }
}
```

---

## Commands & Shortcuts

| Command | Shortcut | Description |
|---|---|---|
| **FC Format v5: Format Document** | `Shift+Alt+F` | Formats the active, possibly unsaved buffer |
| **FC Format v5: Format Selection** | `Ctrl+K, Ctrl+F` | Formats only the selected lines/statements via Myers diffing |
| **FC Format v5: Preview Formatting** | Command Palette | Opens a read-only side-by-side diff without touching disk |
| **FC Format v5: Explain Configuration** | Command Palette | Inspects resolved config leaves, active editor fallbacks, and provenance |

---

## Range Formatting (Format Selection)

VS Code's standard `Format Selection` (`Ctrl+K, Ctrl+F`) uses a Myers line-level diff algorithm (`computeLineHunks`):
- Selecting any portion of an FC file computes a formatted target and projects changes strictly into the selected lines.
- Selections automatically expand to outer statement/line boundaries.
- Non-selected regions (e.g. legacy or unformatted code above and below) are **100% untouched** (byte-for-byte preserved).
- If the file contains fatal syntax errors, edits are safely aborted with a notification.

---

## Configuration Hierarchy

CFO / team style settings are resolved using strict deterministic precedence:

$$\text{Defaults} \longrightarrow \text{.editorconfig} \longrightarrow \text{VS Code Settings GUI} \longrightarrow \text{Active Editor Indent} \longrightarrow \mathbf{.fcfmt.json} \longrightarrow \text{CLI Flags}$$

### 1. Through VS Code GUI Settings
Open `Settings` (`Ctrl+,`) and search for `fc-format`:
- `fc-format.printWidth`: Target line width (default: `120`)
- `fc-format.indent.style`: `"space"` or `"tab"`
- `fc-format.indent.size`: Number of spaces (default: `2`)
- `fc-format.spacing.operators`: `"spaced"` or `"compact"`
- `fc-format.wrap.calls`: `"auto"`, `"always"`, or `"never"`
- *...and 15 other formatting options.*

### 2. Through Project `.fcfmt.json`
To enforce consistent code formatting across your team on Git, place `.fcfmt.json` at your repository root:

```json
{
  "$schema": "./tools/fc-format-v5/schema.json",
  "printWidth": 120,
  "indent": {
    "style": "space",
    "size": 2,
    "continuation": 1
  },
  "alignment": {
    "collections": true
  },
  "spacing": {
    "operators": "spaced",
    "assignment": "inherit",
    "comma": "spaced",
    "brackets": "tight"
  },
  "blankLines": {
    "betweenMembers": "always",
    "maxConsecutive": 1
  }
}
```

---

## Bundled Documentation

The extension includes complete architectural and reference documentation:
- [Configuration Reference](dist/docs/CONFIG_REFERENCE.md)
- [Official Style Guide](dist/docs/STYLE_GUIDE.md)
- [Troubleshooting & Error Codes](dist/docs/TROUBLESHOOTING.md)
- [Release Changelog](dist/docs/CHANGELOG.md)

---

## License

MIT &copy; Craftland Community / Garena Craftland Creators.
