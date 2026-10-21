# FC Formatter v5 — Troubleshooting Guide

This guide provides actionable steps to diagnose and resolve common issues encountered when using **FC Formatter v5** via CLI or the VS Code Extension.

---

## 1. Quick Diagnostic Matrix

| Symptom | Primary Cause | Recommended Action |
|---|---|---|
| **Editor fails to format with error banner** | File contains syntax error or unclosed pragma | Check the **Problems panel** (`Ctrl+Shift+M`) for specific line/column diagnostics. Fix syntax before formatting. |
| **Format-on-save reports EOL mismatch** | Document line endings differ from `endOfLine` config | Run **FC Format v5: Format Document** once from the Command Palette, or change editor line endings (`LF`/`CRLF`) at bottom right of VS Code. |
| **Formatting does not change a file** | File is already clean OR ignored | Run `fcfmt --explain-config path/to/file.fcg` to check if file matches an `ignore` pattern or `.fcfmtignore` rule. |
| **Format Selection formats only part of a line** | Range Formatting snaps to line boundaries | In FC, statements require full line bounds. The formatter automatically expands selection to whole lines for syntax safety. |
| **CLI exits with code 1** | Unformatted files detected (`--check`) | Normal behavior in CI mode. Run `fcfmt --write <files>` to apply formatting. |
| **CLI exits with code 2** | Parse failure, config error, or I/O error | Inspect stderr output. Preflight validation stops execution before writing any files if any single file fails parsing. |
| **Stale results when using `--cache`** | Cache contains invalid entries | Delete `.fcfmtcache` or pass `--cache-strategy content` to force byte-by-byte SHA-1 verification. |

---

## 2. CLI Diagnostics & Resolution

### A. Exit Codes
- **`0`**: Success. All files are cleanly formatted and match configuration.
- **`1`**: Formatting differences detected under `--check` or `--diff`.
- **`2`**: Hard error (invalid `.fcfmt.json`, syntax error in source file, invalid command-line flag, or I/O failure).

### B. Diagnosing With `--explain-config`
If a file formats unexpectedly, inspect how configuration was resolved:
```sh
fcfmt --explain-config Assets/Scripts/MyFile.fcg
```
The output reports:
- The path to the active `.fcfmt.json` and `.fcfmtignore`.
- Every effective option value and its **provenance** (`default`, `.editorconfig`, `project`, `overrides[i]`, or `CLI`).
- Whether the file is ignored and the exact rule that caused it.

### C. Clearing or Resetting the CLI Cache
If you suspect cache corruption:
```sh
# Remove the default cache file
rm .fcfmtcache

# Or specify a custom cache location
fcfmt --cache-location /tmp/my-cache --write Assets/Scripts
```

---

## 3. VS Code Extension Diagnostics

### A. Line Ending (EOL) Conflicts
VS Code enforces a single line ending mode per buffer:
1. If your `.fcfmt.json` sets `"endOfLine": "lf"`, but your Windows editor opens the file in `CRLF`, automatic save formatting may be blocked.
2. **Resolution**: Click the **CRLF** button in the VS Code status bar (bottom right), switch to **LF**, and press `Ctrl+S`.

### B. Range Formatting Behavior
When using **Format Selection (`Ctrl+K, Ctrl+F`)**:
- The formatter formats the entire document in memory, then uses Myers line-diffing to extract only the changes that intersect your selection.
- If the file has a fatal syntax error elsewhere in the document, Range Formatting is suppressed to protect your code from corruption.

---

## 4. Common Syntax Diagnostics

### A. Split Compound Operators
```fc
// Invalid: Space inside compound assignment
a + = 10

// Fix: Remove intervening space
a += 10
```

### B. Unclosed Ignore Pragmas
```fc
/* fc-format-ignore-start */
var matrix = [1, 2, 3]
// Error: Forgot to put /* fc-format-ignore-end */
```
The formatter requires all block ignore pragmas to be properly closed; otherwise, it raises an `unmatched-ignore-marker` diagnostic and aborts formatting.

### C. Importless `.fcg` File
Every `.fcg` graph file must contain at least one `import` header:
```fc
// Invalid:
graph MainService {}

// Fix:
import "StdLibrary.fcc" as StdLibrary
graph MainService {}
```

---

## 5. How to Report a Regression

When reporting a formatter bug or unexpected layout:
1. Provide the **formatter version** (`fcfmt --version`).
2. Provide the **smallest reproducible FC source snippet**.
3. Provide the output of `fcfmt --explain-config <file>`.
4. Include both the **actual output** and the **expected output**.
