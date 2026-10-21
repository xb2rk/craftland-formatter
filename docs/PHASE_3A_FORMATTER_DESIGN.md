# Phase 3A - Formatter Design Record

## Status and scope

**Status:** Implemented across Phases 3B–3D; this record remains the normative formatter design.

This record defines the formatter architecture to implement after approval. It consumes the
lossless lexer and the source-referential full-file AST from Phases 1–2, and produces canonical
FC source. `GRAMMAR.md`, especially §§8.1 and 12, is the layout contract.

The formatter does not edit `Assets/`, introduce FC APIs/contracts, or perform linting. The
compiler oracle runs only on a staged copy of the project.

## Design review

### Precedent

- `tools/fc-format/src/` is the older gofmt-style pipeline: tokenize, make items, emit a layout
  document, print, normalize. It is useful only as a layer-boundary precedent; its formatter
  implementation is not reused.
- `tools/fc-format-v2/` documents the failures this design explicitly avoids: text/pre-pass
  import handling could delete declarations, and context-blind token spacing confused generic
  angle brackets with relational operators.
- The current package already follows the needed ownership boundary: `src/lex/` preserves source
  bytes, `src/parser/` decides grammar, and `src/syntax/` stores source-referential AST nodes.

### Alternatives

| Option | Trade-off | Decision |
|---|---|---|
| Token-stream formatter | Small initial implementation, but must recreate precedence, type/expression context, and composite classification; unsafe for FC ambiguities. | Rejected. |
| AST → strings directly | Easy for flat cases, but wrapping and indentation would spread across every renderer and become non-idempotent. | Rejected. |
| AST → layout document → width-aware printer | One structural source for spacing and wrapping; supports deterministic flat-or-broken groups and testable contracts. | Chosen. |

### Ownership

| Layer | Owns | Must not own |
|---|---|---|
| `lex/` | Original token bytes, trivia, source ranges | Syntax or canonical whitespace decisions |
| `syntax/`, `parser/` | Parse-tree structure and diagnostics | Rendered text or import ordering |
| `doc/` | Immutable layout-document primitives and fit decisions | FC grammar classification |
| `format/` | AST-to-document rendering and output hygiene | Parsing or global import movement |
| `imports/` | Collection, grouping, sorting, and rendering of one contiguous AST import run | Scanning/deleting source text or crossing declarations |
| Future `lint/` | Read-only AST analysis | Its own lexer/parser or formatter policy |

Only the caller provides source text. `format/` returns a string; it has no filesystem writes.

### Performance model

Formatting is per invocation and linear in source length plus the cost of sorting each import
run: `O(n + Σ r log r)`, where `r` is a contiguous run length. AST traversal and document
printing are linear under a bounded-width fit scan. There is no per-frame, editor-keystroke
global-corpus, compiler, or filesystem work. Corpus idempotency and compiler-oracle checks are
explicit test/CI jobs against staged copies.

### Contracts-first

The existing parse APIs (`parseGraphFile`, `parseHeaderFile`) and AST in `src/syntax/nodes.ts`
are the formatter input contract. Phase 3B may add package-internal document and formatting
modules, but must not add a package-root public API or an FC contract. A future public CLI/API is
a separate approval decision.

## Pipeline and module plan

```
source text
  → lex(source)                         lossless tokens + protected trivia
  → parseGraphFile / parseHeaderFile    source-referential AST + diagnostics
  → formatFile(ast, tokens)             AST-specific layout documents
  → print(document, printWidth)         canonical text
  → output hygiene                      LF, ordinary trivia cleanup, one final newline
```

Planned modules:

- `src/doc/document.ts`: closed document algebra: text, concat, line, hardline, indent, group,
  and alignment padding. Documents are data, not rendered strings.
- `src/doc/printer.ts`: deterministic width-aware renderer. A group is printed flat only when it
  fits; otherwise all its soft lines resolve according to its declared broken form.
- `src/format/file.ts`: chooses `.fcc` or `.fcg` parser, refuses to format a parse with errors,
  assembles file-level document, and performs output hygiene.
- `src/format/render-*.ts`: render files/declarations, types/expressions, statements/blocks, and
  composites. These modules consume typed nodes; no token-neighbour whitespace heuristics.
- `src/format/comments.ts`: attaches leading/trailing comments and protected literal bytes from
  token ranges. It preserves comment content exactly.
- `src/imports/import-runs.ts`: recognizes already-parsed contiguous import runs, groups/sorts
  only their records, and calls one renderer used later by lint autofix tooling.
- `tests/format/`: golden fixtures, focused contract tests, idempotency tests, and corpus gates.

## Formatting decisions

### Spacing is syntax-directed

The expression parser has already bound §8.1 precedence. The renderer therefore never decides
whether `<` is a generic delimiter or a relational operator from adjacent text.

| AST/context | Rendering |
|---|---|
| `GenericTypeNode`, generic access | tight: `List<int>`, `thisEntity<Player>` |
| Binary expression or assignment | symmetric spaces: `a < b`, `a >= b`, `a = b` |
| Unary expression | clings: `!ready`, `-1`, `++count` |
| Postfix call/index/member | clings: `F()`, `a[i]`, `a.b` |
| Cast expression | spaced: `value as int` |
| Type combination | symmetric spaces: `int | float`, `A & B` |
| Declaration parameter/field | one separator between name and type; `=` spaced |
| Comma-separated flat sequence | `, ` |
| Composite opening brace | type/value clings: `Type{`, `LocString{` |
| Statement/declaration opening brace | K&R: `if ready {`, `func F() int {` |

