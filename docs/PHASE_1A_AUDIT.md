# Phase 1A Audit - Grammar and Formatter Policy

**Status:** Complete and approved for Phase 1B implementation on 2026-09-01.

This audit is deliberately read-only. It does not add a lexer, parser,
formatter, linter, or FC source change.

## Scope and evidence

| Source | What was checked |
|---|---|
| `docs/GRAMMAR.md` | Lexical, parser, layout, import, and output-hygiene contracts. |
| `docs/CODING_CONVENTION.md` | Project formatting and import-order requirements. |
| Craftland Studio VS Code extension 1.10.1 | Static `server_syntax.js` lexer/parser tables and generated parser code. The bundle cannot be imported because it starts its language server on load. |
| `Assets/Scripts` | 164 `.fcg`/`.fcc` files; import forms, standard-library ordering, comments, EOL/BOM, and whitespace shape. |
| `tools/fc-format-v2` | Reusable test/oracle shape and known failure modes only; its formatter architecture is not reused. |

The compiler-oracle executable configured by this project is currently absent,
so this audit cannot add a live compiler result. That does not permit guessing:
compiler-tested contracts supplied by the project owner remain binding.

## Confirmed syntax findings

- The document's 59 keywords, documented operator spellings, punctuators, and
  expression precedence agree with the extension.
- The lexer emits `<` and `>` separately. The parser recognizes adjacent pairs
  as shift operators only in expression context; nested generic closes remain
  type-context syntax.
- Library imports require an alias. Script imports use
  `import IDENTIFIER [as qualifiedIdent] from string_`; the imported name is
  not a `qualifiedIdent`.
- `qualifiedIdent` is one token. It is neither a dotted name nor a catch-all
  for all type-like keywords.
- The parser has 124 rules. `defineTuple` and `tupleBlock` are absent from the
  current claimed-complete document index.

## Required `GRAMMAR.md` corrections before parser work

1. Add `defineTuple` and `tupleBlock` to the parser-rule index.
2. Correct the script-import first token from `qualifiedIdent` to
   `IDENTIFIER`, and describe string-path imports by grammar form rather than
   filename extension.
3. Correct the exact `general_identifier_token` and `typeReservedWord`
   classification. In particular, `struct` and `export` are type-reserved;
   `Type` and `Color` follow the non-reserved identifier path.
4. State the exact binding of `as` cast from the parser evidence.
5. Retain the multiline call/composite comma and closing-delimiter rules as
   mandatory FC contracts. They must never be weakened by a formatter option.

## Formatter-policy findings

### Imports

Import sorting is a formatter transformation, not parser grammar. The new
import subsystem will parse imports into records with their owned comments and
trivia, then sort only within a contiguous top-level import run. It must never
move an import across a declaration, merge separate runs, drop attached
comments, synthesize an alias, or reuse a linter-specific import parser.

The project convention defines three visual groups: Standard Library,
Contracts, then project imports by relative depth. `StdLibrary.fcc` and
`EditorGenLib.fcc` are Standard Library members and are reserved at the end of
that group, in that order. Ordinary standard libraries and Contracts sort by
canonical path/name; remaining project imports sort by descending leading
`..` depth (`../../` before `../` before `./`), then canonical path/name. The
sample order in `CODING_CONVENTION.md` now records this canonical policy.

### Whitespace and blank lines

- The corpus uses LF throughout, has no UTF-8 BOMs, and every non-empty source
  file ends with LF.
- The formatter may remove trailing horizontal whitespace only in ordinary
  trivia. It must not change string, raw-string, rune, line-comment, block-
  comment, or JSDoc token content.
- Outside protected token ranges, a run of two or more empty logical lines
  canonicalizes to one empty line. This preserves a visual separator while
  removing excess blank lines.
- The generated output has exactly one final newline and no BOM.

The v2 normalizer is not reusable: it converts all line endings before it
recognizes protected ranges and can therefore alter CRLF inside a raw string or
comment. The new normalizer receives lexer trivia/token boundaries and never
performs whole-file regular-expression rewriting of protected content.

### Fixed contracts versus options

`LocString`, multiline call families, composite comma rules, K&R block braces,
and the `wrapCollections = "never"` guarantee are fixed contracts. No config
value may override them.

The approved project profile mandates two-space indentation, LF output, and
one final newline. Phase 1B creates no public formatter configuration surface.

## Rejected v2 behavior

- Context-blind generic/comparison spacing.
- Import pre-passes that can delete declarations or render `undefined` aliases.
- A `trailingComma = "never"` escape from mandatory commas.
- `wrapCollections = "never"` still introducing a line break.
- A text-level normalizer that can mutate protected content.
- Duplicate import parsing in formatter and linter.

## Implementation gates for Phase 1B onward

1. Generate and provenance-check the extension token table without hand edits.
2. Prove byte reconstruction for every source file before any formatting pass.
3. Add regression fixtures for imports, protected whitespace, blank-line
   collapse, all mandatory comma cases, and `LocString`.
4. Require two-pass byte idempotency for each supported formatter phase.
5. Run the staged compiler oracle once its configured executable is available.

## Approved decisions

1. The formatter is project-profile-only: 2 spaces, LF, and one final newline.
2. Comment tokens, including trailing spaces within them, are byte-preserved;
   cleanup applies only to non-protected trivia.
3. The grammar-document corrections listed above are approved and applied.
