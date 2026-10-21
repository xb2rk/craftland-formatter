# KICKSTART - Fresh FC Formatter

> **For whoever picks up the next session.** `tools/fc-format-v3/` is an empty folder
> with one artifact so far: `docs/GRAMMAR.md` (the previous session's complete FC grammar
> + layout contract). Your job is to **plan** the formatter that implements it, then
> wait for approval before writing production code. This file is intentionally minimal;
> `GRAMMAR.md` is your real starting weight.

---

## 1. Goal

Build a fresh, robust formatter for the Craftland FC language (`.fcg` / `.fcc`):
deterministic, byte-idempotent, **parseable by the compiler oracle** (`fccompile_external.exe -i Assets`).
It is a clean implementation of `GRAMMAR.md` - **not** a patch on the v1/v2 tools.
Treat those older tools only as a *history of what not to repeat* (see §3).

## 2. Read first (in order)

1. **`tools/fc-format-v3/docs/GRAMMAR.md`** - the single source of truth for the grammar,
   operator precedence (§8.1), lexer facts, and the layout contract (§12). Do *not*
   re-derive precedence or spacing rules from the compiled ANTLR bundle; trust this doc
   and only re-verify against the bundle if the extension version changes.
2. **`docs/FC_FORMATTER_SPEC.md` + `docs/FC_LINTER_SPEC.md` + `docs/V2_ROADMAP.md`**
   (inside `tools/fc-format-v2/`) - specifically the **"Current implementation gaps"**
   (V2 roadmap §6 / formatter spec §19.1; linter spec §6.1). These are the concrete
   regressions you must not reintroduce.
3. **`tools/fc-format/src/`** (v1) - the older "gofmt-style" formatter to learn the
   `tokenize → items → emit → doc → print → normalize` flow; do not copy its code.
4. **`docs/CODING_CONVENTION.md` + `docs/ARCHITECTURE.md`** (repo root) - naming, import
   order, platform/isolation rules the output must respect.
5. **`Assets/Scripts/`** (real corpus) - used for corpus idempotency + oracle validation
   (see §5).

Reference paths on this machine:
- Grammar/lexer/parser bundle: `C:\Users\N0BODY\.vscode\extensions\craftlandstudio.ffugclanguage-1.10.1\dist\server_syntax.js`
- Compiler oracle: `C:\Users\N0BODY\AppData\Local\Programs\Craftland Studio\resources\LocalData\Utilities\UGCLanguage\release\fccompile_external.exe`
- Working folder for the new tool: `tools/fc-format-v3\`, repo root `C:\Users\N0BODY\Documents\Craftland Studio\Projects\PlantsVsZombiesFCC`

## 3. What MUST NOT be repeated (the v2 mistakes to avoid)

- **No precedence/context-blind spacing.** Do not reproduce `List<int>` → `List< int >`
  or `a < b || a >= c` → `a<b||a>=c`. Spacing is precedence-aware: binary/assignment
  operators are symmetric-spaced; unary `+ - ! ~` and `++ --` cling; generic `<>`/`>`/`<`
  in **type** position is tight (no spaces); `.` member access clings; `as` is spaced.
  See `GRAMMAR.md` §8.1 + §11.5–11.8 + §12.2.
- **No import destruction or `undefined` aliases.** The v2 import pre-pass deleted
  declarations between separated import runs and could render a missing library alias as
  `undefined`. Imports sort **only within one contiguous run**; library imports always
  keep `as Alias`; script imports drop `as` only when the alias is empty. `GRAMMAR.md` §12.8.
- **`wrapCollections = "never"` must keep things flat.** v2 still broke long collections
  under `never`. Honor the policy. `GRAMMAR.md` §12.6.
- **Honor grammar-required commas & `)` placement.** `trailingComma` is a "when" policy,
  never a suppressor of grammar-required commas; bare/statement calls keep `)` on its own
  line + trailing comma, assignment/return calls hug the last arg + no trailing comma.
    `GRAMMAR.md` §12.5–§12.6.

## 4. Up-front deliverable (what "planning" means here)

Produce a plan only - no production code yet. The plan must contain:

1. **Module breakdown** - the file/layer layout (e.g. `lex/`, `syntax/`, `print/`,
   `format/`, tests) and how each module maps to the pipeline in `GRAMMAR.md`.
2. **Spacing model** - the exact decision function: given a pair of adjacent operators /
   tokens + parse context (type position vs expression, unary vs binary, generic vs
   comparison), what whitespace is emitted. Reference the precedence table from §8.1.
3. **Import sub-system design** - one shared implementation for collect/sort/render used by
   both formatter and (later) linter; how `qualifiedIdent`-as-one-token and the library/script
   alias rules are enforced. `GRAMMAR.md` §8.8 / §11.4 / §12.8.
4. **Wrapping + comma + `)`-placement rules** - the two call families and the composite
   break policy, mapped to `GRAMMAR.md` §12.5–§12.6.
5. **Phase plan** - a small number of concrete milestones, each gated by:
   - `npm test` (golden + unit) green, and
   - corpus idempotency: `format(format(x)) === format(x)` over `Assets/Scripts/**/*.{fcg,fcc}`,
   - oracle: formatted corpus still compiles (`fccompile_external.exe -i Assets` exits 0).
6. **Test strategy** - which v2 fixtures/rules you reuse as regression pins (concordance
   appendix, `GRAMMAR.md` §14) vs. which need new pins for the spacing-correctness cases.

## 5. Acceptance criteria (must hold once implemented)

- **Idempotent:** `format(format(x)) === format(x)` for every golden fixture and every
  corpus file.
- **Compile-preserving:** formatted `Assets/Scripts/` passes the oracle with exit 0.
- **Deterministic:** identical input → identical output, independent of file order.
- **Lossless on literals:** strings, raw strings (backtick), color hex `#RRGGBB`, comments
  are never altered in content/spacing.
- **One canonical style:** fixed Tier-1/2 layout (K&R braces, no wrapping parens on
  `if`/`for`/`while`, `Type{` cling by default), Tier-3 knobs only where `GRAMMAR.md` §12
  marks them configurable.

## 6. Constraints

- TypeScript, ESM, `tsx` for dev, `tsc` build. Mirror v2's `package.json`/`tsconfig` shape.
- **Do not claim this is "v3" or "ported" in code comments/docs.** Frame it as a fresh
  `fc-format` program; the folder name is incidental.
- Lint is **out of scope for this phase**; formatter is the deliverable. (Linter comes later,
  sharing the formatter's structural model.)

---

**Your move:** Read `docs/GRAMMAR.md` end-to-end (it's the contract), then return a plan
with the six items in §4. Stop before writing formatter code. I'll review and approve
before implementation begins.
