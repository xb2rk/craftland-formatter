/**
 * Published formatter options. CLI help, JSON Schema, and the reference page
 * are derived from this list so a setting cannot exist only in one adapter.
 */
export const OPTIONS = Object.freeze([
  { path: "printWidth", type: "integer", minimum: 1, default: 120, cli: "--print-width", description: "Target display columns for groups.", example: 100 },
  { path: "indent.style", type: "enum", values: ["space", "tab"], default: "space", cli: "--indent-style", description: "Indent with spaces or tabs.", example: "tab" },
  { path: "indent.size", type: "integer", minimum: 1, default: 2, cli: "--indent-size", description: "Spaces per indent level when indent.style is space.", example: 4 },
  { path: "indent.continuation", type: "integer", minimum: 0, maximum: 4, default: 1, cli: "--indent-continuation", description: "Extra indent levels for broken binary-expression tails.", example: 2 },
  { path: "alignment.collections", type: "boolean", default: true, cli: "--align-collections", description: "Align map colons and struct equals signs in broken collections.", example: false },
  { path: "endOfLine", type: "enum", values: ["lf", "crlf", "preserve"], default: "lf", cli: "--end-of-line", description: "Line ending for generated layout.", example: "crlf" },
  { path: "finalNewline", type: "boolean", default: true, cli: "--final-newline", description: "Append a final line ending when missing.", example: false },
  { path: "lineBreaks", type: "enum", values: ["canonical", "preserve"], default: "canonical", cli: "--line-breaks", description: "Reflow safe groups or retain existing breaks.", example: "preserve" },
  { path: "wrap.calls", type: "enum", values: ["auto", "always", "never"], default: "auto", cli: "--wrap-calls", description: "Wrapping of call arguments.", example: "always" },
  { path: "wrap.parameters", type: "enum", values: ["preserve", "auto", "always", "never"], default: "preserve", cli: "--wrap-parameters", description: "Preserve parameter line-break positions or reflow function/event and function-type signatures.", example: "auto" },
  { path: "wrap.collections", type: "enum", values: ["auto", "always", "never"], default: "auto", cli: "--wrap-collections", description: "Wrapping of collection entries.", example: "always" },
  { path: "wrap.conditions", type: "enum", values: ["auto", "always", "never"], default: "auto", cli: "--wrap-conditions", description: "Wrapping of logical chains in conditions, assignments, returns and group items.", example: "always" },
  { path: "spacing.operators", type: "enum", values: ["spaced", "compact"], default: "spaced", cli: "--spacing-operators", description: "Spaces around binary and compound operators; required lexical separators remain.", example: "compact" },
  { path: "spacing.assignment", type: "enum", values: ["inherit", "spaced", "compact"], default: "inherit", cli: "--spacing-assignment", description: "Spaces around = and :=; inherit follows spacing.operators.", example: "compact" },
  { path: "spacing.comma", type: "enum", values: ["spaced", "compact"], default: "spaced", cli: "--spacing-comma", description: "Space after commas in flat groups.", example: "compact" },
  { path: "spacing.brackets", type: "enum", values: ["tight", "spaced"], default: "tight", cli: "--spacing-brackets", description: "Padding inside flat collections.", example: "spaced" },
  { path: "imports.sort", type: "boolean", default: false, cli: "--sort-imports", description: "Sort complete imports with attached comments into standard, Contracts and project groups.", example: true },
  { path: "blankLines.maxConsecutive", type: "integer", minimum: 0, maximum: 2, default: 1, cli: "--blank-lines-max", description: "Maximum source blank lines kept between entries.", example: 0 },
  { path: "blankLines.afterImports", type: "enum", values: ["always", "preserve", "never"], default: "always", cli: "--blank-lines-after-imports", description: "Blank line after the last import.", example: "preserve" },
  { path: "blankLines.betweenMembers", type: "enum", values: ["preserve", "always", "never"], default: "preserve", cli: "--blank-lines-between-members", description: "Blank lines between graph or declaration members.", example: "always" },
]);

const byPath = new Map(OPTIONS.map((option) => [option.path, option]));
const nestedParents = new Set(OPTIONS.map((option) => option.path.split(".")[0])
  .filter((parent) => OPTIONS.some((option) => option.path.startsWith(`${parent}.`))));

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Return a fresh object because callers apply precedence to individual leaves. */
export function defaultLeaves() {
  return Object.fromEntries(OPTIONS.map(({ path, default: value }) => [path, value]));
}

/** @param {unknown} value */
export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate one setting using the same contract as the generated schema. */
export function validateLeaf(path, value, location) {
  const option = byPath.get(path);

  if (!option) {
    throw new ConfigError(`${location}: unknown option ${path}`);
  }

  if (option.type === "integer" && (!Number.isInteger(value) || value < option.minimum ||
      option.maximum !== undefined && value > option.maximum)) {
    const range = option.maximum === undefined ? `>= ${option.minimum}` :
      `between ${option.minimum} and ${option.maximum}`;
    throw new ConfigError(`${location}: ${path} must be an integer ${range}`);
  }

  if (option.type === "boolean" && typeof value !== "boolean") {
    throw new ConfigError(`${location}: ${path} must be true or false`);
  }

  if (option.type === "enum" && !option.values.includes(value)) {
    throw new ConfigError(`${location}: ${path} must be one of ${option.values.join(", ")}`);
  }

  return value;
}

/** Flatten and reject unknown keys, including unknown nested keys. */
export function optionLeaves(input, location) {
  if (!isObject(input)) {
    throw new ConfigError(`${location}: options must be an object`);
  }

  const leaves = {};

  for (const [key, value] of Object.entries(input)) {
    if (nestedParents.has(key)) {
      if (!isObject(value)) {
        throw new ConfigError(`${location}: ${key} must be an object`);
      }

      for (const [nested, nestedValue] of Object.entries(value)) {
        const path = `${key}.${nested}`;
        leaves[path] = validateLeaf(path, nestedValue, location);
      }

      continue;
    }

    leaves[key] = validateLeaf(key, value, location);
  }

  return leaves;
}

/** Rebuild the public nested shape from validated leaves. */
export function nestLeaves(leaves) {
  const result = {};

  for (const [path, value] of Object.entries(leaves)) {
    const [parent, child] = path.split(".");

    if (child) {
      result[parent] ??= {};
      result[parent][child] = value;
    } else {
      result[parent] = value;
    }
  }

  return result;
}

/** Adapt published config keys to the Phase 3 printer's compact style input. */
export function printerOptions(leaves) {
  return {
    printWidth: leaves.printWidth,
    indentUnit: leaves["indent.style"] === "tab" ? "\t" : " ".repeat(leaves["indent.size"]),
    continuationIndent: leaves["indent.continuation"],
    alignment: { collections: leaves["alignment.collections"] },
    imports: { sort: leaves["imports.sort"] },
    endOfLine: leaves.endOfLine,
    finalNewline: leaves.finalNewline,
    lineBreaks: leaves.lineBreaks,
    wrap: {
      calls: leaves["wrap.calls"],
      parameters: leaves["wrap.parameters"],
      collections: leaves["wrap.collections"],
      conditions: leaves["wrap.conditions"],
    },
    spacing: {
      operators: leaves["spacing.operators"],
      assignment: leaves["spacing.assignment"],
      comma: leaves["spacing.comma"],
      brackets: leaves["spacing.brackets"],
    },
    blankLines: {
      maxConsecutive: leaves["blankLines.maxConsecutive"],
      afterImports: leaves["blankLines.afterImports"],
      betweenMembers: leaves["blankLines.betweenMembers"],
    },
  };
}
