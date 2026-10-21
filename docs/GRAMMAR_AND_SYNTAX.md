# Craftland FC Grammar & Syntax Specification

This document specifies the formal syntax rules, line-break constraints, statement boundaries, and lexical invariants of the Free Fire Craftland Code (FC) language (`.fcg`, `.fcc`) as recognized and formatted by **FC Formatter v5**.

---

## 1. Syntax Authority & Grammar Provenance

- **Grammar Origin**: Derived from Craftland Studio Language Extension `1.11.0` (`craftlandstudio.ffugclanguage-1.11.0`).
- **Core Syntax Bundle**: `dist/server_syntax.js` pinned by SHA-256:
  `fbfe4b87158096a84a9978cb54552b8fe33e24e561807ebee5f2f085463f9367`.
- **Parser Rule Inventory**: 124 ANTLR parser rules categorized into canonical grammar families. Verified against real game scripts and synthetic compiler fixtures.
- **Root Entry Points**:
  - `graphFile` for `.fcg` files (requires at least one `import` header).
  - `headerFile` for `.fcc` files (allows contracts, enums, structs, event signatures).

---

## 2. Statement Boundaries & Virtual EOS (`NLSEMI`)

The Craftland FC lexer does not require explicit semicolons `;` at the end of every line. Instead, it features an automatic statement termination rule: **`NLSEMI` (Newline Semicolon)**.

### A. When Virtual EOS is Inserted
A virtual newline semicolon (`NLSEMI`) is automatically synthesized when a newline character immediately follows:
- An **identifier** or **type keyword** (`int`, `string`, `bool`, `float`, `List`, `Map`).
- A **literal** (`42`, `3.14`, `"hello"`, `true`, `false`).
- A **closing delimiter** (`)`, `]`, `}`).
- A **postfix update operator** (`count++`, `index--`).
- The **`return` keyword** (if followed immediately by a newline without a return expression).

### B. When Virtual EOS is Suppressed (Continuation Lines)
A newline does **NOT** terminate a statement if the preceding token is an incomplete operator or delimiter:
- Binary operators (`+`, `-`, `*`, `/`, `%`, `&&`, `||`, `==`, `!=`, `<`, `<=`, `>`, `>=`).
- Commas (`,`) in call arguments, parameter lists, or collection items.
- Assignment operators (`=`, `:=`, `+=`, `-=`, `*=`, `/=`).
- Opening delimiters (`(`, `[`, `{`).
- Member access dots (`.`).

---

## 3. Strict Line-Break Legality Rules

The Craftland compiler enforces strict requirements on where line breaks are permitted. Formatter layout rules adhere strictly to these invariants:

| Language Construct | Permitted Line Break Position ✅ | Forbidden Line Break Position ❌ |
|---|---|---|
| **Binary Operators** (`+`, `*`, `&&`, `\|\|`) | **After** the operator (`a + \n b`) | **Before** the operator (`a \n + b` is invalid syntax) |
| **Argument & Parameter Lists** | **After** the separating comma (`first, \n second`) | **Before** the comma (`first \n , second`) |
| **Member Access** | **After** the dot (`player. \n GetHealth()`) | **Before** the dot (`player \n .GetHealth()`) |
| **Return Statements** | Return value **must stay on the same line** as `return` | A newline between `return` and its value creates an empty return! |
| **Else / Else-If Headers** | `else` stays on the same line as the preceding `}` | Placing `else` on a separate line below `}` breaks compound flow |
| **Generic Brackets** (`List<T>`) | Generic close `>` stays beside the last type | Putting `>` alone on its own line is rejected by the compiler |
| **Index Access** (`map[key]`) | Index close `]` stays beside the last expression | Breaking `]` to its own line is rejected by the compiler |

---

## 4. Call Roles & Closing Delimiter Layout

Craftland FC grammar distinguishes between different call contexts, which dictate how closing parentheses `)` and trailing commas are formatted:

### A. Bare Calls, Wait Calls, and Start Calls
When a call expression appears as an independent statement:
- It can be wrapped across multiple lines.
- It permits an optional trailing comma `,` after the final argument.
- The closing parenthesis `)` can sit on its own dedicated closing line aligned with the statement.

```fcg
// Valid: Bare call with trailing comma and standalone close
PlayerService.RegisterPlayer(
  playerId,
  initialTeam,
  spawnLocation,
)
```

### B. Value Calls and Return Calls
When a call expression is used as a value (e.g. inside an assignment, return, or nested argument):
- The closing parenthesis `)` **must close beside the last argument**.
- A trailing comma is **forbidden** before the closing parenthesis.

```fcg
// Valid: Value call closes beside last argument
var health = Math.Clamp(
  currentHealth + delta,
  0,
  maxHealth)
```

---

## 5. Collection Literals & Matrix Padding

FC composite collections (`List`, `Map`, `Struct`) follow strict layout rules:

### A. List Composites
- **Flat Layout**: Compact bracket padding `[1, 2, 3]`.
- **Multiline Layout**: Requires a trailing comma `,` after the final element before the closing `]`:
  ```fcg
  var numbers: List<int> = [
    10,
    20,
    30,
  ]
  ```

### B. Map Literals & Struct Fields
- In multiline maps, keys use colon `:`. When collection alignment is enabled (`spacing.collectionAlignment: "auto"`), colons align vertically across sibling entries in broken maps:
  ```fcg
  var inventory: Map<string, int> = {
    "wood"   : 150,
    "iron"   : 40,
    "diamond": 3,
  }
  ```
- In multiline structs, fields use `=`. Assignments align vertically across sibling fields:
  ```fcg
  var config = PlayerConfig{
    MaxHealth     = 100,
    MovementSpeed = 5.5,
    CanRespawn    = true,
  }
  ```

---

## 6. Empty Blocks Invariant

A fundamental contract of FC Formatter v5 is:
> **An empty block always prints as `{}` on a single line, with zero whitespace inside.**

Even if the source originally spanned multiple empty lines, or if `wrap.collections` / `wrap.calls` is set to `"always"`, an empty block is unconditionally normalized:

```fcg
// Normalized to:
func OnReset() {}

graph EmptyService {}
```

*(Note: A block containing comments is not considered empty and retains its multiline structure).*

---

## 7. Protected Literal Bytes & Trivia

- **Multiline Raw Strings**: Strings enclosed in raw quotes preserve their exact internal line-break characters and trailing whitespace without mutation.
- **Comments & JSDoc**: All comments (`//`, `/* ... */`, `/** ... */`) are trivia tokens preserved at exact attachment anchors.
- **BOM Disallowed**: UTF-8 Byte Order Marks (`\uFEFF`) are rejected by the Craftland compiler and are stripped by the formatter.
- **CRLF vs LF Preservation**: When `endOfLine: "preserve"` is configured, files keep their native line ending bytes without conversion.
