# Parser Module

The parser consumes lossless tokens from `src/lex/` and emits typed syntax nodes with source
ranges. Phase 2A supplies `statement-boundary.ts`, a differential-tested recreation of FC's
automatic-semicolon behavior. Phase 2B adds the parser kernel plus type/expression productions.

This folder deliberately contains no formatter layout decisions and exports no package-root API.
