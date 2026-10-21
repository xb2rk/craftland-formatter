# FC Formatter Specification (FORMATTER_SPEC)

> **Status:** Phase‑0 grammar audit **APPLIED** (verified against the authoritative
> ANTLR‑generated parser/lexer shipped in the installed VS Code extension). All corrections
> and their evidence are recorded in **§1b Verified grammar audit**. When this doc and the
> compiled grammar disagree, the compiled grammar wins; the discrepancy + evidence must be
> logged in §1b so the next reader is not re‑deriving from scratch.

Canonical, single-style formatting rules for FC (Craftland Studio `.fcg` / `.fcc`).
This document is the source of truth for the **v2** formatter contract under
`tools/fc-format-v2/` (a fresh rewrite; the legacy v1 `tools/fc-format/` is superseded).
It is derived from the real grammar artifacts. The compiler oracle remains the authority for
compile-sensitive decisions, but a full passing oracle run is not currently established in this
repository; claims of compiler verification below are requirements unless explicitly marked as
verified. See also `FC_LINTER_SPEC.md` for the sibling v2 linter.

> **One canonical style.** There are no presets. A small number of choices are *configurable*
> (Tier 3, see §2) but the default is fixed and the project convention uses the default.

---

## §0 Invariants (MUST hold for every formatted file)

1. **Round-trip compiles.** `format(x)` must still compile: `fccompile_external.exe -i Assets`
   exits 0 on the formatted project.
2. **Idempotent.** `format(format(x)) === format(x)` (byte-stable).
3. **No semantic change.** Formatting never reorders statements, changes operators, or alters
   literal values. It only changes whitespace, line breaks, and grammar-forced trailing commas.
   Imports may be sorted only inside an individual contiguous import run; the formatter MUST NOT
   rewrite across a declaration, delete intervening source, or merge separated import runs.
4. **Deterministic.** Same input → same output, independent of file order.

---

## §1 Grammar & syntax references (authoritative on-disk artifacts)

The formatter must follow the FC grammar. The grammar artifacts available on this machine:

| Artifact | Path | Role |
|---|---|---|
| Compiled lexer/parser | `%VSCEXT%/dist/server_syntax.js` | Primary ANTLR4-generated lexer/parser bundle used by v2. `server_semantic.js` is retained as secondary semantic-language-server evidence; neither bundle ships the `.g4` sources. |
| TextMate grammar | `%VSCEXT%/syntaxes/ffugclanguage.tmLanguage.json` | Highlighting; scope `source.ffugclanguage`. Useful for token classification. |
| Language config | `%VSCEXT%/language-configuration.json` | Comment pairs `//` + `/* */`, bracket pairs `{}` `[]` `()`, auto-closing, indentation rules. |
| Built-in libs | `%VSCEXT%/library/release/*.fcc` (StdLibrary, Math, List, Map, Convert, Strings, Hud, Camera, Avatar, AirDrop, …) | Real FC code + built-in type/func definitions. |
| Extension instructions | `%VSCEXT%/github/copilot-instructions.md` | States source grammar = `grammars/FCGLexer.g4` + `grammars/FCGParser.g4` (ANTLR4), compiled into `src/parser`. **The `.g4` source is NOT shipped in the installed extension** - only the compiled `dist/*.js` is. Do not cite a local `.g4` path. |
| Agent grammar doc | `.craftland/agents/references/fc-syntax.md` | Derived, human-readable grammar summary (local copy). |
| Compiler oracle | `fccompile_external.exe -i Assets` (located under Craftland Studio `resources/LocalData/Utilities/UGCLanguage/release/`) | The ground-truth checker for "does this compile?". |

`%VSCEXT%` = the installed extension dir. On this machine it resolves to:
```
C:\Users\N0BODY\.vscode\extensions\craftlandstudio.ffugclanguage-1.10.1
```
(So `%VSCEXT%/dist/server_syntax.js` = `C:\Users\N0BODY\.vscode\extensions\craftlandstudio.ffugclanguage-1.10.1\dist\server_syntax.js`.)

**Verification protocol (used throughout this spec):** when a rule's grammar status is in doubt,
stage a minimal isolated `.fcg` in a disposable temporary project containing the required
`editorGen` symbols, compile it with `fccompile_external.exe`, record the exit code/stderr, and
discard only the temporary directory. Never alter or reset the project corpus as part of an audit.
There is currently no passing full-project oracle result recorded here. The repository's oracle
integration and CLI entrypoints must be repaired before a 161-file compile result can be claimed.
Targeted literal and comma fixtures remain the evidence required before promoting a formatting
observation to a grammar claim.

---

## §1b Verified grammar audit (Phase 0 - applied)

These points were re‑derived from the **compiled ANTLR parser** (`%VSCEXT%/dist/server_syntax.js`,
class `FCGParser` - the shipped parser artifact) and re‑conciled with the spec. Each entry
records **what was believed**, **what the compiled grammar actually says**, **where the evidence is**
(byte offset into the minified bundle), and **the accepted decision** (user‑conciliated).

