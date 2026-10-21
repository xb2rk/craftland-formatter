# FC Formatter v5

FC Formatter v5 formats Craftland `.fcg` and `.fcc` files with a lossless
syntax tree and document printer. The CLI and VS Code extension share the same
core, project configuration, diagnostics and output. Current release: **0.9.0**.

## Install the VS Code extension

1. Install `extension/fc-format-v5-vscode-0.9.0.vsix` through
   **Extensions → ⋯ → Install from VSIX** in VS Code.
2. Open an FC file and use **Format Document With… → Configure Default
   Formatter → FC Format v5**. Craftland's language extension provides syntax
   highlighting and the `ffugclanguage` language ID.
3. Enable format-on-save after reviewing the style on your files:

~~~json
{
  "[ffugclanguage]": {
    "editor.defaultFormatter": "fc-format.fc-format-v5-vscode",
    "editor.formatOnSave": true
  }
}
~~~

Requires VS Code 1.96 or later. The VSIX includes its runtime, configuration
schema and user guides. A separate Node installation is needed for the CLI and
development commands, not for the installed extension.

The Command Palette provides **FC Format v5: Format Document**, **Format Selection**,
**Preview Formatting** and **Explain Configuration**. Preview shows a diff of the current
buffer; Explain shows resolved options and their sources. The bundled schema
provides completion and validation for `.fcfmt.json` without a schema URL.
See the [installation guide](INSTALL.md) and [extension guide](extension/README.md) for detailed step-by-step installation, EOL behavior, range formatting and migration.

## Use the CLI

Requires Node.js 20 or later. The runtime has no npm dependencies, so no
`npm install` or build is needed for formatting. From `tools/fc-format-v5`, use
the canonical executable or standard npm scripts:

~~~sh
npm run format -- "../../Assets/Scripts/Utils/BigNumber.fcg"
npm run format -- "../../Assets/Scripts"
npm run format:check -- "../../Assets/Scripts"
npm run format:diff -- "../../Assets/Scripts"
~~~

`format` writes formatted files. `format:check` checks without writing;
`format:diff` also prints the proposed diff. Paths are relative to the formatter
directory; absolute paths work too. Both check commands exit 1 when formatting
changes are needed, and all three exit 2 on errors.

You can also invoke the CLI directly using the canonical binary `bin/fcfmt.mjs` or backward-compatible script:

~~~sh
node tools/fc-format-v5/bin/fcfmt.mjs Assets/Scripts/Example.fcg
node tools/fc-format-v5/bin/fcfmt.mjs --check --cache Assets/Scripts
node tools/fc-format-v5/bin/fcfmt.mjs --check --diff Assets/Scripts
node tools/fc-format-v5/bin/fcfmt.mjs --write --cache Assets/Scripts
node tools/fc-format-v5/bin/fcfmt.mjs --explain-config Assets/Scripts/Example.fcg
node tools/fc-format-v5/bin/fcfmt.mjs --init
~~~

| Mode / Option | Result |
| --- | --- |
| `FILE` | Formatted bytes on stdout |
| `--stdin-filepath FILE` | Reads stdin and resolves config as if it came from FILE |
| `--check` | Exit 1 when a file needs formatting |
| `--diff` | Unified diff on stdout |
| `--write` | Replaces changed source files after all inputs pass validation |
| `--cache` | Enables persistent disk caching (`.fcfmtcache`) to skip clean unchanged files |
| `--cache-location PATH` | Custom location for the cache file (implies `--cache`) |
| `--cache-strategy STRATEGY` | Cache validation strategy: `metadata` (mtime+size) or `content` (SHA-1) |
| `--explain-config FILE` | Options, provenance and ignore decision as JSON |
| `--init` | Creates a small `.fcfmt.json` in the current directory |
| `--version` | Prints the formatter release version |

Exit codes: **0** success, **1** check differences, **2** usage/config/syntax/I/O
failure. Failed validation produces no formatted output. A failed multi-file
preflight writes no file. File replacements are atomic individually; a later
I/O failure reports any files already written.

## Customize project style

Place `.fcfmt.json` at your project root. A small starting point:

~~~json
{
  "printWidth": 120,
  "indent": { "style": "space", "size": 2, "continuation": 1 },
  "alignment": { "collections": true },
  "endOfLine": "lf",
  "spacing": {
    "operators": "spaced", "assignment": "inherit",
    "comma": "spaced", "brackets": "tight"
  },
  "imports": { "sort": false },
  "blankLines": {
    "maxConsecutive": 1,
    "afterImports": "always",
    "betweenMembers": "preserve"
  },
  "wrap": {
    "calls": "auto",
    "parameters": "preserve",
    "collections": "auto",
    "conditions": "auto"
  }
}
~~~

