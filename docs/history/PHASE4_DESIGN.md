# Phase 4: configuration and CLI

## Contract

The first project config is strict JSON named `.fcfmt.json`. `src/config-registry.mjs` owns the published option names, defaults, validation, descriptions, examples, and CLI flags. `scripts/gen-config-artifacts.mjs` derives `schema.json`, `config.d.ts`, and `docs/CONFIG_REFERENCE.md` from it. `src/config.mjs` resolves effective values and provenance for a file; the future editor adapter can call the same resolver. Unknown keys and invalid values fail instead of falling back.

Discovery walks from the target file toward its repository marker. Precedence is explicit CLI > last matching per-file override > project config > `.editorconfig` > defaults. Override and ignore globs are relative to their owning config or ignore file. `.fcfmtignore` can negate a project ignore pattern. `--explain-config FILE` prints the effective options, each source, and ignore decision.

`scripts/fcfmt.mjs` supports stdout, stdin with a filepath, check, diff, explicit write, explain, and init. Directory discovery has stable lexical order, skips internal build/package directories, and does not follow symlinks. Only `--write` changes FC files. Its batch preflight formats and validates every selected file before the first write. Each changed file is then written to a temporary sibling with the original mode bits, flushed, and renamed. A concurrent edit detected before replacement aborts that file. A later I/O failure reports how many earlier files were written; batch-wide atomicity is not promised. There remains a narrow race between the final comparison and rename, and a replacement cannot preserve file-specific Windows ACLs through Node's portable file API.

The diff adapter emits a deterministic unified diff without invoking Git. It uses one hunk around the changed span. This keeps the implementation small but a file with widely separated changes can produce a large hunk.

## Verification

Integration tests use temporary directories and child CLI processes to check precedence, explanations, init, stdin/stdout, check/diff/write exit codes, no implicit writes, ignored paths, unknown settings, malformed source, all-file preflight, a simulated permission failure during atomic replacement, and Windows paths with spaces and CRLF. The symlink test runs when the host can create symlinks. `npm run config:check` detects generated-artifact drift.

Phase 3's full-corpus oracle, idempotence, and 15 formatted compiler-positive fixtures remain the printer gate. Phase 4 did not write to game source files.

## Deferred controls

The registry includes only options that affect the printer. At the phase 4
checkpoint, continuation indentation, spacing, blank-line limits, alignment,
pragma ignores and import organization were deferred. Spacing/blank-line
controls, logical continuation/collection alignment, operator/bracket spacing,
pragma ignores and import organization are now implemented;
see [the current configuration reference](CONFIG_REFERENCE.md).
`trim_trailing_whitespace` from
`.editorconfig` is intentionally not applied to FC source because it could
alter a raw multiline literal. The VS Code adapter and release dry run were
completed in later phases.
