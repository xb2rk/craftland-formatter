# FC Format v4 (`tools/fc-format-v4`)

Next-generation, modular, high-performance, and deterministic code formatter and language toolchain for the Free Fire Craftland Code (FC) language.

---

## Highlights

- **Grammar Synchronized with VS Code Extension `1.11.0`**: Fully aligned with all 129 lexer tokens and 125 ANTLR rules from `craftlandstudio.ffugclanguage-1.11.0`. Verified by automated grammar provenance suite (`npm run verify:grammar`).
- **Standard Industry Architecture**: Built following Google TypeScript Style and Prettier principles. Decomposes monolithic structures into clean, single-responsibility modules (< 300 lines each) with top-level imports and strict discriminated unions.
- **100% Lossless & Idempotent**: Guaranteed zero code distortion across all files. Tested against 164 checked-in `.fcg` and `.fcc` files in the repository.
- **Single-Pass Import Formatting**: Eliminates the previous double-lex / double-parse bottleneck by sorting and emitting import runs in a single pass.
- **Pragmas Support**: Includes `// fc-format-ignore` and block comments `/* fc-format-ignore-start */` ... `/* fc-format-ignore-end */` to selectively exclude tricky legacy blocks or custom artistic layouts.
- **Automatic Upward Config Discovery**: Discovers `.fcformatrc.json`, `.fcformatrc`, or `package.json#fcformat` walking up the directory tree.
- **Extensible Configuration**: Full JSON Schema (`schema.json`) with IDE auto-completion.

---

## Quick Start

### Formatting Files

```bash
# Format files in place
fc-format-v4 Assets/Scripts/

# Explicit write flag
fc-format-v4 -w Assets/Scripts/Main.fcg

# Check if files match canonical formatting without modifying them (CI gate)
fc-format-v4 --check Assets/Scripts/

# View unified diffs of changes
fc-format-v4 --diff Assets/Scripts/

# Format code from stdin (ideal for IDE piping / external editors)
cat file.fcg | fc-format-v4 --stdin-filepath file.fcg

# Use an explicit configuration file
fc-format-v4 --config path/to/.fcformatrc.json Assets/Scripts/
```

### Programmatic API

```typescript
import { formatSource, lex, parseGraphFile, parseHeaderFile } from "fc-format-v4";

const source = `graph Demo { func Run() { var x = 1 + 2 } }`;

// Format source code with custom or default options
const result = formatSource(source, {
  fileName: "Demo.fcg",
  printWidth: 120,
  tabWidth: 2,
  useTabs: false,
});

if (result.code !== undefined) {
  console.log(result.code);
} else {
  console.error("Syntax errors encountered:", result.diagnostics);
}
```

---

## Configuration Reference (`.fcformatrc.json`)

| Option | Type | Default | Description |
|---|---|---|---|
| `$schema` | `string` | `"./schema.json"` | JSON Schema URI for editor auto-completion and validation. |
| `printWidth` | `number` | `120` | Soft column wrap threshold for calls, conditionals, and composite literals. |
| `tabWidth` | `number` | `2` | Number of spaces per indentation level. |
| `useTabs` | `boolean` | `false` | Indent with tabs instead of spaces. |
| `spaceAroundOperators` | `boolean` | `true` | Ensure spaces around binary and assignment operators (`a + b`, `x = 1`). |
| `spaceAfterComma` | `boolean` | `true` | Ensure a space after commas in argument, parameter, and item lists. |
| `wrapCalls` | `"auto" \| "always" \| "never"` | `"auto"` | Line wrapping mode for call expressions and function signatures. |
| `wrapCollections` | `"auto" \| "always" \| "never"` | `"auto"` | Line wrapping mode for map, struct, and list composite literals. |
| `collapseBlankLines` | `boolean` | `true` | Collapse runs of consecutive empty lines down to at most 1 blank line. |
| `insertFinalNewline` | `boolean` | `true` | Ensure formatted files terminate with a single newline character. |
| `endOfLine` | `"lf" \| "crlf" \| "auto"` | `"lf"` | Newline convention (`lf` for Unix/Git standard, `crlf` for Windows, `auto` preserves source). |
| `alignCompositeSeparators` | `boolean` | `true` | Vertically align `:` in multi-line maps and `=` in multi-line struct literals. |
| `bracketSpacing` | `boolean` | `false` | Insert spaces inside `{ }` delimiters for single-line composites. |
| `sortImports` | `boolean` | `true` | Alphabetically sort and group header import runs at the top of the file. |

---

## Formatting Pragmas

