# Phase 4 - End-to-end hardening

## Status

Local hardening is complete. No `.fcc` or `.fcg` source under `Assets/` was modified.

## Gates

- Strict TypeScript typecheck: passed with the package-local TypeScript binary.
- Production build: passed.
- Vitest: 12 test files, 74 tests passed (the corpus gate is included).
- Corpus gate: all 165 checked-in `.fcc`/`.fcg` files formatted successfully; every result
  reparsed with zero diagnostics and complete EOF consumption; a second format pass produced
  identical bytes.
- CLI smoke gate: `format --help` and `format --check` run successfully on a corpus file.
- Compiler oracle: `oracle --format` successfully formats a temporary staged copy and invokes the
  installed `fccompile_external.exe` over all 165 files. The baseline and formatted runs both exit
  nonzero on the same pre-existing project diagnostics (duplicate `CustomTuple` import alias and
  unresolved project symbols); the formatted run adds no syntax/parse diagnostic. A clean compiler
  exit therefore remains blocked by the corpus' existing semantic errors, not by formatter output.

## Safety and determinism

Formatting refuses lexical or parser diagnostics, preserves protected literal/comment token bytes,
normalizes output to LF with one final newline, sorts only contiguous import runs, and performs no
filesystem writes from the library API. The CLI writes only explicitly supplied files and supports
`--check` for CI.
