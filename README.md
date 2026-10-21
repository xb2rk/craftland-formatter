# Free Fire Craftland Code Formatter

[![VS Code](https://img.shields.io/badge/VS%20Code-%3E%3D%201.96-blue.svg)](https://code.visualstudio.com/)
[![Release](https://img.shields.io/badge/Release-v1.1.2-brightgreen.svg)](https://github.com/xb2rk/craftland-formatter/releases)
[![Tests](https://img.shields.io/badge/Tests-252%20Passed-success.svg)](tests/)
[![Dependencies](https://img.shields.io/badge/Dependencies-0%20(Pure%20.mjs)-orange.svg)](package.json)

Production-grade code formatter, static linter, and surgical range-formatting engine for Free Fire Craftland Code (`.fcg`, `.fcc`).

---

## Quick Start (VS Code)

### 1. Install Extension
Download `fc-format-v5-vscode-1.1.2.vsix` from [Releases](https://github.com/xb2rk/craftland-formatter/releases/tag/v1.1.2) and install via:
**Extensions (`Ctrl+Shift+X`) → `...` menu → Install from VSIX...**

### 2. Enable Format on Save
Add to your VS Code `settings.json`:

```json
{
  "[ffugclanguage]": {
    "editor.defaultFormatter": "craftland-community.fc-format-v5-vscode",
    "editor.formatOnSave": true
  }
}
```

### Shortcuts

| Action | Shortcut | Description |
|---|:---:|---|
| **Format Document** | `Shift+Alt+F` | Formats active buffer (whole file) |
| **Format Selection** | `Ctrl+K, Ctrl+F` | Surgically formats selected lines via Myers diff |
| **Organize Imports** | `Shift+Alt+O` | Groups and sorts imports canonically |

---

## Feature Showcase

### 1. Organize & Sort Imports (`Shift+Alt+O`)
Groups and sorts imports in canonical hierarchy: `StdLibrary` &rarr; `Contracts/` &rarr; Project relative scripts.

<table>
<tr><th>Before</th><th>After</th></tr>
<tr>
<td>

```fcg
import "GameLogic.fcg" as GameLogic
import "StdLibrary.fcc" as StdLibrary
import "Contracts/Item.fcc" as Item
import "Contracts/Skill.fcc" as Skill
```

</td>
<td>

```fcg
import "StdLibrary.fcc" as StdLibrary

import "Contracts/Item.fcc" as Item
import "Contracts/Skill.fcc" as Skill

import "GameLogic.fcg" as GameLogic
```

</td>
</tr>
</table>

### 2. Declaration Alignment (Enum, Tuple, Graph Fields)
Aligns `=` in `enum`, and columns (`Name`, `Type`, `=`) in `tuple`, `component`, and `graph` declarations. Blank lines cleanly split alignment groups.

<table>
<tr><th>Before</th><th>After</th></tr>
<tr>
<td>

```fcc
enum EItemType {
  Normal = 0,
  RareRarity = 1,
  LegendaryEquipment = 2,
}

tuple PlantEntry {
  PlantId int = 0,
  DisplayName string = "Default",
  Level int = 1,
}
```

</td>
<td>

```fcc
enum EItemType {
  Normal             = 0,
  RareRarity         = 1,
  LegendaryEquipment = 2,
}

tuple PlantEntry {
  PlantId     int    = 0,
  DisplayName string = "Default",
  Level       int    = 1,
}
```

</td>
</tr>
</table>

### 3. Smart Collections & Map Colon Alignment
Aligns `:` into neat table-like columns. Respects manual line breaks: multiline collections never collapse into a single line.

<table>
<tr><th>Before</th><th>After</th></tr>
<tr>
<td>

```fcg
STATECHAT Map<int, string> ={
    1 : "default",
    2 : "intro",
    3 : "tip",
    4 : "wishSuccess",
}
```

</td>
<td>

```fcg
STATECHAT Map<int, string> = {
  1: "default",
  2: "intro",
  3: "tip",
  4: "wishSuccess",
}
```

</td>
</tr>
</table>

### 4. Intentional Line Preservation (Calls & Parameters)
Single-line method calls and expressions stay intact instead of awkwardly wrapping. Multiline calls retain clean indentation and commas.

<table>
<tr><th>Before</th><th>After</th></tr>
<tr>
<td>

```fcg
_EventContent = UIUtils.GetHUDWidget(thisEntity<Player>, _ActivitiesHUD, Res.Activities[EResKeyActivities.Event]) as entity<UIWidget>
```

</td>
<td>

```fcg
_EventContent = UIUtils.GetHUDWidget(thisEntity<Player>, _ActivitiesHUD, Res.Activities[EResKeyActivities.Event]) as entity<UIWidget>
```

</td>
</tr>
</table>

---

## Project Configuration (`.fcfmt.json`)

Place `.fcfmt.json` at your project root to enforce consistent team styles on Git:

```json
{
  "printWidth": 120,
  "indent": { "style": "space", "size": 2 },
  "alignment": {
    "enums": true,
    "fields": true,
    "collections": true
  },
  "imports": { "sort": true },
  "wrap": {
    "calls": "preserve",
    "parameters": "preserve",
    "collections": "auto"
  },
  "endOfLine": "preserve"
}
```

### Key Options Reference

| Option | Default | Options | Description |
|---|:---:|:---:|---|
| `printWidth` | `120` | `number` | Target maximum line length |
| `indent.size` | `2` | `number` | Number of spaces per indent level |
| `alignment.enums` | `true` | `boolean` | Column-align `=` in `.fcc` enums |
| `alignment.fields` | `true` | `boolean` | Column-align names, types, and `=` in tuples and graph fields |
| `alignment.collections` | `true` | `boolean` | Column-align `:` in maps and `=` in struct literals |
| `imports.sort` | `true` | `boolean` | Group and sort imports canonically |
| `wrap.calls` | `"preserve"` | `"preserve"`, `"auto"`, `"always"` | Preserve single-line calls or auto-reflow |
| `wrap.parameters` | `"preserve"` | `"preserve"`, `"auto"`, `"always"` | Preserve function and event parameter line breaks |
| `wrap.collections` | `"auto"` | `"auto"`, `"preserve"`, `"always"` | Keep multiline collections multiline; auto-wrap long flat lists |
| `endOfLine` | `"preserve"` | `"preserve"`, `"lf"`, `"crlf"` | Respect file line endings or enforce specific ending |

Full list of 20+ options: see [docs/CONFIG_REFERENCE.md](docs/CONFIG_REFERENCE.md).

---

## CLI Quick Reference

The CLI is standalone with zero npm dependencies:

```sh
# Format files in-place
node bin/fcfmt.mjs --write "Assets/Scripts"

# Check formatting without writing (exit code 1 if unformatted)
node bin/fcfmt.mjs --check "Assets/Scripts"

# Print unified diff of proposed changes
node bin/fcfmt.mjs --check --diff "Assets/Scripts"

# High-speed formatting with disk cache
node bin/fcfmt.mjs --write --cache "Assets/Scripts"
```

---

## Development

```sh
# Run all 252 tests
npm test

# Build VS Code extension runtime
npm run build:extension

# Package VSIX
pwsh -NoProfile -File scripts/package-vsix.ps1
```

---

## License

MIT
