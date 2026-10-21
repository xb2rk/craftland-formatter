# Phase 0 Design Record

## Decision

Create a private, standalone TypeScript/ESM package named `fc-format`. It starts with package hygiene and verification infrastructure only. Formatter behavior begins after the lexical foundation is approved.

## Improvement gate

### Precedent

- `tools/fc-format-v2/package.json`, `tsconfig.json`, and `vitest.config.ts` establish the project's proven TypeScript, ESM, `tsx`, `tsc`, and Vitest shape.
- `tools/fc-format-v2/src/cli/oracle.ts` demonstrates the required disposable-copy compiler-oracle boundary.
- `tools/fc-format-v2/tests/unit/format/corpus.test.ts` establishes corpus discovery as a test concern.

### Alternatives

1. Add formatter files directly to the parent project tooling: fewer files now, but dependencies and generated output could pollute or conflict with the game repository.
2. Copy the v2 package and modify it: faster bootstrap, but imports its known architectural mistakes and makes ownership unclear.
3. Create an isolated package that reuses only the verified toolchain and harness shape: chosen. It keeps npm state local and leaves parser/printer design fresh.

### Ownership

The package owns only files under `tools/fc-format-v3/`. Its test harness may read `Assets/Scripts/`; it must never write there. The future compiler oracle creates, writes, and removes only a system temporary staging directory.

### Performance cost model

Phase 0 performs metadata checks and a corpus file walk only. Future per-file formatting is expected to be linear in source length. Full corpus and compiler-oracle work are explicit test/CI operations, never editor keystroke work.

### Contracts-first

`docs/GRAMMAR.md` remains the formatter contract. No FC contract, generated symbol, persistence schema, asset, public formatter API, or formatting CLI command is introduced in Phase 0. The package has no exported runtime API yet. The `oracle` development command only compiles a temporary copy of existing source.

## Phase gates

Every implementation phase must retain these gates:

1. Unit and golden tests pass.
2. The full `Assets/Scripts/` corpus converges under two formatting passes.
3. A temporary staged copy compiles through `fccompile_external.exe`.

Until a formatter exists, Phase 0 verifies the repository and corpus boundary only; it does not claim idempotency or compiler formatting validation. Its oracle is a baseline compiler check over an unformatted staged copy.
