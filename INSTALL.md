# FC Format v5 — Installation and Usage Guide

This guide explains how to install, configure, verify, rebuild, and use the **FC Format v5** VS Code extension for Craftland `.fcg` and `.fcc` files.

---

## 1. Quick Install (Pre-built VSIX)

The extension is already compiled and packaged as a standalone VSIX file:

- **VSIX Path**: [`extension/fc-format-v5-vscode-0.9.0.vsix`](extension/fc-format-v5-vscode-0.9.0.vsix)
- **Version**: `0.9.0`
- **Dependencies**: None. The VSIX includes its complete JavaScript runtime (`extension/dist/`) and needs no external `node_modules` or global Node.js installation in the editor.

### Method A: Install via VS Code GUI
1. Open **VS Code** (or Cursor / Windsurf).
2. Open the **Extensions view** (`Ctrl+Shift+X` on Windows/Linux, `Cmd+Shift+X` on macOS).
3. Click the three dots menu (**⋯**) at the top right of the Extensions pane.
4. Select **Install from VSIX…**.
5. Browse to `tools/fc-format-v5/extension/fc-format-v5-vscode-0.9.0.vsix` and click **Install**.
6. When prompted, reload or restart the editor.

### Method B: Install via Terminal / CLI
Run the standard VS Code command line installer:

~~~sh
code --install-extension tools/fc-format-v5/extension/fc-format-v5-vscode-0.9.0.vsix
~~~

*(For Cursor, use `cursor --install-extension ...`; for VS Code Insiders, use `code-insiders --install-extension ...`)*.

---

## 2. Editor Configuration (`settings.json`)

To set FC Format v5 as the default formatter and enable automatic formatting on save, add the following to your VS Code User or Workspace `settings.json`:

~~~json
{
  "[ffugclanguage]": {
    "editor.defaultFormatter": "fc-format.fc-format-v5-vscode",
    "editor.formatOnSave": true
  },
  "files.associations": {
    "*.fcg": "ffugclanguage",
    "*.fcc": "ffugclanguage"
  }
}
~~~

> [!NOTE]
> `ffugclanguage` is the official language identifier provided by Craftland Studio's language extension for syntax highlighting. The formatter registers for both `ffugclanguage` and `.fcg`/`.fcc` file patterns directly.

---

## 3. How to Use the Extension

### A. Format Entire Document
- **Shortcut**: `Shift + Alt + F` (Windows/Linux) or `Shift + Option + F` (macOS).
- **Command Palette** (`Ctrl+Shift+P`): Run **FC Format v5: Format Document**.
- **On Save**: Automatically formats when saving if `"editor.formatOnSave": true` is enabled.

### B. Format Selected Code (Range Formatting)
- Select the block of code or lines you wish to format.
- **Shortcut**: `Ctrl + K, Ctrl + F` (Windows/Linux) or `Cmd + K, Cmd + F` (macOS).
- **Command Palette**: Run **Format Selection**.
- **Behavior**:
  - Automatically snaps to surrounding line boundaries.
  - Formats *only* the intersecting lines using line-level Myers diffing (`computeLineHunks`).
  - Leaves non-selected lines untouched byte-for-byte.

### C. Preview Formatting (Safe Diff View)
- Open any `.fcg` or `.fcc` file.
- Press `Ctrl+Shift+P` and select **FC Format v5: Preview Formatting**.
- Opens a side-by-side read-only diff comparing your current buffer with the proposed formatted output without making any changes to disk.

### D. Explain Configuration
- Press `Ctrl+Shift+P` and select **FC Format v5: Explain Configuration**.
- Opens a JSON document displaying all resolved style options, their provenance (default vs `.editorconfig` vs `.fcfmt.json` vs file overrides), and whether the file is currently ignored.

---

## 4. Project Configuration (`.fcfmt.json`)

Place a `.fcfmt.json` file in your repository root (or run `npx fcfmt --init` from the CLI). A standard starting configuration:

