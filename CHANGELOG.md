# Changelog

## 0.9.0

- Default `wrap.parameters` to `preserve`: keep authored parameter break
  positions while normalizing safe spacing/indentation. Retain explicit
  `auto`, `always` and `never` choices for declarations and function types.
- Preserve capped source blank lines between commented collection rows,
  leading/trailing comments and footer comments, including nested collections.
- Wrap arithmetic/bitwise chains at binary operators, fitting operands
  independently so long concatenations do not split small nested calls first.
- Layout Modularization: split monolithic printer logic into dedicated layout
  submodules (`layout/chain.mjs`, `layout/collections.mjs`, `layout/comments.mjs`,
  `layout/declarations.mjs`, `layout/expressions.mjs`, `layout/file.mjs`, `layout/statements.mjs`).
- Complete JSDoc Type System: full `@typedef` type contracts across all 23 core
  modules without requiring a TypeScript build step.
- CLI Disk Caching: added `--cache`, `--cache-location`, and `--cache-strategy`
  (`metadata`/`content`) with atomic `.fcfmtcache` writes to skip unchanged files on warm runs.
- VS Code Range Formatting: added `vscode.languages.registerDocumentRangeFormattingEditProvider`
  with line-boundary snapping and Myers line-level diffing (`computeLineHunks`) for `Ctrl+K, Ctrl+F`.
- VS Code Config Caching: added in-memory `.fcfmt.json` cache with file watcher invalidation.
- Documentation Architecture Overhaul: rewrote all technical documentation (`ARCHITECTURE.md`,
  `GRAMMAR_AND_SYNTAX.md`, `STYLE_GUIDE.md`, `TESTING_AND_VERIFICATION.md`, `TROUBLESHOOTING.md`)
  and safely archived historical design drafts to `docs/history/`.
- Add reported-source, exact-output, grammar, idempotence, CLI/editor and
  installed-VSIX regressions; update schema, types and configuration examples.

## 0.8.0

- Reject audited invalid import clauses, decorators, binding/signature types,
  positional tuple initializers, malformed LocString arguments and bracket list
  literals. Retain contextual module/parameter names and valid header forms.
- Add spacing.operators, spacing.brackets and optional imports.sort. Assignment
  spacing defaults to inherit; explicit spaced/compact settings remain valid.
- Support line/block source ignores with protected bytes and marker diagnostics.
- Reflow commented collections with row attachments and independent alignment.
- Distinguish function-pointer parameter lists and cast calls in the printer.
- Preserve raw import path spelling and parse anonymous function bodies as
  statement blocks. Validate builtin decorator arguments and placement while
  retaining valid header decorators and custom enum-entry annotations.
- Add negative/positive grammar, exact output, CLI/editor and compiler regressions.

## 0.7.0

- Restore canonical column alignment for broken map/struct initializers with
  `alignment.collections` (default true).
- Add `indent.continuation` (default 1 level) for logical-expression tails.
- Apply logical wrapping to assignments, returns, arguments and collection
  values as well as conditions; distinguish grouping parentheses from calls.
- Recognize spaced builtin type/component arguments and canonicalize shift
  pairs without changing their tokens.
- Add explicit output regressions for the reported layouts, reviewed v4
  contracts, config/CLI/editor controls and installed-VSIX behavior.

## 0.6.0

- Reject split compound operators, missing operands and misplaced postfix updates
  in statements, conditions, calls and collections before returning output.
- Share operator roles between parser and printer. Parenthesized operands now
  print `a += (b)` and `a >= (b)`.
- Recognize component type arguments after globalEntity, index and call targets.
- Bundle configuration completion/validation schema and user docs in VSIX.
- Add portable test discovery that excludes Extension Host harnesses.
- Add CLI `--version`, checked against extension release metadata.
- Rewrite quick starts, document v3/v4 migration, troubleshooting and ownership.

## 0.5.1

- Keep postfix increment/decrement attached to identifiers, members and indexes.
- Bind unary operands after compound assignments and comparisons.
- Preserve separators between repeated unary signs to prevent token merging.
- Add reviewed v4 operator contracts, compiler fixtures and installed-VSIX tests.

## 0.5.0

- Add shared project config, CLI and VS Code formatting, preview and config explain.
- Add assignment/comma spacing, blank-line controls, generated schema and types.
- Validate corpus output, fixture compilation and rollout on disposable copies.
