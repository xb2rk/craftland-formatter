# FC Formatter v5 configuration

Generated from `src/config-registry.mjs`; edit the registry and regenerate this page and `schema.json` together.

The project config is `.fcfmt.json` (strict JSON). Discovery starts at the formatted file and walks upward, stopping after a directory containing `.git`. `--config PATH` selects a specific config. Unknown keys, invalid values, and invalid JSON are errors.

Precedence for each option: explicit CLI flag > last matching `overrides` entry > project config > `.editorconfig` > default. Override globs are relative to the config directory; entries run in array order and the last matching value wins. `--explain-config FILE` reports every effective value and its source.

| Option | Default | Example | CLI | Meaning |
| --- | --- | --- | --- | --- |
| `printWidth` | `120` | `100` | `--print-width` | Target display columns for groups. |
| `indent.style` | `"space"` | `"tab"` | `--indent-style` | Indent with spaces or tabs. |
| `indent.size` | `2` | `4` | `--indent-size` | Spaces per indent level when indent.style is space. |
| `indent.continuation` | `1` | `2` | `--indent-continuation` | Extra indent levels for broken binary-expression tails. |
| `alignment.collections` | `true` | `false` | `--align-collections` | Align map colons and struct equals signs in broken collections. |
| `endOfLine` | `"preserve"` | `"crlf"` | `--end-of-line` | Line ending for generated layout. |
| `finalNewline` | `true` | `false` | `--final-newline` | Append a final line ending when missing. |
| `lineBreaks` | `"canonical"` | `"preserve"` | `--line-breaks` | Reflow safe groups or retain existing breaks. |
| `wrap.calls` | `"auto"` | `"always"` | `--wrap-calls` | Wrapping of call arguments. |
| `wrap.parameters` | `"preserve"` | `"auto"` | `--wrap-parameters` | Preserve parameter line-break positions or reflow function/event and function-type signatures. |
| `wrap.collections` | `"auto"` | `"always"` | `--wrap-collections` | Wrapping of collection entries. |
| `wrap.conditions` | `"auto"` | `"always"` | `--wrap-conditions` | Wrapping of logical chains in conditions, assignments, returns and group items. |
| `spacing.operators` | `"spaced"` | `"compact"` | `--spacing-operators` | Spaces around binary and compound operators; required lexical separators remain. |
| `spacing.assignment` | `"inherit"` | `"compact"` | `--spacing-assignment` | Spaces around = and :=; inherit follows spacing.operators. |
| `spacing.comma` | `"spaced"` | `"compact"` | `--spacing-comma` | Space after commas in flat groups. |
| `spacing.brackets` | `"tight"` | `"spaced"` | `--spacing-brackets` | Padding inside flat collections. |
| `imports.sort` | `false` | `true` | `--sort-imports` | Sort complete imports with attached comments into standard, Contracts and project groups. |
| `blankLines.maxConsecutive` | `1` | `0` | `--blank-lines-max` | Maximum source blank lines kept between entries. |
| `blankLines.afterImports` | `"always"` | `"preserve"` | `--blank-lines-after-imports` | Blank line after the last import. |
| `blankLines.betweenMembers` | `"preserve"` | `"always"` | `--blank-lines-between-members` | Blank lines between graph or declaration members. |

```json
{
  "printWidth": 100,
  "indent": { "style": "space", "size": 2 },
  "wrap": { "collections": "always" },
  "ignore": ["generated/**"],
  "overrides": [
    { "files": "**/*.fcc", "options": { "printWidth": 80 } }
  ]
}
```

`.fcfmtignore` uses one glob per line, with `#` comments and `!` negation. Config patterns run first, then ignore-file patterns; the last matching pattern wins, so an ignore-file negation can restore a config-ignored file. Patterns are relative to their own source directory; a trailing `/` matches a directory's contents. Supported glob tokens are `*`, `**`, `?`, and `{a,b}`. Symlinked inputs are refused; symlinks encountered during directory discovery are skipped. `.git`, `node_modules`, `dist`, and `cache` directories are skipped during recursive discovery.

For `.editorconfig`, the resolver maps `indent_style`, `indent_size`, `end_of_line`, and `insert_final_newline`. `trim_trailing_whitespace` is intentionally not mapped because raw multiline FC literals must retain their bytes. The formatter never rewrites those bytes; an editor's independent save hook may still do so.

`--init` writes a small `.fcfmt.json` without overwriting an existing file. `fcfmt FILE` and `--stdin-filepath` print to stdout. `--check` exits 1 on differences; `--diff` prints a unified diff; `--write` is the only mode that changes FC files. Config, parse, and I/O failures exit 2. All files are formatted and validated before a multi-file write begins; each changed file is then atomically replaced through a sibling temporary file. A later write failure reports how many files were already written.

See [Style examples](STYLE_GUIDE.md) for operators, collection padding/alignment, logical continuations, imports and source pragmas. `spacing.assignment: inherit` follows `spacing.operators`; explicit assignment settings override it. `imports.sort` defaults to false. `wrap.conditions` also controls logical value expressions. Source pragmas are lexical directives rather than a configuration option. Arbitrary token-pair switches and standalone assignment alignment remain outside the API.