Parentheses that are grammar-required are rendered; no new wrapping parentheses are inserted for
`if`, `for`, or `while` headers. The tree preserves source parentheses in expression nodes, so
the first implementation retains them rather than attempting semantic simplification.

### Document and wrapping rules

- Width is fixed at 100 with two-space indentation. A group is either fully flat or takes its
  documented broken layout; source line breaks do not control the result.
- Group decisions are independent. A parent call that breaks does not force a nested call or
  composite to break; under `auto`, the child is measured from its own opener and breaks only if
  its own content exceeds the width. `always` remains local to the group where it is configured.
- Binary condition wrapping is after-operator only (`a ||\n  b`); it is never before-operator.
- `if`/`for`/`while` headers, including the commas of a `for` header, are logical units and never
  split at a comma. Their condition may wrap only after a binary operator.
- Blocks use K&R braces and statements use one hard line each. Empty blocks render as `{}` with
  no introduced blank line.
- Multiline block/JSDoc comments preserve their internal bytes and stay directly attached to the
  following declaration unless the source contains an actual blank-line separator.
- `LocString{...}` is a dedicated renderer and stays flat. It never inherits generic collection
  breaking policy.
- Positional, map, and struct composites choose flat if fitting; otherwise break after commas,
  add a trailing comma, and indent entries. Struct/map `=`/`:` alignment is calculated from the
  rendered flat left-hand columns of siblings, not from raw source columns.

### Call families are selected by parent context

| Call use | Flat | Broken |
|---|---|---|
| Expression statement, `wait`, `start` | `F(a, b)` | one argument/line, trailing comma, `)` on its own line |
| Assignment RHS, `var` initializer, `return`, argument/nested value | `F(a, b)` | one argument/line, no trailing comma, `)` hugs final argument |

This choice is made by the statement/declaration renderer that owns the call's value context,
not by `CallExpressionNode` alone. That prevents a child call from guessing based on source
whitespace.

### Imports

Imports remain ordinary ordered file members until `imports/` receives a lexer-verified,
top-level import run. It may sort only adjacent import records. Attached leading comments/trivia
move with their record. It never crosses a declaration, merges two runs, or drops any node.

Library imports require `as Alias`; malformed missing aliases are reported by parsing and are not
rendered as `undefined`. Named imports retain optional aliases. Import groups follow the three
repository groups from `CODING_CONVENTION.md` §2: Standard Library, Contracts, and project
imports by relative depth. `StdLibrary.fcc` and `EditorGenLib.fcc` remain in the Standard Library
group and sort at its end, in that order. One blank line separates non-empty groups; ordinary
Standard Library and Contracts records sort by canonical path/name, while remaining project
records sort by descending leading `..` depth and then canonical path/name.

### Protected source ranges and error behavior

String, raw-string, rune, color literal, line-comment, block-comment, and JSDoc token text is
emitted byte-for-byte. The formatter may normalize surrounding whitespace but not bytes inside a
protected range. A parse or lexical diagnostic causes `formatFile` to return diagnostics and no
formatted output; it must never produce a best-effort program that could change meaning.

## Implementation phases after approval

1. **3B - document/printer kernel:** document algebra, fit algorithm, output hygiene, and unit
   tests independent of FC syntax.
2. **3C - structural renderer:** types, expressions, composites, declarations, blocks, and all
   call-family contexts; introduce golden fixtures before each renderer family.
3. **3D - comments and imports:** trivia attachment, protected-byte tests, contiguous-run import
   subsystem, and import-order fixtures.
4. **4 - end-to-end hardening:** full-corpus idempotency and staged compiler-oracle gating.

Each phase must pass local typecheck, unit/golden tests, and build. From 3C onward it must also
pass corpus idempotency; once formatting covers corpus forms, the staged compiler oracle is a
required gate.

## Test matrix and acceptance gates

Focused fixtures must pin:

- generic/type spacing versus relational/equality/shift expressions;
- unary, binary, cast, member, index, and generic-access spacing;
- flat and broken calls for both parent-context families;
- flat/broken positional, map, struct, and `LocString` composites, including empty `{}`;
- map/struct alignment and nested composites;
- header/flow layout, `else if`, `for` forms, and after-operator condition wrapping;
- contiguous separated import runs, aliases, imports with attached comments, and three-group
  ordering with the reserved Standard Library tail;
- raw/interpreted strings, runes, color literals, line/block/JSDoc comments, BOM, LF, trailing
  whitespace, and final newline;
- the v2 regressions listed in `GRAMMAR.md` §14.2.

Every fixture has these assertions: expected canonical output, `format(format(input)) ===
format(input)`, and protected-literal/comment byte equality. The corpus gate asserts successful
parse, deterministic output regardless of input order, and byte idempotency. The final oracle
gate formats a temporary staged project and requires `fccompile_external.exe -i Assets` to exit
successfully.

## Approval boundary

The design has been implemented in `src/doc/`, `src/format/`, and `src/imports/`. Phase 4
hardening evidence is recorded in `docs/PHASE_4_HARDENING.md`.
