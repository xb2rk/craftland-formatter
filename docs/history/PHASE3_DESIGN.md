# Phase 3: document model and printer

## Structure

`src/document.mjs` defines immutable Doc nodes: text, verbatim, soft/hard lines, groups, indentation, and break-conditional text. `src/render.mjs` chooses flat or broken groups against `printWidth`. It counts tabs, combining marks, and common wide characters; an indivisible token may exceed the target width. `src/printer.mjs` maps structural syntax roles and lossless source tokens into Docs. The formatter remains independent of the Craftland extension bundle at runtime.

`formatSource(source, kind, options)` works entirely in memory. The caller receives either an output string or `output: null` with diagnostics. Empty blocks print as `{}`. Collections and bare calls may receive a comma when broken. Value calls and signatures close beside their final item. `LocString{...}` has its own role: its outer group never gains a trailing comma or a separate closing-brace line. Type arguments and indexes stay flat unless preserved source bytes require otherwise.

## Safety

Comments and multiline literals retain their exact token bytes. A group containing a comment or multiline literal is printed verbatim. The printer lexes and reparses its output, then compares syntax and protected tokens with the input. Only terminal commas in collections and bare calls are normalized for this comparison. If those checks fail, no output is returned. The independent parser is structural and does not validate every alternative of the 124-rule grammar, so the pinned extension oracle remains a development test gate, not a runtime dependency.

## Evidence

- The current test run passed 71 tests. It covered every available target corpus file: 235 game, 47 extension-library, and four editor-generated files. The game inventory was 236 files earlier in development; tests now traverse the current corpus while retaining a minimum inventory guard.
- Every formatted corpus output was accepted by the pinned extension parser and was idempotent on a second formatting pass. Golden tests cover empty blocks and width-sensitive calls/collections. Option tests cover width, indent, EOL and line-break pairs, wrap modes, final newline, comments, and literal bytes.
- All 15 compiler-positive fixtures remained oracle-accepted after formatting. The installed FC compiler accepted all 15 formatted fixtures in isolated temporary projects (`npm run probe:compiler:formatted`).
- A five-run warm benchmark, including parse, print, reparse, and token checks, measured a median of 345.79 ms on `Assets/Scripts/Utils/BigNumber.fcg` (88,551 bytes) and 256.21 ms on extension `StdLibrary.fcc` (151,750 bytes). These are local baselines, not performance promises.

## Limits before Phase 4

The style API is provisional. Phase 4 must resolve config inheritance, validation, CLI behavior, and file-writing safety. The parser can still miss an untested grammar distinction; the output oracle and compiler coverage above apply to the tested corpus and fixtures. Groups with protected content deliberately keep their source layout, so some style options have no effect inside them. Width calculation approximates display columns for Unicode and does not split long atoms.
