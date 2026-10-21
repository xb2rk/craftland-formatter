<p align="center">
  <img src="resources/icon.png" width="128" height="128" alt="Free Fire Craftland Code Formatter Logo" />
</p>

<h1 align="center">Free Fire Craftland Code Formatter &amp; Linter</h1>

<p align="center">
  <strong>Production-grade code formatter, static linter, and surgical range-formatting engine for Free Fire Craftland Code (<code>.fcg</code>, <code>.fcc</code>).</strong>
</p>

<p align="center">
  <a href="https://img.shields.io/badge/VS%20Code-%3E%3D%201.96-blue"><img src="https://img.shields.io/badge/VS%20Code-%3E%3D%201.96-blue" alt="VS Code" /></a>
  <a href="https://img.shields.io/badge/Release-v1.1.2-brightgreen"><img src="https://img.shields.io/badge/Release-v1.1.2-brightgreen" alt="Release" /></a>
  <a href="https://img.shields.io/badge/Runtime-Pure%20.mjs%20(0%20deps)-orange"><img src="https://img.shields.io/badge/Runtime-Pure%20.mjs%20(0%20deps)-orange" alt="Zero Dependencies" /></a>
  <a href="https://img.shields.io/badge/Tests-252%20Passed-success"><img src="https://img.shields.io/badge/Tests-252%20Passed-success" alt="Tests" /></a>
</p>

---

## Overview

**Free Fire Craftland Code Formatter** brings production-grade code formatting, surgical range formatting, and static code linting to Free Fire Craftland UGC development. It shares the exact same Wadler-Leijen layout engine, lossless CST parser, and dual-layer AST invariant defense as the standalone `fcfmt` CLI.

- ⚡ **Zero Runtime Dependencies**: Pure `.mjs`, instant activation (<5ms), 0 npm bloat.
- 🎯 **Format Document & Selection**: Whole-buffer formatting (`Shift+Alt+F`) and surgical range formatting (`Ctrl+K, Ctrl+F`).
- 📦 **Organize Imports**: Group and sort library, contract, and local script imports (`Shift+Alt+O`).
- 🛡️ **Dual-Layer AST Defense**: Mathematical token invariance guarantees formatting will never alter code semantics or introduce compiler errors.
- 🔍 **Integrated FC Linter**: Detects freeze hazards (step 0 loops), unreachable code, self-comparisons, and unused imports.
- ⚙️ **Native VS Code Settings**: Configure all 20 options directly in VS Code UI (`Ctrl+,` &rarr; `fc-format.*`) or commit `.fcfmt.json` for team-wide Git synchronization.
- 🗂️ **Active Editor Fallback**: Automatically inherits your editor's `tabSize` and `insertSpaces`.

---

## Installation & Setup

### 1. Install from VSIX
1. Download `fc-format-v5-vscode-1.1.2.vsix` from [Releases](https://github.com/xb2rk/craftland-formatter/releases).
2. In VS Code, go to **Extensions** (`Ctrl+Shift+X`).
3. Click the **`...`** (Views and More Actions) menu in the top-right corner.
4. Select **Install from VSIX...** and pick the downloaded `.vsix` file.

### 2. Configure Format on Save
Add the following to your VS Code `settings.json`:

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

| Action | Shortcut | Description |
|---|:---:|---|
| **Format Document** | `Shift+Alt+F` | Formats active buffer (whole file) |
| **Format Selection** | `Ctrl+K, Ctrl+F` | Surgically formats selected lines via Myers diff |
| **Organize Imports** | `Shift+Alt+O` | Groups and sorts imports canonically |
| **Preview Formatting** | Command Palette | Opens a read-only side-by-side diff without touching disk |
| **Explain Configuration** | Command Palette | Inspects resolved config leaves and provenance |

---

## Feature Showcase

### 1. Organize & Sort Imports (`Shift+Alt+O`)
Automatically classifies and sorts imports into canonical layers: Standard Libraries &rarr; Parent Modules (`../`) &rarr; Local Submodules (`./`).

<table>
<tr><th>Before</th><th>After</th></tr>
<tr>
<td>

```fcg
import "./UI/HUDController.fcg" as HUDController
import "../Data/ItemCatalog.fcg" as ItemCatalog
import "StdLibrary.fcc" as StdLibrary
import "EditorGenLib.fcc" as EditorGenLib
import "./Core/Combat.fcg" as Combat
import "../Systems/Inventory.fcg" as Inventory
```

</td>
<td>

```fcg
import "StdLibrary.fcc" as StdLibrary
import "EditorGenLib.fcc" as EditorGenLib

import "../Data/ItemCatalog.fcg" as ItemCatalog
import "../Systems/Inventory.fcg" as Inventory
import "./Core/Combat.fcg" as Combat
import "./UI/HUDController.fcg" as HUDController
```

</td>
</tr>
</table>

### 2. Declaration Alignment (Enum, Tuple, Graph Fields)
Aligns `=` in `enum`, and columns (`Name`, `Type`, `=`) in `tuple`, `component`, and `graph` declarations.

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
Aligns `:` into neat table-like vertical columns. Respects manual line breaks: multiline collections never collapse into a single line.

<table>
<tr><th>Before</th><th>After</th></tr>
<tr>
<td>

```fcg
ItemPrices Map<string, int> = {
  "wood": 10,
  "iron_ingot": 75,
  "golden_coin": 500,
  "diamond_gem": 2500,
}
```

</td>
<td>

```fcg
ItemPrices Map<string, int> = {
  "wood"       : 10,
  "iron_ingot" : 75,
  "golden_coin": 500,
  "diamond_gem": 2500,
}
```

</td>
</tr>
</table>

### 4. Multiline Calls & Argument Formatting
Transforms messy, irregular multiline arguments and operators into clean, consistently indented parameters with grammar-safe delimiters.

<table>
<tr><th>Before</th><th>After</th></tr>
<tr>
<td>

```fcg
var damage = CombatSystem.CalculateDamage(attacker,target,
    baseDamage+bonusDamage,  critRate * 2, true )
```

</td>
<td>

```fcg
var damage = CombatSystem.CalculateDamage(
  attacker,
  target,
  baseDamage + bonusDamage,
  critRate * 2,
  true)
```

</td>
</tr>
</table>

---

## Configuration Hierarchy

CFO / team style settings are resolved using strict deterministic precedence:

$$\text{Defaults} \longrightarrow \text{.editorconfig} \longrightarrow \text{VS Code Settings GUI} \longrightarrow \text{Active Editor Indent} \longrightarrow \mathbf{.fcfmt.json} \longrightarrow \text{CLI Flags}$$

### Project Configuration (`.fcfmt.json`)

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

---

## License

MIT
