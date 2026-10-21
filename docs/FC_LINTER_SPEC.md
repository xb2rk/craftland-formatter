# FC Linter Specification (LINTER_SPEC)

Canonical lint rules for FC (Craftland Studio `.fcg` / `.fcc`). This document is the source of truth
for `tools/fc-format-v2/src/lint/`. It is derived from the grammar artifacts (see §8 references),
the compiler oracle, and `docs/CODING_CONVENTION.md`.

The compiler oracle is the authority for grammar severity, but the current repository does not yet
have a passing compiler-backed linter test. Rules described as compiler-verified below are acceptance
requirements until that evidence exists.

> The linter reports compiler/grammar violations as **errors** and Tier 2 (CONVENTION)
> violations as **warnings**. It does **NOT** flag Tier 3 (STYLE) - style is the user's choice
> (see `FC_FORMATTER_SPEC.md` §2/§16). The formatter silently fixes Tier 1/2 where it safely can.

---

## §1 Severity policy

| Severity | Meaning | Effect |
|---|---|---|
| `error` | Tier 1 GRAMMAR violation; file will not compile. | Block; formatter fixes silently. |
| `warning` | Tier 2 CONVENTION violation (style/naming/order). | Advise; formatter may auto-fix some. |
| `info` | Advisory / candidate rule not yet enforced. | Inform only. |

No diagnostic is ever emitted for Tier 3 (configurable style).

---

## §2 Diagnostic contract

Every diagnostic is a `Diagnostic`:

```
{
  ruleId: string,        // stable id, e.g. "naming-func"
  message: string,       // human-readable, DO/DON'T phrased
  line: int,             // 1-based
  column: int,           // 1-based
  length: int,           // token length for squiggle
  severity: "error" | "warning" | "info",
  fix?: Edit              // optional safe source-range replacement
}
```

`Edit = { start: int, end: int, replacement: string }` in source character offsets.

---

## §3 Naming helpers (shared)

- `isPascalCase(s)`: `^[A-Z][A-Za-z0-9]*$` (allow digits, no `_`).
- `isCamelCase(s)`: `^[a-z][A-Za-z0-9]*$`.
- `isPrivateField(s)`: starts with `_` then PascalCase → `_PascalCase`.
- `isConstantName(s)`: `^_[A-Z][A-Z0-9_]*$` (`_UPPER_SNAKE_CASE`).
- `EVENT_PREFIX = ["Request_", "Notify_", "Fact_"]`; lifecycle event names matching `On[A-Z]...`
  are an explicit exception.
- `LAYER_PREFIX(s)`: strips `Server_`/`Client_`/`Global_`/`Systems_`/`UI_`/`Components_`/`Utils_`/
  `Framework_`/`Data_`/`Storage_`/`Player_`/`Fx_` from a graph/file name to get the domain.
- `RESERVED_LIBS = { "StdLibrary.fcc", "EditorGenLib.fcc" }` (alias must equal the filename stem).
- `PUBLIC_DECL_KINDS`: `func`, `tuple`, `component`, `event`, `enum`, `define`, `alias`, and graph,
  in both `.fcg` and `.fcc` where the declaration kind is legal.
- `COND_KEYWORDS = { "if", "for", "while" }` (parentheses are a project-style warning).

---

## §4 Rule catalog (normative)

Each rule: `ruleId`, source, tier, severity, fix, DO / DON'T.

### §4.1 `import-reserved-abbrev` (Tier 2, warning, fix)
Reserved lib must keep its full filename as alias.
- DO: `import "StdLibrary.fcc" as StdLibrary`
- DON'T: `import "StdLibrary.fcc" as StdLib`
- Fix: rename alias to `StdLibrary` / `EditorGenLib`.

### §4.2 `import-library-alias` (Tier 1, error, fix)
Library imports require an alias because the grammar requires `import "X.fcc" as Alias`.
- DO: `import "List.fcc" as List`
- DON'T: `import "List.fcc"`
- Fix: report the malformed import; the formatter must not silently preserve it or render an
  `undefined` alias.

### §4.3 `import-alias-mismatch` (Tier 2, warning)
Script import alias should match convention; warns only.

### §4.4 `import-order` (Tier 2, warning)
Import order is styling/convention, not a requirement that imports occur at the top of the file.
The shared classifier uses seven internal buckets: normal libraries, `StdLibrary`, `EditorGenLib`,
script `from` imports, Contracts, `../` project imports, and `./` relative imports. They render as
four visual groups. The linter checks order only inside a contiguous import run. It does not attach a
reorder fix because moving a declaration or comment can change source ownership; the formatter must
never merge separated runs or rewrite across declarations.

### §4.5 `naming-func` (Tier 2, warning)
Function names MUST be PascalCase, verb-first.
- DO: `func BuildUpgradeSnapshot(...)`
- DON'T: `func build_upgrade_snapshot`, `func buildUpgradeSnapshot`

