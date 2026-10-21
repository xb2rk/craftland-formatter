# FC Formatter/ Linter v2 - Rebuild Roadmap

Living document for the `tools/fc-format-v2/` rewrite. Captures decisions, evidence, and the
phase plan so a fresh session (or a compacted context) can resume without re-deriving anything.

> Authoritative grammar source: the **compiled ANTLR** files inside the installed VS Code
> extension (not a `.g4` that ships separately). See `FC_FORMATTER_SPEC.md` §1b.

---

## 0. Source of truth (verified)

| Role | On-disk artifact | Absolute path (this machine) |
|---|---|---|
| Lexer (token IDs) | `dist/server_syntax.js` - `FCGLexer.<NAME> = n` | `C:\Users\N0BODY\.vscode\extensions\craftlandstudio.ffugclanguage-1.10.1\dist\server_syntax.js` |
| Parser (rules) | `dist/server_syntax.js` - compiled `FCGParser`, `FCGParser.ruleNames`, literal/symbolic names | `…\dist\server_syntax.js` |
| Comments/brackets/indents | `language-configuration.json` | `…\language-configuration.json` |
| Token scopes (helpful, not required) | `syntaxes/ffugclanguage.tmLanguage.json` | `…\syntaxes\ffugclanguage.tmLanguage.json` |
| Real corpus (built-ins) | `library/release/*.fcc` | `…\library\release\` |
| Compiler oracle | Craftland `fccompile_external.exe -i Assets` | `C:\Users\N0BODY\AppData\Local\Programs\Craftland Studio\resources\LocalData\Utilities\UGCLanguage\release\fccompile_external.exe` |
| Project conventions | `docs/CODING_CONVENTION.md` | repo root `docs/` |

### Verified grammar findings (reconciled with the user)

| # | Topic | Decision | Evidence |
|---|---|---|---|
| V1 | Import alias never dotted | `qualifiedIdent` is ONE identifier-like token; `EditorGenLib.Res`-style aliases are ILLEGAL. Dotted names in code are either `domainType` (types) or postfix `.` member access (expressions). | Compiled `qualifiedIdent`, `general_identifier_token`, `domainType`, and `DOT` rules in the installed 1.10.1 bundle |
| V2 | Backtick = raw-string literal | `` `…` `` is `RAW_STRING_LIT` (119) and `string_()` accepts it. Treat as atomic string. | `FCGLexer.RAW_STRING_LIT = 119`; compiled `string_` rule |
| V3 | Library import alias REQUIRED | `import "X.fcc" as Alias` - `AS qualifiedIdent` is mandatory. | Compiled `importFile` rule |
| V4 | Script import alias OPTIONAL | `import Name [as Alias] from "path"`. | Compiled `importPartFile` rule |
| V5 | `wait`/`start` are prefix expressions | Both appear in `expression(0)` and `funcCallStatement` (`_func_call_type` ∈ `{START|WAIT}`). | Compiled `expression` and `funcCallStatement` rules |
| V6 | No `switch`/`case` statement | `SWITCH`/`CASE` tokens exist in lexer; parser has no statement rule. | `FCGParser.ruleNames` (absent) |
| V7 | Token IDs authoritative | v1 `TokenKind` enum equals `FCGLexer.*` IDs 1..129 - reuse by regeneration, NOT by copying v1 source. | `FCGLexer.<NAME> = n` table |

---

## 1. Goals
- Deterministic, idempotent, compile-preserving formatter (invariants in `FC_FORMATTER_SPEC.md` §0).
- Config is Tier 3 only (§16), everything else fixed.
- Fresh pkg `tools/fc-format-v2/`, written from scratch, TS + tsx runtime for dev, built `dist/` for ship.
- Same `classifier.ts` module feeds the linter (no drift - `FC_LINTER_SPEC.md` §6).

## 2. Pipeline
tokenize → itemize → classify → (spacing rules, config applied) → doc build → printDoc → normalize

## 3. Layout (fresh module-per-concern)
(`src/` files as listed in `FC_FORMATTER_SPEC.md` §19 «Module map»)

## 4. Phases
- **P0 (done)** - reconcile spec with compiled grammar → §1b. Output: this doc + reconciled formatter spec.
- **P1 (done)** - scaffold package, generated FCGLexer ids, lossless tokenizer, ordered trivia/items, and corpus reconstruction tests.
- **P2 (done)** - source-ordered delimiter tree, context queries, and pure Doc algebra/printer.
- **P3 (done)** - spacing policy, delimiter emitter, comments, wrapping, and import collector/renderer.
- **P4 (done)** - pure orchestrator, normalization, and `fmt`/`check` CLI.
- **P5 (done)** - inline golden/regression tests cover declaration/block/call/composite/comment/generic layouts and the implemented Tier-3 knobs; corpus fixtures cover the remaining real-world forms.
- **P6 (done)** - idempotency test (`format ∘ format = format`) over all 161 project `.fcc`/`.fcg` files.
- **P7 (done)** - disposable oracle stages the whole project, formats all source, runs `fccompile_external.exe`, and reports exit status plus changed files; the full 161-file run exits 0.
- **P8 (done)** - linter in `tools/fc-format-v2/src/lint.ts` reuses `classifier.ts`, with range diagnostics, CLI output, unit tests, and a zero-error baseline audit.

## 5. Out of scope (for formatter v2)
- No `switch`/`case` emission (V6).
- No source-order reordering except the import block (§12/R14).
- No Tier 3 lint diagnostics (style is config, not convention).

## 6. Resolved follow-ups
- Function/event parameter lists are grammar-constrained and always stay flat; there is no `wrapLongSignatures` option.
- Call/collection wrapping is intentionally limited to `never`/`auto`/`always`; a `hug-first` mode can be added only with compiler-backed fixtures and a concrete style requirement.