| # | Topic | Earlier belief (spec/v1) | Compiled grammar says | Evidence (offset / rule) | Accepted decision |
|---|---|---|---|---|---|
| V1 | Import alias (`qualifiedIdent`) | v1 `rules/imports.ts` `readQualified()` allowed **dotted** alias like `EditorGenLib.Res` | `qualifiedIdent := general_identifier_token` = **ONE token** (no dot). `general_identifier_token` ∈ `ELEMENT | FROM | TYPE | COLOR | LIST | MAP | ENTITY | IDENTIFIER`. Dots in qualified *types* belong to `domainType := qualifiedIdent DOT typedIdent`, and dots in expressions are **postfix member access** (`expression` recursion case 12: `_op_host DOT _op_target`), NOT an import alias. | Compiled ANTLR parser rule names in the installed 1.10.1 bundle | **Alias = 1 token, never dotted.** Calls like `StdLibrary.Clone(x)` / `Convert.ToString(x)` are ordinary `.` member access on an identifier - the formatter does NOT model a dotted alias. |
| V2 | Backtick string | §13 said "backticks are NOT a raw-string literal in this corpus" (token didn't exist) | Lexer emits `RAW_STRING_LIT` (id 119) for `` `…` `` and parser `string_()` accepts `RAW_STRING_LIT \| INTERPRETED_STRING_LIT` | `FCGLexer.RAW_STRING_LIT = 119`; parser rule `string_()` in the installed bundle | **Backtick = `RAW_STRING_LIT`.** Tokenizer must produce it; formatter treats it as atomic (never split). §13 corrected. |
| V3 | Library import alias | §12/G2 implied `import "X.fcc"` (alias optional) | `importFile := IMPORT string_ AS qualifiedIdent` - **alias is REQUIRED** (no optional). Omitting it is a parser error (`No viable alternative at input 'import "List.fcc"'`). | Compiled `importFile` rule in the installed parser bundle | **Library import always has `as Alias`.** The "empty alias → drop `as`" fix (G2) applies **only** to the script form (V4). |
| V4 | Script import alias | alias required (R8), formatter MAY drop empty alias | `importPartFile := IMPORT IDENTIFIER (AS qualifiedIdent)? FROM string_` - the `AS alias` clause is **OPTIONAL** | Compiled `importPartFile` rule in the installed parser bundle | **Script form MAY omit alias**; emit `import Name from "path"` when alias is empty (G2 fixed, script form only). |
| V5 | `wait`/`start` | v1 treated `wait X(...)` as `WAIT` + call statement | `wait`/`start` are **prefix operators on an expression** (`_func_call_type` ∈ `START|WAIT`) wrapping a target expression then `(...)`. They appear in BOTH `funcCallStatement` and `expression`. | Compiled `expression` and `funcCallStatement` rules in the installed parser bundle | Formatter keeps `wait <call>` / `start <call>` as ONE logical unit; do not break right after `wait`/`start` (§11). Modeling them as prefix-expression is enough for layout. |
| V6 | `switch`/`case` statement | spec §11 already said "no `switch`" | Confirmed: parser `ruleNames` array contains **no** `switchStmt`/`caseStmt` (only `elseIfBranchStmt`); `SWITCH`/`CASE` tokens exist in the lexer but are dead in the parser. | `FCGParser.ruleNames` (no switch/case statement rules) | No `switch`/`case` statement is emitted or formatted. Keep lexer tokens for compat, but no statement handling. |
| V7 | Token vocabulary | v1 token IDs 1..129 | The v1 `tokenizer.ts` TokenKind enum **matches FCGLexer IDs 1..129 exactly** (verified against the `FCGLexer.X = n` block). | `FCGLexer.<NAME> = n` assignments in `dist/server_syntax.js` | **Vocabulary is reusable as the canonical reference**: v2 regenerates `grammar.generated.ts` from `FCGLexer.*` IDs (not copied from v1 source text). |

> **Why this section exists:** during the v2 rewrite the previous spec drifted from the compiled
> grammar in four places (V1–V4). Recording the evidence + accepted decision here means a future
> session does not have to re-run the forensic compiled-bundle audit; it can trust §1b and
> re-verify only if the extension version changes.

---

## §2 Rule tiers (3-tier classification)

Every rule below is tagged with a tier. This decides whether the formatter may deviate and whether
the linter may flag.

- **Tier 1 - GRAMMAR (hard).** Required by the parser. The formatter applies it *silently* (it is
  not a style choice). The linter reports it as an **error** if the source violates it. Not
  configurable. Violating it makes the file fail to compile.
- **Tier 2 - CONVENTION (default on).** Project convention from `docs/CODING_CONVENTION.md`.
  Default formatter behaviour follows it; the linter reports violations (mostly warnings, some
  errors). Convention is fixed for this project (no per-user override).
- **Tier 3 - STYLE (configurable).** Purely cosmetic. Governed by a config knob (§16). The linter
  does **not** flag Tier 3 (it is the user's choice). Idempotency holds for every knob value.

| # | Rule | Tier | Knob (if T3) |
|---|---|---|---|
| R1 | No TS/C# param syntax `name: Type` | GRAMMAR | - |
| R2 | Return type after params: `func F(a int) int` | GRAMMAR | - |
| R3 | No `var` on graph fields (use header decls) | GRAMMAR | - |
| R4 | No constructor-call `Vector3(1,2,3)`; use `Vector3{1,2,3}` | GRAMMAR | - |
| R5 | No `.wait()` form; use `wait X()` statement | GRAMMAR | - |
| R6 | No `switch`/`case` statement emission (parser has no such rule) | GRAMMAR | - |
| R7 | No package-cache import path (`../.craftland/...`) | GRAMMAR | - |
| R8 | Library import `import "X.fcc" as Alias` MUST always have an alias (grammar `importFile`). Script import `import Name as Alias from "x"` alias is OPTIONAL (grammar `importPartFile`) - see §1b V3/V4 | GRAMMAR | - |
| R9 | Positional data-type literal `Type{a,b}`: flat stays one line; long data may break via `wrapCollections`/`callBreakStyle`; flat never has a trailing comma; broken data requires one | STYLE (layout) + GRAMMAR (comma) | `wrapCollections`, `callBreakStyle` |
| R10 | Multiline data/struct/map literal requires a trailing comma; flat literals never have one | GRAMMAR | - |
| R11 | Multiline bare/statement call, including `wait`/`start`, requires a trailing comma; assignment calls and calls used by `return` forbid it | GRAMMAR | - |
| R12 | `if`/`for`/`while` condition has no wrapping parens | CONVENTION | - |
| R13 | Naming (func PascalCase, field `_PascalCase`, local camelCase, …) | CONVENTION | - |
| R14 | Import order (7 internal buckets, 4 visual groups, only within contiguous runs) | CONVENTION | - |
| R15 | Platform decorator on `.fcg` graph/static graph, or `.fcc` event; never on a handler | CONVENTION | - |
| R16 | Enum member namespace `<Domain>_<Thing>` | CONVENTION | - |
| R17 | Event name prefix `Request_`/`Notify_`/`Fact_`, except lifecycle `On[A-Z]...` | CONVENTION | - |
| R18 | Every public declaration has `/** */` JSDoc | CONVENTION | - |
| R19 | Spaces around assignment operators | STYLE | `spaceAroundOperators` |
| R20 | Spaces around binary operators | STYLE | `spaceAroundOperators` |
| R21 | Spaces inside `()`, `[]`, `{}` | STYLE | `spaceInsideParens`, `spaceInsideBrackets`, `spaceInsideBraces` |
| R22 | `Type{` vs `Type {` (composite-literal brace attachment) | STYLE | `bracketSpacing` |

---

## §3 Lexer facts the formatter MUST know

These come from `src/lex/tokenizer.ts` + the grammar artifacts.

- **`COLOR_HEX_LIT`** is a single token: `#` followed by exactly six or eight hex digits
  (`#RRGGBB`, `#RRGGBBAA`). DO NOT emit `#`, the decimal/identifier pieces separately.
  `#7CCC66` is ONE token, not `#` + `7` + `CCC66`. Malformed `#` input is not repaired by the
  formatter; it follows the malformed-source policy in §15. (Bug G1.)
- **Unary vs binary `-`/`+`:** the lexer emits `MINUS`/`PLUS` for both. Determine unary by the
  *previous non-comment token*: if it is `null` or an *expression-ending* token
  (`IDENTIFIER`, `DECIMAL_LIT`, `FLOAT_LIT`, `HEX_LIT`, `COLOR_HEX_LIT`, `STRING`, `R_PAREN`,
  `R_BRACKET`, `R_CURLY`, `++`, `--`, `*`, `/`, `%`, `==`, `!=`, `<`, `>`, `<=`, `>=`), the sign
  is **binary** (needs surrounding spaces). Otherwise it is **unary** and clings to its operand
  (`-2`, `-value`). Unary cling is **not configurable** (G9).
- **`<` is overloaded:** generic param list (`List<int>`), comparison (`a < b`), and component
  access (`thisEntity<Transform>.Position`). The formatter clings `<…>` to the preceding type
  name with no spaces either way; it does not need to disambiguate for layout.
- **`=` vs `==`:** single `=` = `ASSIGN` (used for `var x = …` and struct-literal `Field = value`);
  `==` = `EQUALS` (comparison). Struct/tuple literal field assignment uses `ASSIGN`, never `EQUALS`.
- **`out var`** is a param modifier pattern: `func F(v int, out var ok bool)`. `out` and `var` are
  keywords; the type follows `var`. Keep `out var` together with no space between `out`/`var`.
- **Decorators** are `[…]` attributes before a declaration: `[readonly]`, `[platform_server]`,
  `[platform_client]`, `[accept entity<Player>]`, `[combine A, B]`, `[bridging]`. They are not
  collections to be broken; keep on one line, attached to the following declaration (one space).
  In `.fcg`, a platform decorator belongs to the graph/static graph declaration. In `.fcc`,
  platform decorators may belong directly to an `event`; adjacent `[platform_client]` and
  `[platform_server]` decorators mean that the event is exposed to both sides. These contract
  decorators are valid and must not be treated as handler-level decorators.
- **Comments:** `//` line comment and `/* */` block comment. Block comments may contain `*/`-like
  text only when balanced.

---

## §4 Layout engine

The formatter builds a `Doc` tree (see `src/print/doc.ts`) using prettier-style primitives:
`text`, `concat`, `group`, `softline`, `hardline`, `line`, `indent`, and `ifBreak`. The printer (`printDoc`)
renders `softline` as empty-or-newline depending on line width; `hardline` always breaks; `line` is
a space in flat mode and a newline in break mode. `group` decides break/flat for its subtree.

A delimiter `emitDelimiter(open, close, items, cfg)` produces:
- **Flat path** when the whole thing fits on one line (or forced `mode === "never"`).
- **Break path** otherwise: `open` + indent(leadingBreak + segments joined by `,` + line) +
  softline + `close`. `leadingBreak` is `softline()` for blocks/composites and for calls under
  `callBreakStyle = "breakAll"` (default); `nil()` for calls under `callBreakStyle = "hugFirst"`
  (so calls keep the first argument on the opener line, gofmt style).

---

## §5 Whitespace rules

All spacing decisions flow through `shouldSpaceBefore(prev, cur, next, atLineStart, items, idx, matching)`.

### §5.1 Assignment / declare (R19, Tier 3)
- `var x = value`, `x := value`, `Field = value`, `func F() int {` → space both sides of `=`/`:=`
  by default (`spaceAroundOperators = true`).
- Configurable: `spaceAroundOperators = false` → `x=value`. Assignment and binary operators use
  the same boolean setting; there is no separate `spacesAroundAssignment` knob.

### §5.2 Unary sign (Tier 1 - not configurable)
- Unary `-`/`+` clings to operand: `-2`, `-value`, `+1`. NEVER `- 2`.
- Binary `-`/`+` follows §5.3.

### §5.3 Binary operators (R20, Tier 3)
- Default (`spaceAroundOperators = true`): `a - b`, `a + b`, `a * b`, `a == b`, `a && b`.
- `spaceAroundOperators = false`: `a-b`.
- **Asymmetric forms `a -b` / `a- b` are ALWAYS normalized to the symmetric choice** (per the knob);
  the formatter never emits or preserves an asymmetric spacing. (Decision: asymmetric is not a
  supported style.)
- Chained comparisons keep symmetric spacing: `a < b && b < c`.
- Unary within an operand still clings: `a - b` next to `-3` in `Math.RandomFloat(a - b, -3)`.

### §5.4 Generic `<>` (Tier 1)
- `List<int>`, `Map<string,int>`, `entity<Player>`, `thisEntity<Transform>` → no spaces inside `<>`.

### §5.5 Call `(` (Tier 1)
- `(` clings to identifier / `)` / `]` / `}` / `>` / `]` preceding it: `F(`, `List.Append(`,
  `f()(` (call result call). One space before `(` only if the preceding token is a keyword that
  requires it (e.g. `if (` is forbidden by project convention - see R12; `func F(` no space; `for (` forbidden).

### §5.6 Composite-literal `{` attachment (R22, Tier 3)
- `Type{` clings by default (`bracketSpacing = "none"`): `GardenPlacement{`,
  `LocString{`, `Vector3{`, `Map<int,int>{`.
- `bracketSpacing = "space"`: `Type {`.
- **Exception (Tier 1):** a *statement block* `{` (function body, `if/else/for/while` body) ALWAYS
  gets a space before it: `func F() int {`, `if a == b {`, `for i, item in items {`. This is
  decided by `isBlockOpen`, which runs FIRST and overrides the cling rule. So `func F() List<List<object>> {`
  keeps its space (bug G10). `return GardenPlacement{` clings (composite literal, not a block).

### §5.7 Empty composite `= {}` (Tier 1 spacing)
- `var m Map<UUID, entity<Player>> = {}` keeps the space before `{}` (the `=` spacing rule applies;
  `{}` is empty so no inner content). Never `={}`.

---

## §6 Delimiter layout (calls, collections, composites)

`emitDelimiter` classifies the delimiter into one of: **BLOCK**, **CALL**, **DATA**, **STRUCT**,
**MAP**.

- **BLOCK** (`isBlockOpen` true, i.e. function/if/for/while body): always breaks; body is a single
  segment (not comma-split); leading + trailing `softline`; never column-aligned.
- **CALL** (function call `(`): when broken, layout follows `callBreakStyle` (default `"breakAll"`):
  each argument on its own line including the first - `Track(\n  a,\n  b,\n)`. `callBreakStyle = "hugFirst"`
  keeps the first argument on the opener line. A bare/statement call, including `wait` and `start`,
  requires a trailing comma when multiline. A call assigned to a variable or used by `return` forbids
  that comma, and its closing `)` stays on the line of the final argument (or final composite `}`).
- **DATA** (positional data-type literal `Type{a,b,c}` - no top-level `=`/`==`/`:`): may break via
  `wrapCollections` (default `auto`). Short `Vector3{...}`/`List<int>{...}` stays flat; long data
  follows `callBreakStyle`. Flat data never has a trailing comma; broken data requires one. The
  `trailingComma` knob cannot suppress this grammar requirement.
- **STRUCT** (tuple/struct literal `Type{Field = value, …}` - has top-level `ASSIGN`): may break via
  `wrapCollections`; fields use `Field = value` and are column-aligned per §14. There is no separate
  `structBreakStyle` knob. Flat structs have no trailing comma; broken structs require one.
- **MAP** (`{key: value, …}` - has top-level `:`): may stay flat or break according to
  `wrapCollections`; entries are column-aligned per §14 in either layout. Flat maps have no trailing
  comma; broken maps require one.

**Trailing comma (R10/R11):**
- Multiline data/struct/map literals and multiline bare/statement calls → trailing comma REQUIRED.
- Flat literals/calls → trailing comma FORBIDDEN.
- Assignment calls and calls used by `return` → trailing comma FORBIDDEN, even when multiline. Their
  closing `)` stays with the final argument or final composite `}`: `value = F(\n  Type{\n    A,\n  })`.
- A bare statement call whose last argument is a multiline composite literal ends with `,` before `)`;
  `})` is the permitted combined closing form for assignment/return calls only.

---

## §7 Vertical spacing

- Project defaults are 2-space indent (no tabs), LF line endings, and UTF-8. The formatter is generic:
  `useTabs`, `tabWidth`, and `endOfLine` may override those defaults when explicitly configured.
- One blank line between top-level decls (func/graph/tuple/enum). No blank line at file start/end.
- Blank line between an import run and its following declaration, and between the four rendered import
  groups (R14), when those groups are present.
- Trailing whitespace, blank-line collapse, and the final newline follow §15 and their config knobs.

---

## §8 Comments

- `//` line comment: kept on its own line or trailing. Trailing comment keeps one space before it.
- `/* */` block comment: preserved verbatim (including internal newlines). Whitespace inside a
  comment/string/raw-string protected range is never normalized. Doc comments use `/** */` JSDoc
  style (R18) for every public declaration.
- Comments are attached to the following item (not separated) unless they start a paragraph.

---

## §9 Line width

- Default `printWidth = 100`. In `auto` mode, when a group exceeds it, the group breaks (softlines
  become newlines). In `never` mode, the formatter keeps the group flat even if the result exceeds
  `printWidth`; `never` means never introduce a line break.
- Long string/raw content is not split (strings are atomic). Short `Vector3{0,0,0}` stays flat;
  long `List<object>{...}` breaks via `wrapCollections`/`callBreakStyle` (R9 updated, no longer "never").

---

## §10 Declarations, decorators, types

- `func Name(a int, b int) int {` - return type AFTER params (R2). `async` modifier: `async func Name(...) {`
  (no space between `async` and `func`, they are one unit).
- `static graph Name {` (verified: `BigNumber.fcg:35`, `UIUtil.fcg:25`, `DataUtil.fcg:25`).
- `tuple Name { Field int … }`, `component Name { … }`, `event Name { … }`, `enum Name { A = 0 … }`
  (enum explicit value verified: `CustomEnum.fcc:36` `SUCCESS = 0`).
- `define X = …`, `alias X = …`.
- Decorators cling to the declaration with one space; keep on one line: `[accept entity<Player>] func …`,
  `[platform_server] static graph …`. In `.fcc`, `[platform_client] [platform_server] event …` is
  valid and exposes the event to both sides. Platform decorators on handlers are not valid convention.
- `out var` params: `func F(v int, out var ok bool)` (verified `Camera.fcc:386`, `StorageService.fcg:77`).

---

## §11 Control flow

Verified statement forms (file:line evidence):

- `if a == b { … } else { … }` - **no parens** (R12 project convention; the compiler accepts the parenthesized form).
- `while cond { … }` - no parens.
- `for` has TWO forms:
  - index: `for i = 0, count, 1 { … }`
  - range: `for i, item in items { … }` (verified `Server_WalletManager.fcg` for-loop headers such as
    `for playerUID, _ in _PendingCoinRewardsByUid {`). The formatter MUST NOT split the header
    (bug G7) - `for playerUID, _ in … {` stays one line.
- `return expr` / `return` - `return` clings to expr with one space; `return Type{…}` composite
  literal clings (R22 exception does not apply; `return` is not a block).
- `static graph` body is a BLOCK (spaces per §5.6).
- `async func` body is a BLOCK.
- `wait <call>` - `wait` is a statement that wraps a call (verified `UIUtil.fcg:217`
  `wait WaitForMillisecond(...)`, `LiveOpsControlStore.fcg:56` `wait ReadFromAccumulation(...)`).
  Format: keep `wait` + the wrapped call as ONE logical unit; apply call-breaking to the wrapped call.
  DO NOT break right after `wait`.
- `start <call>` - fire-and-forget async call (verified `UIBoss2.fcg:233` `start ShowBossResultTooltip(`
  with multiline args, `AudioManager.fcg:15` `start PlaySFX2D(...)`). Same rule as `wait`.
- **NO `switch`/`case` statement exists in FC** (absent from grammar doc and corpus - the only
  `case` hits are prose comments). Do not format or emit `switch`.

---

## §12 Imports

- **Library form:** `import "X.fcc" as Alias` - alias is **REQUIRED** (grammar `importFile`,
  see §1b V3). A library import with no alias is a parser error; never emit `import "X.fcc"` alone.
- **Script form:** `import Name as Alias from "./X.fcg"` - alias is **OPTIONAL** (grammar
  `importPartFile`, see §1b V4). When the alias is empty the formatter renders
  `import Name from "path"` (drops the dangling `as`, bug G2). This empty-alias exception applies
  only to the script form; library aliases remain mandatory.
- **Never emit a dotted alias** (`import "x" as A.B`) - `qualifiedIdent` is a single token (§1b V1).
- Reserved libs keep full filename as alias: `StdLibrary`, `EditorGenLib` (not `StdLib`).
- Order (R14) is a convention, not a requirement that imports be at the top of the file. Internally,
  imports are classified into seven buckets: normal libraries, `StdLibrary`, `EditorGenLib`, script
  `from` imports, Contracts, `../` project imports, and `./` relative imports. These render as four
  visual groups. The formatter sorts only within each contiguous import run (comments owned by an
  import stay with it); it never merges separated runs or moves imports across declarations. The
  linter warns on wrong order.

---

## §13 Strings, numbers, color

- String literals are atomic; never split. Double-quoted interpreted strings and single-quoted rune
  literals are both preserved byte-for-byte (apart from changes outside the literal).
- **Backtick `` `…` `` is a `RAW_STRING_LIT` (id 119) per the compiled grammar** - it accepts both
  `RAW_STRING_LIT` and `INTERPRETED_STRING_LIT` at `string_()` (§1b V2). Treat it as an atomic
  string: never split, never reformat its interior. The project corpus happens not to use it, so all
  existing examples are `//` comments; but the tokenizer MUST handle it correctly so we never corrupt
  a valid raw string if one appears.
- Color hex `#RRGGBB` / `#RRGGBBAA` is a single `COLOR_HEX_LIT` token (§3). Keep intact.
- Numbers are atomic and spelling-preserving across decimal, binary, octal, hexadecimal,
  decimal/hexadecimal float, and imaginary literal forms. Unary minus clings (§5.2).

---

## §14 Alignment

`Map<K,V>{ "k1": v1, "k2": v2 }` uses map entries `key: value`. A tuple/struct literal uses
assignment-style entries such as `Field = value`; it is not a map merely because both use a brace
literal. For both forms, entry keys/fields and the `:`/`=` separator are column-aligned in flat and
multiline layouts. Alignment must not alter strings, raw strings, or nested expressions.

---

## §15 Output normalization

After printing, the formatter removes a leading BOM and applies the configured EOL, trailing-
whitespace, blank-line, and final-newline policies. Protected comment/string/raw-string content is
never changed. The project defaults are LF, trimming trailing whitespace, collapsing 3+ blank lines
to 1, and exactly one final newline; these defaults are configurable in generic mode and therefore
are not Tier 1 grammar rules.

Malformed input policy: the formatter may either return the source unchanged (no-op) or fail, but
the chosen behavior must be deterministic and documented separately for the library API and CLI.
It must never guess a repair for an unterminated string/comment or malformed color/number literal.

---

## §16 Configurability model

A single config object (default shown). Only Tier 3 rules read it. Changing any knob preserves
idempotency and (with Tier 1/2 unchanged) compilation.

| Knob | Type | Default | Meaning | Prettier alias |
|---|---|---|---|---|
| `printWidth` | int | 100 | Max line width before groups break | `printWidth` |
| `tabWidth` | int | 2 | Spaces (or 1 tab) per indent | `tabWidth` (was `indent`) |
| `useTabs` | bool | false | Use tabs instead of spaces | `useTabs` |
| `endOfLine` | enum | "lf" | Line ending | `endOfLine` (was `eol`/`lineEnding`) |
| `collapseBlankLines` | bool | true | Collapse 3+ blank lines to 1 | - |
| `trimTrailingWhitespace` | bool | true | Strip trailing whitespace | `trimTrailingWhitespace` |
| `insertFinalNewline` | bool | true | Ensure final newline | `insertFinalNewline` |
| `spaceAroundOperators` | bool | true | `a = b`, `a + b`; controls assignment and binary operators | - |
| `spaceInsideParens` | bool | false | `( a )` | - |
| `spaceInsideBrackets` | bool | false | `[ a ]` | - |
| `spaceInsideBraces` | bool | false | `{ a }` (composite) | - |
| `spaceAfterComma` | bool | true | `a, b` | - |
| `bracketSpacing` | enum | "none" | `Type{` vs `Type {` | `bracketSpacing` (was `compositeBraceSpacing`/`compositeLiteralBraceAttachment`) |
| `wrapCalls` | enum | "auto" | `auto` / `always` / `never` for call parens; `never` stays flat even past width | - (was `wrapLongCalls`) |
| `wrapCollections` | enum | "auto" | `auto` / `always` / `never` for `[]`/`{}`; `never` stays flat even past width | - (was `wrapLongCollections`) |
| `callBreakStyle` | enum | "breakAll" | `breakAll` (`f(\n  a,`) vs `hugFirst` (`f(a,`) | - |
| `trailingComma` | enum | "multiline" | Policy where grammar permits; mandatory/forbidden contexts in §6 override it | `trailingComma` (was `trailingCommas`) |

**Fixed (NOT configurable - Tier 1/2):** `braceStyle` is forced to **K&R** for all statement
blocks (`func`/`if`/`for`/`while`/`static graph`/`async func` bodies open on the same line as the
header, e.g. `func F() int {`). There is no Allman option - it would diverge from the project
convention and the formatter's block detection. `Type{` composite-literal attachment is the only
`{`-spacing that is configurable (R22) via `bracketSpacing`.

Asymmetric operator spacing is never a value; inputs with `a -b`/`a- b` are normalized to the
symmetric choice on write and stay stable. Every knob above is idempotent for any value. The
`trailingComma` knob cannot override the grammar-required commas or introduce commas where §6
forbids them.

---

## §17 Corner-case catalog (real code and formatter observations)

Each entry: rule + real example + file reference.

1. **`out var` param** - `func ScreenTouchRay(tp Vector2, out var startPosition Vector3, out var direction Vector3)` (`Camera.fcc:386`). Keep `out var` together.
2. **Enum value** - `SUCCESS = 0 // Generic successful operation.` (`CustomEnum.fcc:36`).
3. **`static graph`** - `static graph BigNumberLibrary {` (`BigNumber.fcg:35`).
4. **`async func`** - `async func AnimateWindowOpen(node entity<UIWidget>, hiddenOffset Vector3, durationMs int) {` (`UIUtil.fcg:183`).
5. **`wait <call>`** - `wait WaitForMillisecond(Math.Max(durationMs, 0) as int)` (`UIUtil.fcg:217`); also `wait ReadFromAccumulation(sheet, key, out var v, "", out var sc)` (`LiveOpsControlStore.fcg:56`).
6. **`start <call>` (multiline)** - `start ShowBossResultTooltip(\n  title,\n  description,\n)` (`UIBoss2.fcg:233`).
7. **`for` range (no split)** - `for playerUID, _ in _PendingCoinRewardsByUid {` (`Server_WalletManager.fcg`).
8. **Data-type literal one-line** - `LocString{"[b]{0}[/b] - {1}", {skillName, skillDesc}}` (`Server_UIPlantDetail.fcg`); `Vector3{0, -800, 0}` (`Server_UIUpgrades.fcg:193`). Spaced form `Vector3 {0, 0, 0}` also compiles (`Server_PlayerTeleport.fcg:194`).
9. **Struct literal multiline** - `plan = GameplayActionPlan{\n  SourceType = …,\n  …\n}` (`Server_UpgradeManager.fcg`) - each `Field = value` on its own line, aligned with the other
   fields and with a trailing comma.
10. **Nested composite** - `Map<object, object>{ "seed_item_id": List<object>{seedItemId}, "quantity": List<object>{quantity}, }` (`Telemetry.fcg`).
11. **Empty composite** - `var m Map<UUID, entity<Player>> = {}` - space kept before `{}`.
12. **Color hex intact** - `#B073E5`, `#7CCC66` stay single tokens.
13. **Decorator w/ arg** - `[accept entity<Player>] func OnInteract(player entity<Player>) {`.
14. **Cast** - `Math.Max(durationMs, 0) as int` - `as` spaced both sides (binary keyword).
15. **Import empty alias FIX** - source `import Res from "EditorGenLib.fcc"` stays as-is (no `as `).
16. **Contract event exposure** - `[platform_client] [platform_server] event Request_X { … }` in a
   `.fcc` contract is valid and exposes the event to both sides; graph platform cardinality does not
   apply to contract events.

---

## §18 Gotchas (G1–G12, from formatter development)

G1. Color hex split: `#7CCC66` → `# 7 CCC66`. Fix: `COLOR_HEX_LIT` token.
G2. `import Res from "…"` → `import Res as  from`. Fix: omit `as` when alias empty.
G3. Trailing comma dropped on `return GardenPlacement{…}` (multiline). Fix: `isBlockOpen` must not
    misclassify `return Type{` as a block (was jumping over enclosing `}`).
G4. Block brace wrongly attached: `== ItemCategory.Plant{`. Fix: `isBlockOpen` runs first; `}`/`>`
    before `{` cling, but a real block gets the space.
G5. `Track(...)` multiline last arg composite literal missing trailing comma / `}` `)` split.
    Fix: statement calls force trailing comma before `)`.
G6. `return LocString{…}` first element pushed to an invalid position. Fix: keep `return` attached to
    the composite opener; if the data literal breaks, its own multiline trailing comma is still
    required. For an outer call used by `return`, the call comma is forbidden and `)` stays with the
    final argument/composite `}`.
G7. `for playerUID, _ in … {` split after comma. Fix: block bodies are a single segment (not
    comma-split by `splitSegments`).
G8. `= {}` lost space. Fix: `=`/`:=` before `{` keeps a space.
G9. `Math.RandomFloat(-2, 3)` → `(- 2, 3)`. Fix: unary `-` clings; binary spaced.
G10. `func F() List<List<object>>{` lost space. Fix: `isBlockOpen` runs before the `>` cling rule.
G11. Positional data-type literals may break under `wrapCollections`; when broken, their trailing
    comma is required. This does not change the separate assignment/return-call rule in §6.
G12. `Vector3 {0,0,0}` space compiles → `Type{` spacing is STYLE (R22), not grammar.

---

## §19 v2 architecture / pipeline blueprint

v2 lives in a **fresh npm package** at `tools/fc-format-v2/` and is **written from scratch**
against the compiled ANTLR grammar (no code copied from v1). All token IDs, keyword tables, and
operator tables are regenerated from the `FCGLexer`/`FCGParser` constants (§1b V7), so nothing in v2
inherits v1 bugs (G1–G12) by accident.

```
collect/sort imports -> safe import runs  src/lint/analysis.ts + src/shared/import-bucket.ts
tokenize(source)     -> tokens[]         src/lex/tokenizer.ts   - lossless scanner; no synthetic EOS
itemize(tokens)      -> LexedDocument    src/lex/items.ts       - ordered comments/trivia, offsets, EOF trivia
classify(document)   -> delimiter tree   src/syntax/classifier.ts + src/syntax/query.ts
buildDoc(tree, cfg)  -> Doc              src/print/emit/        - delimiter layout and trailing-comma policy
printDoc(doc, cfg)   -> string           src/print/doc.ts       - greedy fit against printWidth
normalize(text,cfg)  -> string           src/print/normalize.ts - §15 policies
```

Module map (actual v2 layout; formatter and linter must converge on shared structural/import logic):

```
src/
  lex/           grammar, generated tokens, tokenizer, items
  syntax/        classifier, query, spacing
  print/         Doc printer, normalization, emitter, wrapping/state helpers
  format/        config, orchestrator, and import-facing APIs
  lint/          index, shared analysis, and rule modules
  shared/        import bucket classification
  cli/           fmt/check/lint CLI and compiler-oracle implementation
tests/            unit/golden, corpus idempotency, lexer/classifier, and oracle tests
```

Design principles:
- **Single classifier** (`src/syntax/classifier.ts`) is shared by formatter AND linter (so rules cannot drift; see `FC_LINTER_SPEC.md` §6).
- Import parsing, ordering, and rendering must use one shared implementation. The current duplicate
  paths (`src/format/imports.ts` versus `src/lint/analysis.ts`) are an implementation gap, not two
  independent contracts.
- Every layout decision reads `cfg`; Tier 1/2 ignore it; only Tier 3 reads knobs.
- `isBlockOpen` is the authoritative block-vs-composite discriminator (fixes G3/G4/G10).
- Required acceptance tests include golden files, real corpus idempotency, and an oracle test that
  formats the whole `Assets/Scripts`, compiles with `fccompile_external.exe`, and asserts exit 0 plus
  idempotency. The current repository does not yet have a passing compiler-backed test or working
  oracle CLI, so §20 remains unverified.

### §19.1 Current implementation gaps

The following do not weaken the contract above; they are known reasons the implementation is not yet
conformant:

- the import pre-pass can delete declarations between separated imports and can render a missing
  library alias as `undefined`;
- import parsing/rendering is duplicated between `src/format/imports.ts` and `src/lint/analysis.ts`;
- `wrapCollections = "never"` can still break a long collection;
- map/struct column alignment is not implemented, and empty blocks can gain an extra blank line; and
- the current trailing-comma implementation lets `trailingComma = "never"` suppress commas required
  by §6.

---

## §20 Idempotency contract (acceptance)

For every `.fcg`/`.fcc` in the project (and every golden test):
1. `format(x)` compiles (oracle exit 0); this is an acceptance requirement, not a currently proven
   result.
2. `format(format(x)) === format(x)`.
3. No Tier 1/2 rule is violated by the output.
4. Tier 3 output matches the configured knob and is stable under re-runs.