### §4.6 `naming-field` (Tier 2, warning)
Private fields `_PascalCase`; constants `_UPPER_SNAKE_CASE`.
- DO: `var _Owner entity<Player>`; `var _TELEPORT_CAST_MS int`
- DON'T: `var owner`, `var _teleportCastMs`

### §4.7 `naming-local` (Tier 2, warning)
Locals/params camelCase.
- DO: `playerUID`, `durationMs`
- DON'T: `PlayerUID`, `duration_ms`

### §4.8 `platform-on-graph` (Tier 2, warning)
In `.fcg`, a platform decorator (`[platform_server]`/`[platform_client]`) belongs on the `graph` or
`static graph`, not on a handler. In `.fcc`, the same decorators may belong directly to an `event`;
adjacent client and server decorators are valid and expose that event to both sides.
- DO: `[platform_server] static graph X {` … `[readonly] func Handler(...)`
- DO: `[platform_client] [platform_server] event Request_X { … }` in a `.fcc`
- DON'T: `static graph X { [platform_server] func Handler(...)`

### §4.9 `graph-missing-platform` (Tier 2, warning)
A `.fcg` graph/static graph without exactly one platform decorator. Zero or multiple platform
decorators are warnings. This cardinality rule does not apply to `.fcc` contract events.

### §4.10 `enum-member-namespace` (Tier 2, warning)
Enum members MUST be `<Domain>_<Thing>`.
- DO: `enum UpgradeResult { UPGRADE_Success = 0, UPGRADE_NotFound = 1 }`
- DON'T: `Success`, `NotFound`

### §4.11 `event-name-prefix` (Tier 2, warning)
Events MUST start with `Request_`/`Notify_`/`Fact_`, except lifecycle events matching `On[A-Z]...`.
- DO: `event Request_BuyItem { … }`
- DON'T: `event BuyItem`

### §4.12 `jsdoc-missing` (Tier 2, warning)
Every public declaration (`func`, `tuple`, `component`, `event`, `enum`, `define`, `alias`, and
graph) MUST have `/** */` JSDoc. This applies in both `.fcg` and `.fcc`, including the graph itself;
the graph itself is included where the file format has a graph. It is not limited to declarations
nested inside a graph.

### §4.13 `condition-no-parens` (Tier 2, warning, fix)
The project convention omits wrapping parentheses around `if`/`for`/`while` conditions. The
Craftland compiler accepts the parenthesized forms, so this is not a grammar error.
- DO: `if a == b {`, `for i, item in items {`
- DON'T: `if (a == b) {`
- Fix: strip the wrapping parens.

### §4.14 `line-too-long` (Tier 2, warning)
Line exceeds `printWidth` (default 100). Advisory only (formatter handles breaking).

### §4.15 `import-alias-dotted` (Tier 1, error)
Import aliases are one identifier; a dotted spelling cannot be parsed as `qualifiedIdent`.

### §4.16 `package-cache-import` (Tier 1, error)
Import paths must not point into `.craftland` or `node_modules` package caches.

### §4.17 `graph-field-no-var` (Tier 1, error)
Graph fields are declared in the graph header; a graph-body `var` declaration is invalid.

### §4.18 `no-constructor-call` (Tier 1, error)
Vector values use brace literals (`Vector3{...}`), not constructor calls (`Vector3(...)`).

### §4.19 `no-wait-dot` (Tier 1, error)
Use the prefix form `wait X(...)`; member-call `.wait()` is not valid FC syntax.

### §4.20 `ts-param-syntax` (Tier 1, error)
FC parameters use `name Type`, not TypeScript `name: Type` syntax.

### §4.21 `return-type-position` (Tier 1, error)
Function return types follow the parameter list: `func F() int`.

### §4.22 `trailing-comma` (Tier 1, error)
Trailing comma behavior is contextual:
- multiline data/struct/map literals and multiline bare/statement calls, including `wait`/`start`,
  MUST have a trailing comma;
- flat literals/calls MUST NOT have one;
- calls assigned to a variable or used by `return` MUST NOT have one, even when multiline;
- for those assignment/return calls, the closing `)` stays on the final argument or final composite
  `}` line.

The `trailingComma` style knob cannot override these grammar requirements. The current implementation
reports this rule as a warning and lets `trailingComma: "never"` suppress required commas; that is a
known implementation/spec gap.

### §4.23 `graph-file-side` (Tier 2, warning; implementation gap)
Where a graph filename carries a `Server_`/`Client_` side prefix, it must agree with the graph's
platform decorator. Contract files are excluded.

### §4.24 `cross-side-import` (Tier 2, warning; implementation gap)
Server and client scripts MUST NOT cross-import one another. Contracts are shared and are exempt.

### §4.25 `section-banner` (Tier 2, warning; implementation gap)
Managed section banners MUST use exactly 26 `=` characters as required by the project convention.