Resolution order: defaults → `.editorconfig` → nearest `.fcfmt.json` → matching
file overrides → explicit CLI flags. Discovery stops at the repository boundary.
Use `ignore` or `.fcfmtignore` for generated files; use `overrides` for different
styles by file pattern. Unknown options and invalid values are errors.

For example, `--spacing-assignment=compact --spacing-comma=compact` prints
`var values=List<int>{1,2,3}`. Assignment spacing controls `=` and `:=`;
compound/binary spacing follows `spacing.operators`. Assignment defaults to
`inherit`, with an explicit `spaced`/`compact` override available. Empty blocks always print
`{}`. The [config reference](docs/CONFIG_REFERENCE.md) lists every supported
value, flag, override and ignore rule. The [style guide](docs/STYLE_GUIDE.md)
shows before/after examples.

Broken maps/structs align `:`/`=` by default; set `alignment.collections: false`
to disable padding. `wrap.conditions` controls logical chains in conditions and
value expressions. Broken tails add `indent.continuation` levels, including
nested parentheses. A fitting chain stays flat in `auto`. Use
`--align-collections=false --indent-continuation=2` to try a different layout
without changing the config.

`wrap.parameters` defaults to `preserve`: func/event declarations, function
types and anonymous functions keep their authored parameter break positions.
Spacing and indentation are normalized. Use `--wrap-parameters=auto` for width
wrapping, `always` for every parameter on a new line, or `never` for flat lists.
An explicit older `parameters: "auto"` config still requests automatic wrapping.

Long arithmetic/bitwise chains, including logging concatenations, wrap after
binary operators with the same continuation indentation. Fitting nested calls
stay together. Commented collection sections keep their source blank lines up
to `blankLines.maxConsecutive` (default 1).

Use `--spacing-operators=compact --spacing-brackets=spaced --sort-imports=true`
to preview the P1 controls. `// fc-format-ignore` preserves the next complete
entry; `/* fc-format-ignore-start */` and `/* fc-format-ignore-end */` protect
a region. These comments preserve source bytes after syntax validation.

## Operator behavior and safety

| Input fragment | Default output |
| --- | --- |
| `count ++` / `count --` | `count++` / `count--` |
| `items[0] ++` | `items[0]++` |
| `count += - value` | `count += -value` |
| `count +=(value)` | `count += (value)` |
| `count >=(value)` | `count >= (value)` |
| `a + +b` / `a - -b` | `a + +b` / `a - -b` |
| `- -value` / `+ +value` | Keeps distinct unary signs |
| `a + = b`, `a + +`, `++a` | Parser diagnostic; formatting refused |

The formatter retains token spellings, comments and literal bytes, reparses its
output and checks token identity before returning it. Optional import sorting
moves complete import/comment units first. Only grammar-approved terminal
commas are normalized. Commented collections reflow with attached comments;
other commented groups and multiline literals retain protected source layout.
`printWidth` is a target; an indivisible token can exceed it.

The parser checks imports, decorators, declaration/binding types, signatures,
constructor-specific collection shapes, file structure, line breaks and
operator operands. API/type existence and full semantic validation still
require the FC compiler. Standalone assignment column alignment remains
outside the API, while range formatting is fully supported in VS Code.
See [style examples](docs/STYLE_GUIDE.md) for operator spacing, collection
padding, import sorting and source ignore pragmas.
See [troubleshooting](docs/TROUBLESHOOTING.md) and
[testing and verification](docs/TESTING_AND_VERIFICATION.md) for practical limits.

## Build and develop

From `tools/fc-format-v5`:

~~~sh
node scripts/test.mjs
node scripts/gen-config-artifacts.mjs --check
node scripts/build-extension.mjs
pwsh -NoProfile -File scripts/package-vsix.ps1
node scripts/test-extension-host.mjs --vsix
~~~

The local packager requires PowerShell 7 and refuses to overwrite an existing
versioned VSIX. With `@vscode/vsce` available, the extension directory also offers
`npm run package:vsix` after building. Both include the curated runtime and user
docs from `extension/dist`.

`npm test` invokes the same portable launcher. It discovers only
`tests/*.test.mjs`, including on Windows. The pinned Craftland syntax bundle is
needed for development oracle tests; the configured FC compiler is needed for
`node scripts/probe-compiler.mjs --formatted`. Neither is bundled in the product.
See [architecture](docs/ARCHITECTURE.md) for module ownership and
[grammar and syntax](docs/GRAMMAR_AND_SYNTAX.md) for formal grammar rules.

Before a project-wide write, inspect `node scripts/audit-rollout.mjs`, review
representative diffs and compile formatted source. Historical rollout audits
are archived in [docs/history/PHASE6_ROLLOUT.md](docs/history/PHASE6_ROLLOUT.md).
Changes are listed in [CHANGELOG.md](CHANGELOG.md).