~~~json
{
  "printWidth": 120,
  "indent": {
    "style": "space",
    "size": 2,
    "continuation": 1
  },
  "alignment": {
    "collections": true
  },
  "endOfLine": "lf",
  "spacing": {
    "operators": "spaced",
    "assignment": "inherit",
    "comma": "spaced",
    "brackets": "tight"
  },
  "imports": {
    "sort": false
  },
  "blankLines": {
    "maxConsecutive": 1,
    "afterImports": "always",
    "betweenMembers": "preserve"
  },
  "wrap": {
    "calls": "auto",
    "parameters": "preserve",
    "collections": "auto",
    "conditions": "auto"
  }
}
~~~

> [!TIP]
> The extension includes a bundled JSON Schema. In any `.fcfmt.json` file, VS Code automatically provides IntelliSense completions and hover documentation for every available option without needing internet access.

---

## 5. How to Rebuild the VSIX from Source

If you modify the formatter core or extension source, follow these steps to rebuild the runtime and package a new `.vsix`:

### Prerequisites
- Node.js 20 or later.
- PowerShell 7 (`pwsh`) for zero-dependency packaging, or `@vscode/vsce` if using npm packaging.

### Step 1: Build the Extension Runtime Distribution
From `tools/fc-format-v5`:

~~~sh
node scripts/build-extension.mjs
~~~

*This packages all 23 core runtime files into `extension/dist/core/` and copies documentation and schemas into `extension/dist/docs/`.*

### Step 2: Package into VSIX
Run the PowerShell packaging script (use `-Force` to overwrite an existing package):

~~~sh
pwsh -NoProfile -File scripts/package-vsix.ps1 -Force
~~~

Alternatively, if you have `@vscode/vsce` installed:

~~~sh
cd extension
npm run package:vsix
~~~

### Step 3: Run Extension Tests
Verify extension functionality with the automated test suite:

~~~sh
# Run headless unit tests for extension provider logic
npm run test:extension

# Or test with the full Extension Host harness (requires local VS Code)
npm run test:extension:host
~~~

---

## 6. How to Inspect VSIX Contents

A `.vsix` file is an Open Packaging Convention (OPC) zip archive. You can inspect its internal structure using PowerShell:

~~~powershell
# View archive contents without extracting
pwsh -Command "[System.IO.Compression.ZipFile]::OpenRead('extension/fc-format-v5-vscode-0.9.0.vsix').Entries | Select-Object FullName, Length"
~~~

Or extract it manually:
1. Rename `fc-format-v5-vscode-0.9.0.vsix` to `fc-format-v5-vscode-0.9.0.zip`.
2. Extract the zip archive. Inside the `extension/` folder you will find:
   - `package.json`: Extension manifest and configuration definitions.
   - `dist/extension.cjs`: VS Code extension entry point.
   - `dist/core/`: The complete lossless CST and layout formatting engine.
   - `dist/docs/`: Bundled user guides and configuration references.

---

## 7. Troubleshooting

| Symptom | Cause | Solution |
|---|---|---|
| **"Configure Default Formatter..." prompt appears** | No default formatter is assigned for FC files. | Select **FC Format v5**, or add `"[ffugclanguage]": { "editor.defaultFormatter": "fc-format.fc-format-v5-vscode" }` to `settings.json`. |
| **Formatting does nothing on save** | The active file has a syntax error or is matched by `.fcfmtignore`. | Check the **Problems** tab (`Ctrl+Shift+M`) for parser diagnostics, or run **Explain Configuration** to check if the file is ignored. |
| **EOL warning reported in Problems tab** | File line endings (CRLF vs LF) differ from configured `endOfLine`. | Press `Ctrl+Shift+P` and run **FC Format v5: Format Document** once to convert the buffer line endings, then save. |
| **Changes not visible after installing new VSIX** | VS Code cached the previous extension version in memory. | Press `Ctrl+Shift+P` and run **Developer: Reload Window**. |
| **Selection formatting changes surrounding lines** | Selection range crossed statement boundaries. | Range formatting automatically expands to full line boundaries to preserve valid syntax layout. |