To prevent the formatter from modifying specific lines or blocks of code, use format ignore pragmas:

### Single-line ignore: `// fc-format-ignore`

Ignores the statement or expression on the immediately following line:

```fc
func Calculate() {
  // fc-format-ignore
  var matrix = [1,  0,  0,
                0,  1,  0,
                0,  0,  1]
}
```

### Block ignore: `/* fc-format-ignore-start */` and `/* fc-format-ignore-end */`

Ignores an arbitrary range of lines:

```fc
/* fc-format-ignore-start */
func MatrixMultiply(
    a1, a2, a3,
    b1, b2, b3
) {
  // preserved exactly as typed
}
/* fc-format-ignore-end */
```

---

## Architectural Decomposition

```
tools/fc-format-v4/
├── schema.json                    # Configuration schema with autocomplete
├── .fcformatrc.json               # Default repository format configuration
├── package.json                   # ESM module configuration & scripts
├── tsconfig.json                  # Strict TypeScript configuration
├── scripts/
│   └── gen-token-vocabulary.mjs   # Extension 1.11.0 token generator & provenance validator
└── src/
    ├── grammar/                   # Generated & verified lexical tokens (129 tokens)
    │   ├── token-vocabulary.generated.ts
    │   ├── lexical.ts
    │   └── index.ts
    ├── lex/                       # Lossless trivia & token scanner (< 300 lines/file)
    │   ├── position.ts            # UTF-16 and 0-based coordinate models
    │   ├── token.ts               # Token data structure
    │   ├── trivia.ts              # Whitespace, comments, newlines
    │   ├── lexer.ts               # Complete lossless lexical scanner
    │   ├── reconstruct.ts         # Lossless byte-exact source reconstructor
    │   └── index.ts
    ├── syntax/                    # Discriminated union AST & type guards
    │   ├── core.ts                # AST node base types & spans
    │   ├── types.ts               # Type expression nodes
    │   ├── expressions.ts         # Expression nodes
    │   ├── statements.ts          # Statement & block nodes
    │   ├── declarations.ts        # Function, Graph, Enum, Struct declaration nodes
    │   ├── guards.ts              # User-defined type guards (zero unsafe casts)
    │   ├── visitor.ts             # Generic AST walker & reducer
    │   └── index.ts
    ├── parser/                    # Modular recursive-descent grammar parsers
    │   ├── cursor.ts              # Checkpointing token cursor
    │   ├── diagnostic.ts          # Parser error & warning models
    │   ├── recovery.ts            # Panic-mode and boundary error recovery
    │   ├── statement-boundary.ts  # Automatic Semicolon / EOS inference
    │   ├── type-parser.ts         # Types, generics, function signatures
    │   ├── composite-parser.ts    # Map, Struct, List, and LocString literals
    │   ├── expression-parser.ts   # Precedence climbing expression parser
    │   ├── statement-parser.ts    # Control flow, loops, assignments, variables
    │   ├── declaration-parser.ts  # Graph, function, and component declarations
    │   ├── file-parser.ts         # .fcc and .fcg file parsers
    │   └── index.ts
    ├── imports/                   # In-place single-pass import sorting
    │   ├── import-sorter.ts       # Canonical header grouping & alphabetic sorting
    │   └── index.ts
    ├── format/                    # Modular syntax-directed formatting engine
    │   ├── options.ts             # Configuration schema & normalization
    │   ├── config-loader.ts       # Upward .fcformatrc.json discovery
    │   ├── pragmas.ts             # // fc-format-ignore range extraction
    │   ├── token-writer.ts        # Indentation, line-break & column buffer
    │   ├── ast-context.ts         # AST semantic token classifier
    │   ├── width-cache.ts         # Bottom-up width precomputations with O(1) jump
    │   ├── alignment.ts           # Configurable map/struct column alignment
    │   ├── formatter.ts           # Lossless token-stream layout orchestrator
    │   └── index.ts
    └── cli/                       # CLI commands & diagnostics
        ├── diagnostics.ts         # Coordinate-aware terminal diagnostic formatter
        └── format.ts              # Command line runner with --check, --write, --config
```

---

## Verification & Testing

```bash
# Verify grammar synchronization with VS Code Extension 1.11.0
npm run verify:grammar

# Run full test suite (70+ unit tests, golden fixtures, hardening, and corpus)
npm test

# Run corpus test (formats, reparses, and verifies idempotency on all 164 files)
npx vitest run tests/format/formatter-corpus.test.ts

# Run differential parity test against v3
npx vitest run tests/format/formatter-differential.test.ts
```
