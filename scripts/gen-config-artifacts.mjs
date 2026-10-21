/**
 * @fileoverview Generator script for configuration schema, TypeScript typings,
 * and markdown documentation derived from src/config-registry.mjs.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { OPTIONS } from "../src/config-registry.mjs";

/**
 * Builds a JSON schema fragment for a single configuration option.
 *
 * @param {import("../src/config-registry.mjs").OptionDefinition} option
 * @returns {Record<string, unknown>} JSON schema object.
 */
function optionSchema(option) {
  const schema = {
    description: option.description,
    default: option.default,
    examples: [option.example],
  };

  if (option.type === "integer") {
    return {
      ...schema,
      type: "integer",
      minimum: option.minimum,
      ...(option.maximum === undefined ? {} : { maximum: option.maximum }),
    };
  }

  if (option.type === "boolean") {
    return {
      ...schema,
      type: "boolean",
    };
  }

  return {
    ...schema,
    type: "string",
    enum: option.values,
  };
}

/**
 * Builds nested property schemas for all options in the registry.
 *
 * @returns {Record<string, unknown>}
 */
function settingsSchema() {
  const properties = {};

  for (const option of OPTIONS) {
    const [parent, child] = option.path.split(".");

    if (child) {
      properties[parent] ??= {
        type: "object",
        additionalProperties: false,
        properties: {},
      };
      properties[parent].properties[child] = optionSchema(option);
    } else {
      properties[parent] = optionSchema(option);
    }
  }

  return properties;
}

/**
 * Assembles the complete JSON Schema Draft 2020-12 specification document.
 *
 * @returns {Record<string, unknown>}
 */
function schema() {
  const options = settingsSchema();
  const fileGlob = {
    oneOf: [
      { type: "string", minLength: 1 },
      { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    ],
  };

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "FC Formatter v5 project config",
    type: "object",
    additionalProperties: false,
    properties: {
      $schema: { type: "string" },
      ...options,
      ignore: { type: "array", items: { type: "string", minLength: 1 }, default: [] },
      overrides: {
        type: "array",
        default: [],
        items: {
          type: "object",
          additionalProperties: false,
          required: ["files", "options"],
          properties: {
            files: fileGlob,
            options: { type: "object", additionalProperties: false, properties: options },
          },
        },
      },
    },
  };
}

/**
 * Returns TypeScript primitive/union type string for a config option.
 *
 * @param {import("../src/config-registry.mjs").OptionDefinition} option
 * @returns {string}
 */
function tsType(option) {
  if (option.type === "integer") {
    return "number";
  }

  if (option.type === "boolean") {
    return "boolean";
  }

  return option.values.map((value) => JSON.stringify(value)).join(" | ");
}

/**
 * Generates TypeScript declaration file content (config.d.ts).
 *
 * @returns {string}
 */
function types() {
  const top = OPTIONS.filter((option) => !option.path.includes("."));
  const parents = [...new Set(OPTIONS.filter((option) => option.path.includes("."))
    .map((option) => option.path.split(".")[0]))];
  const fields = (options, padding) => options.map((option) =>
    `${padding}${option.path.split(".").at(-1)}?: ${tsType(option)};`).join("\n");
  const nested = parents.flatMap((parent) => [
    `  ${parent}?: {`,
    fields(OPTIONS.filter((option) => option.path.startsWith(`${parent}.`)), "    "),
    "  };",
  ]);

  return [
    "// Generated from src/config-registry.mjs. Do not edit directly.",
    "export interface FormatterSettings {",
    fields(top, "  "),
    ...nested,
    "}",
    "export type ConfigFile = FormatterSettings & {",
    "  $schema?: string;",
    "  ignore?: string[];",
    "  overrides?: Array<{ files: string | string[]; options: FormatterSettings }>;",
    "};",
    "",
  ].join("\n");
}

