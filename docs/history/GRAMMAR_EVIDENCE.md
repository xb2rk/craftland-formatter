# Grammar evidence — Phase 1

**Status:** Phase 1 grammar gate met on 2026-10-07. This package does not yet contain a formatter.

## Authority and provenance

The target is Craftland Studio language extension 1.11.0, artifact dist/server_syntax.js. grammar/baseline.json pins SHA-256 fbfe4b87158096a84a9978cb54552b8fe33e24e561807ebee5f2f085463f9367 and 124 parser rules.

src/grammar/extension-oracle.mjs loads FCGLexer, FCGParser, ANTLRInputStream, and CommonTokenStream without starting the extension language server. It checks the hash before evaluating the bundle and fails if the pinned webpack entry changes. The bundle stays in the local extension; v5 does not copy it or require it at formatter runtime. The parser entry is sourceFile(), followed by verification that it selected graphFile for .fcg or headerFile for .fcc.

The extension parser and the project-configured compiler are the syntax authorities used here. The game corpus and v4 tests are examples, not complete grammar definitions.

## Reproduce

Use Node.js 20 or newer. From this package directory:

~~~text
node --test tests/grammar-oracle.test.mjs tests/layout-safety.test.mjs tests/grammar-matrix.test.mjs tests/trivia-safety.test.mjs
node scripts/probe-grammar.mjs
node scripts/probe-grammar.mjs --corpus PATH --corpus PATH
node scripts/probe-compiler.mjs
~~~

The grammar probe discovers the exact extension under .vscode/extensions or .vscode-insiders/extensions. Use FC_GRAMMAR_BUNDLE or --bundle PATH to override discovery. The default corpus is Assets/Scripts. The compiler probe reads Temp/UGCLanguage/fcconfig.json, copies editorGen references into a checked temporary project, runs a full -i Assets compile per fixture, and removes only that temporary project. It does not modify game Assets or generated references. Set FC_COMPILE_SESSION to a stable conversation ID when running multiple compiler probes in one session; FC_COMPILE_MODEL defaults to unknown-model if the exact model identifier is unavailable.

## Coverage and compiler results

At the 2026-10-07 run, all 287 sampled files parsed: 236 game FC files, 47 files from the installed extension library, and four editorGen .fcc files. They exercised 119 of 124 parser rules. Four small rare-rule fixtures in grammar/rare-fixtures.json exercised the other five rules, bringing the development suite to **124/124 observed rule indices**. This measures rule entry, not all branches within each rule.

grammar/rule-families.json assigns every rule index to one navigation family. scripts/probe-grammar.mjs fails on unclassified rules, rejected files or rejected rare fixtures. The sampled corpus had no parser rejection. The 24 isolated fixtures showed no parser/compiler discrepancy; the 287 corpus files were not compiled individually.

The isolated compiler matrix in grammar/compiler-fixtures.json has **24/24 expected outcomes**: 15 accepted and nine rejected by both parser and compiler. It includes .fcg and .fcc, flat and broken structures, raw CRLF text, and negative syntax. Compiler path and generated-symbol references come from the current project configuration. This is fixture validation, not a full game compile; no game .fcg or .fcc was edited.

## Line-break and syntax constraints established

- A graph file needs at least one import. Importless graph examples accepted by the v4 parser are invalid in the 1.11.0 extension parser and compiler.
- Graph, function, and if/else blocks can be empty. The chosen v5 style prints empty blocks compact as {} even though a multiline empty block also parses.
- In the tested contexts, a break **after** a logical or arithmetic operator, argument comma, generic comma, or member dot parses; moving the break **before** it does not. A return keyword stays on the same line as its value, and else stays on the closing-brace line.
- A broken bare call, wait call, or start call can use a trailing comma and put ) on its own line. A call used as a value or return value closes ) beside its last argument and has no trailing comma. A broken function signature also closes beside its final parameter without a trailing comma.
- A broken index keeps ] beside its final expression. A broken generic keeps > beside its final type. Nested generic >> and a break after the comma parse.
- Broken list, map, and struct composites require a trailing comma after the final item before a closing line. Empty and single-item collections parse. Map keys use : and named struct fields use =; nested composites parse.
- if/else, for, and while parse in the tested forms. switch is not a statement in this grammar; both parser and compiler reject the tested switch fixture.
- The lexer returns comments, JSDoc, whitespace, and raw multiline literal text with source spans. CRLF is accepted, and trailing spaces inside raw literals remain part of the literal token. A UTF-8 BOM before import is rejected by lexer and compiler. An fc-format-ignore comment is lexed as an ordinary line comment; ignore behavior belongs to the formatter.
- Duplicate imports and aliases are syntactically accepted. This does not prove they are semantically interchangeable, so import organization remains a separate, later action.

The exact accepted/rejected source examples live in tests/layout-safety.test.mjs, tests/grammar-matrix.test.mjs, tests/trivia-safety.test.mjs, grammar/rare-fixtures.json, and grammar/compiler-fixtures.json. The compiler matrix covers representative MVP breaks; not every parser-only example has a compiler fixture.

## Limits for later phases

- Rare bridging component, declared graph function, and anonymous-function assignment fixtures have parser confirmation only. The function-pointer type fixture also passed the isolated compiler.
- Rule coverage does not establish full alternative/branch coverage. Phase 2 must compare its fresh lexer/parser against the pinned oracle on fixtures and corpus.
- Comment/JSDoc attachment, ignore-range ownership, exact literal bytes in formatted output, and import equivalence require formatter-level tests in Phases 2–4.
- Printer options must use only context-specific grammar-approved breaks. A new break position requires a new parser probe and representative compiler fixture before release.