---

## §5 Candidate rules (not yet enforced - Tier 2, info)

Derived from `docs/CODING_CONVENTION.md` and the grammar; promote when agreed:

- `tuple-naming` - tuple type PascalCase (already covered by general type naming).
- `const-naming` - `_UPPER_SNAKE_CASE` for compile-time constants (covered by §4.5).
- `dead-comment-code` - comment lines that look like commented-out code (`// x = y` with a statement
  shape) → info, suggests deletion.

---

## §6 Alignment with v2

- The v2 formatter's `src/syntax/classifier.ts` (see `FC_FORMATTER_SPEC.md` §19) is the SINGLE source
  of structural truth. The linter MUST reuse it rather than re-deriving block/composite/call
  classification, so a construct the formatter treats as a block is the same one the linter checks.
- Import parsing, ordering, and rendering MUST use one shared implementation. The current formatter
  path (`src/format/imports.ts`) and linter/formatter analysis path (`src/lint/analysis.ts`) are
  duplicated and can drift; this is not conformant to the intended contract. Both must follow the
  seven-bucket/four-visual-group policy in R14.
- Platform ownership is file-kind dependent: `.fcg` requires exactly one graph platform decorator;
  `.fcc` permits platform decorators on events, including a client/server pair for dual exposure.
  Handler-level decorators remain warnings.
- Tier assignment is shared: both specs tag every rule with the same tier (§2 of the formatter spec).
- Rule detection is token/structure based and may be heuristic. A Tier 1 rule must not be described as
  compiler-proven until the compiler cross-check in §7 has passed.

### §6.1 Current implementation gaps

The normative catalog above is not yet fully implemented. Known gaps include:

- the formatter's unsafe non-contiguous import rewrite and missing-library-alias `undefined` output;
- `trailing-comma` severity/context not matching §4.22;
- missing filename-side, cross-side-import, and 26-character section-banner checks;
- `jsdoc-missing` being limited to declarations inside graphs; and
- style diagnostics (`bracket-spacing`, `space-inside-*`) being emitted even though Tier 3 diagnostics
  are outside the canonical linter contract.

---

## §7 Test strategy

- **Unit:** for each rule, a passing sample and a violating sample (golden `.fcg`/`.fcc` snippets),
  including contract-event platform decorators and assignment/return versus bare-call comma cases.
- **Project oracle:** run the linter over all `Assets/Scripts`; zero `error`-severity diagnostics on
  the committed baseline. Warnings may exist as convention debt, tracked separately.
- **Compiler cross-check:** every Tier 1 rule the linter flags MUST correspond to a construct the
  compiler rejects, verified with a minimal compiler-valid fixture and the real
  `fccompile_external.exe`. This requirement is currently unfulfilled: the existing 117 passing
  tests do not invoke the compiler oracle, and some fixtures are pseudo/non-compiler-valid.

---

## §8 References (authoritative on-disk artifacts)

Identical set to `FC_FORMATTER_SPEC.md` §1:

- `%VSCEXT%/dist/server_syntax.js` - installed ANTLR-generated lexer/parser bundle used by the
  v2 token-table generator. `server_semantic.js` is retained as secondary semantic-LS evidence;
  it is not the parser path used by v2.
  The `.g4` source lives in the extension's dev repo and is **not shipped** in the installed extension;
  do not cite a local `.g4` path.
- `%VSCEXT%/syntaxes/ffugclanguage.tmLanguage.json` - TextMate grammar (scope `source.ffugclanguage`).
- `%VSCEXT%/language-configuration.json` - comment/bracket/indent config.
- `%VSCEXT%/library/release/*.fcc` - built-in libs (real FC code + types).
- `%VSCEXT%/github/copilot-instructions.md` - grammar source location + antlr4 note.
- `.craftland/agents/references/fc-syntax.md` - derived grammar doc (local).
- `docs/CODING_CONVENTION.md` - project conventions (naming, imports, structure).
- `C:\Users\N0BODY\AppData\Local\Programs\Craftland Studio\resources\LocalData\Utilities\UGCLanguage\release\fccompile_external.exe`
  - compiler oracle (`-i Assets`, with the staged editor-gen directory and symbol file).

`%VSCEXT%` = installed extension dir. On this machine it resolves to:
`C:\Users\N0BODY\.vscode\extensions\craftlandstudio.ffugclanguage-1.10.1`.

> **Verified grammar audit:** the compiled grammar corrections (import alias one-token vs optional,
> backtick = `RAW_STRING_LIT`, no `switch`/`case` statement) are recorded in
> `FC_FORMATTER_SPEC.md` §1b. The linter shares the same grammar source and the same
> `src/syntax/classifier.ts` structural module (see §6), so any rule that reasons about those
> constructs must read §1b rather than re-derive them from the minified bundle.
