# Craftland FC Code Style Guide & Formatting Standards

This document describes the canonical code formatting standards enforced by **FC Formatter v5**.

All examples assume default project configuration unless explicit options are specified. To inspect the effective formatting options applied to any file, run:
```sh
fcfmt --explain-config path/to/file.fcg
```

---

## 1. Imports Organization

When `imports.sort: true` is enabled, file-header imports are automatically grouped and sorted into three standardized tiers separated by a single blank line:

1. **Standard Library & Engine Headers**: Core system imports (`StdLibrary.fcc`, `Database.fcc`, `Map.fcc`).
2. **Contracts & Shared Data**: Inter-module and client/server protocol definitions (`../Contracts/...`).
3. **Local Feature Scripts**: Relative script modules within the same feature area (`./MyFeature.fcg`).

### Example:
````carousel
```fc
// Before formatting (Unsorted, mixed imports)
import "./BattleManager.fcg" as BattleManager
import "StdLibrary.fcc" as StdLibrary
import "../Contracts/CustomEnum.fcc" as CustomEnum
import "Database.fcc" as Database
```
<!-- slide -->
```fc
// After formatting (Clean 3-tier grouping)
import "Database.fcc" as Database
import "StdLibrary.fcc" as StdLibrary

import "../Contracts/CustomEnum.fcc" as CustomEnum

import "./BattleManager.fcg" as BattleManager
```
````

*(Note: Attached comments and alias names `as Alias` move with their respective import lines).*

---

## 2. Graphs & Top-Level Declarations

### A. Decorator Placement
Attributes/decorators such as `[platform_server]`, `[export]`, or `[component]` stay on the line immediately preceding the target declaration, with zero intervening blank lines:

```fc
[platform_server]
static graph FeatureFlags {
  // Members follow with standard 2-space indentation
}
```

### B. Empty Blocks
An empty graph, function, or block **always prints as `{}` on a single line**:

```fc
// Canonical representation of empty structures:
graph EmptyService {}

func OnReset() {}
```

---

## 3. Functions, Events & Signatures

### A. Parameter Wrapping Modes (`wrap.parameters`)
- **`"preserve"` (Default)**: Preserves the author's intentional parameter breaks while normalizing internal spacing and indentation.
- **`"auto"`**: Keeps signatures flat if within `printWidth`; wraps vertically when exceeding column limits.
- **`"always"`**: Forces each parameter onto a separate indented line.

````carousel
```fc
// Default: wrap.parameters = "preserve" (even at narrow width)
func SpawnUnit(unitId int,
  teamId int, location Vector3) {}
```
<!-- slide -->
```fc
// wrap.parameters = "always"
func SpawnUnit(
  unitId int,
  teamId int,
  location Vector3) {}
```
````

*(Note: Function signatures sit on the same line as `)` and do not include a trailing comma).*

---

## 4. Control Flow & Blocks

- Block opening braces `{` stay on the same line as the statement header.
- `else` and `else if` sit on the same line as the preceding closing brace `}`:

```fc
if (playerHealth <= 0) {
  TriggerRespawn(playerId)
} else if (playerHealth < 20) {
  PlayLowHealthVFX()
} else {
  NormalUpdate()
}
```

---

## 5. Operators, Assignments & Logical Chains

### A. Operator Spacing (`spacing.operators` & `spacing.assignment`)
- Binary operators (`+`, `-`, `*`, `/`, `&&`, `||`, `==`, `!=`) use spaced punctuation by default (`a + b`).
- Assignments (`=`, `:=`, `+=`, `-=`) follow `spacing.assignment` (`"inherit"`, `"spaced"`, or `"compact"`).
- Postfix operators (`++`, `--`) bind directly to their operand without spaces (`index++`).

### B. Logical Continuations (`wrap.conditions`)
When a logical condition exceeds `printWidth`:
- The line breaks **after** each `&&` or `||` operator (never before, per FC grammar rules).
- Continuation lines receive `indent.continuation` indentation (default: 1 level = 2 spaces).

```fc
if (isServerReady &&
  playerCount >= MIN_PLAYERS &&
  hasValidGameSession) {
  StartMatch()
}
```

---

## 6. Collections & Matrix Column Alignment

### A. Map Composites
When broken across multiple lines, colons `:` vertically align across entries (`spacing.collectionAlignment: "auto"`):

```fc
var rarityConfig: Map<string, int> = {
  "common"   : 100,
  "rare"     : 25,
  "legendary": 1,
}
```

### B. Struct Composites
Struct assignments `=` align vertically when broken:

```fc
var playerConfig = PlayerData{
  Name       = "Hero",
  Level      = 50,
  IsActive   = true,
}
```

### C. List Composites
Flat lists use compact bracket padding `[1, 2, 3]`. Multiline lists wrap each item with an indent and require a trailing comma `,`:

```fc
var primarySpells: List<string> = [
  "Fireball",
  "FrostNova",
  "LightningBolt",
]
```

---

## 7. Comments, JSDoc & Ignore Pragmas

### A. Comments Preservation
- Attached comments stay anchored to their corresponding statements or collection rows.
- Multiline JSDoc blocks `/** ... */` retain their internal formatting and asterisks.

### B. Format Ignore Pragmas
To exempt custom artistic layouts or tricky legacy code from formatting:

#### 1. Single-Line Ignore: `// fc-format-ignore`
Exempts the statement immediately following the pragma:
```fc
func MatrixTransform() {
  // fc-format-ignore
  var matrix = [1,  0,  0,
                0,  1,  0,
                0,  0,  1]
}
```

#### 2. Block Ignore: `/* fc-format-ignore-start */ ... /* fc-format-ignore-end */`
Exempts an entire region from formatting:
```fc
/* fc-format-ignore-start */
var rawTable = {
   1 : "alpha",
  20 : "beta",
 300 : "gamma"
}
/* fc-format-ignore-end */
```

---

## 8. Recommended Project Configuration (`.fcfmt.json`)

```json
{
  "$schema": "./node_modules/fc-format-v5/schema.json",
  "printWidth": 100,
  "indent": {
    "style": "space",
    "size": 2
  },
  "wrap": {
    "calls": "auto",
    "parameters": "preserve",
    "collections": "auto",
    "conditions": "auto"
  },
  "spacing": {
    "operators": "spaced",
    "assignment": "inherit",
    "collectionAlignment": "auto"
  },
  "endOfLine": "lf",
  "finalNewline": true,
  "imports": {
    "sort": true
  }
}
```