/**
 * Generates the Markdown reference documentation (CONFIG_REFERENCE.md).
 *
 * @returns {string}
 */
function reference() {
  const rows = OPTIONS.map((option) =>
    `| \`${option.path}\` | \`${JSON.stringify(option.default)}\` | \`${JSON.stringify(option.example)}\` | \`${option.cli}\` | ${option.description} |`);

  return [
    "# FC Formatter v5 configuration",
    "",
    "Generated from `src/config-registry.mjs`; edit the registry and regenerate this page and `schema.json` together.",
    "",
    "The project config is `.fcfmt.json` (strict JSON). Discovery starts at the formatted file and walks upward, stopping after a directory containing `.git`. `--config PATH` selects a specific config. Unknown keys, invalid values, and invalid JSON are errors.",
    "",
    "Precedence for each option: explicit CLI flag > last matching `overrides` entry > project config > `.editorconfig` > default. Override globs are relative to the config directory; entries run in array order and the last matching value wins. `--explain-config FILE` reports every effective value and its source.",
    "",
    "| Option | Default | Example | CLI | Meaning |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "```json",
    "{",
    "  \"printWidth\": 100,",
    "  \"indent\": { \"style\": \"space\", \"size\": 2 },",
    "  \"wrap\": { \"collections\": \"always\" },",
    "  \"ignore\": [\"generated/**\"],",
    "  \"overrides\": [",
    "    { \"files\": \"**/*.fcc\", \"options\": { \"printWidth\": 80 } }",
    "  ]",
    "}",
    "```",
    "",
    "`.fcfmtignore` uses one glob per line, with `#` comments and `!` negation. Config patterns run first, then ignore-file patterns; the last matching pattern wins, so an ignore-file negation can restore a config-ignored file. Patterns are relative to their own source directory; a trailing `/` matches a directory's contents. Supported glob tokens are `*`, `**`, `?`, and `{a,b}`. Symlinked inputs are refused; symlinks encountered during directory discovery are skipped. `.git`, `node_modules`, `dist`, and `cache` directories are skipped during recursive discovery.",
    "",
    "For `.editorconfig`, the resolver maps `indent_style`, `indent_size`, `end_of_line`, and `insert_final_newline`. `trim_trailing_whitespace` is intentionally not mapped because raw multiline FC literals must retain their bytes. The formatter never rewrites those bytes; an editor's independent save hook may still do so.",
    "",
    "`--init` writes a small `.fcfmt.json` without overwriting an existing file. `fcfmt FILE` and `--stdin-filepath` print to stdout. `--check` exits 1 on differences; `--diff` prints a unified diff; `--write` is the only mode that changes FC files. Config, parse, and I/O failures exit 2. All files are formatted and validated before a multi-file write begins; each changed file is then atomically replaced through a sibling temporary file. A later write failure reports how many files were already written.",
    "",
    "See [Style examples](STYLE_GUIDE.md) for operators, collection padding/alignment, logical continuations, imports and source pragmas. `spacing.assignment: inherit` follows `spacing.operators`; explicit assignment settings override it. `imports.sort` defaults to false. `wrap.conditions` also controls logical value expressions. Source pragmas are lexical directives rather than a configuration option. Arbitrary token-pair switches and standalone assignment alignment remain outside the API.",
    "",
  ].join("\n");
}

const outputs = new Map([
  [new URL("../schema.json", import.meta.url), JSON.stringify(schema(), null, 2) + "\n"],
  [new URL("../config.d.ts", import.meta.url), types()],
  [new URL("../docs/CONFIG_REFERENCE.md", import.meta.url), reference()],
]);
const check = process.argv.includes("--check");

for (const [path, content] of outputs) {
  if (check) {
    if (readFileSync(path, "utf8") !== content) {
      throw new Error(`${path.pathname} is stale; run node scripts/gen-config-artifacts.mjs`);
    }
  } else {
    writeFileSync(path, content);
  }
}
