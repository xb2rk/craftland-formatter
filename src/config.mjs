import { lstatSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { ConfigError, defaultLeaves, nestLeaves, optionLeaves, validateLeaf } from "./config-registry.mjs";

export const CONFIG_NAME = ".fcfmt.json";
export const IGNORE_NAME = ".fcfmtignore";

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw new ConfigError(`${path}: ${error.message}`);
  }
}

const EDITOR_KEYS = Object.freeze({
  indent_style: "indent.style",
  indent_size: "indent.size",
  end_of_line: "endOfLine",
  insert_final_newline: "finalNewline",
});

/** Glob syntax intentionally small: *, **, ?, and {choice,choice}. */
export function globRegex(pattern) {
  let regex = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];

    if (char === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        regex += "(?:.*/)?";
        index += 2;
      } else {
        regex += ".*";
        index += 1;
      }
    } else if (char === "*") {
      regex += "[^/]*";
    } else if (char === "?") {
      regex += "[^/]";
    } else if (char === "{") {
      const close = pattern.indexOf("}", index + 1);

      if (close < 0) {
        throw new ConfigError(`Unclosed glob choice in ${JSON.stringify(pattern)}`);
      }

      const choices = pattern.slice(index + 1, close).split(",");

      if (choices.some((choice) => !choice || /[{}/*?]/.test(choice))) {
        throw new ConfigError(`Invalid glob choice in ${JSON.stringify(pattern)}`);
      }

      regex += `(?:${choices.map(escapeRegex).join("|")})`;
      index = close;
    } else {
      regex += escapeRegex(char);
    }
  }

  return new RegExp(`^(?:${regex})$`);
}

function escapeRegex(value) {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

/** Match a path relative to the file that owns the pattern. */
export function matchesGlob(filePath, baseDirectory, pattern) {
  const relativePath = relative(baseDirectory, filePath).split(sep).join("/");

  if (relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)) {
    return false;
  }

  const slashPattern = pattern.replace(/\\/g, "/").replace(/^\//, "");
  const normalized = slashPattern.endsWith("/") ? `${slashPattern}**` : slashPattern;
  const target = normalized.includes("/") ? relativePath : basename(filePath);
  return globRegex(normalized).test(target);
}

/** Search toward the project marker; never escape a repository's .git boundary. */
function findUp(startDirectory, fileName) {
  let directory = resolve(startDirectory);

  while (true) {
    const candidate = join(directory, fileName);

    if (pathExists(candidate)) {
      return candidate;
    }

    if (pathExists(join(directory, ".git"))) {
      return null;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      return null;
    }

    directory = parent;
  }
}

function readUtf8(path) {
  try {
    const bytes = readFileSync(path);
    const source = bytes.toString("utf8");

    if (!Buffer.from(source, "utf8").equals(bytes)) {
      throw new ConfigError(`${path}: invalid UTF-8`);
    }

    return source;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }

    throw new ConfigError(`${path}: ${error.message}`);
  }
}

function validatePatterns(value, location) {
  if (!Array.isArray(value) || value.some((pattern) => typeof pattern !== "string" || !pattern.trim())) {
    throw new ConfigError(`${location}: expected a nonempty array of glob strings`);
  }

  for (const pattern of value) {
    const plain = pattern.startsWith("!") ? pattern.slice(1) : pattern;

    if (!plain || plain.startsWith("/") || plain.split("/").includes("..")) {
      throw new ConfigError(`${location}: glob must be relative: ${JSON.stringify(pattern)}`);
    }

    globRegex(plain);
  }

  return value;
}

function loadProjectConfig(path) {
  let config;

  try {
    config = JSON.parse(readUtf8(path));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ConfigError(`${path}: invalid JSON: ${error.message}`);
    }

    throw error;
  }

  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new ConfigError(`${path}: config root must be an object`);
  }

  const { $schema, overrides = [], ignore = [], ...settings } = config;

  if ($schema !== undefined && typeof $schema !== "string") {
    throw new ConfigError(`${path}: $schema must be a string`);
  }

  if (!Array.isArray(overrides)) {
    throw new ConfigError(`${path}: overrides must be an array`);
  }

  const parsedOverrides = overrides.map((entry, index) => {
    const location = `${path}: overrides[${index}]`;

    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        Object.keys(entry).some((key) => key !== "files" && key !== "options")) {
      throw new ConfigError(`${location}: expected only files and options`);
    }

    const files = typeof entry.files === "string" ? [entry.files] : entry.files;
    validatePatterns(files, `${location}.files`);

    if (files.some((pattern) => pattern.startsWith("!"))) {
      throw new ConfigError(`${location}.files: negation is only supported in ignore patterns`);
    }

    return { files, leaves: optionLeaves(entry.options, `${location}.options`) };
  });

  validatePatterns(ignore, `${path}: ignore`);
  return { path, directory: dirname(path), leaves: optionLeaves(settings, path), overrides: parsedOverrides, ignore };
}

function parseEditorConfig(path) {
  const lines = readUtf8(path).split(/\r\n|\r|\n/);
  const sections = [];
  let section = null;
  let root = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      section = { pattern: line.slice(1, -1), entries: [] };
      sections.push(section);
      continue;
    }

    const equals = line.indexOf("=");

    if (equals < 0) {
      continue;
    }

    const key = line.slice(0, equals).trim().toLowerCase();
    const value = line.slice(equals + 1).trim().toLowerCase();

    if (!section && key === "root") {
      root = value === "true";
    } else if (section && EDITOR_KEYS[key]) {
      section.entries.push({ key, value, line: index + 1 });
    }
  }

  return { path, root, sections };
}

function editorConfigs(filePath) {
  const configs = [];
  let directory = dirname(filePath);

  while (true) {
    const path = join(directory, ".editorconfig");

    if (pathExists(path)) {
      const config = parseEditorConfig(path);
      configs.push(config);

      if (config.root) {
        break;
      }
    }

    if (pathExists(join(directory, ".git"))) {
      break;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      break;
    }

    directory = parent;
  }

  return configs.reverse();
}

function editorLeaves(filePath) {
  const entries = [];

  for (const config of editorConfigs(filePath)) {
    for (const section of config.sections) {
      if (!matchesGlob(filePath, dirname(config.path), section.pattern)) {
        continue;
      }

      for (const entry of section.entries) {
        const location = `${config.path}:${entry.line}`;
        let value = entry.value;

        if (entry.key === "insert_final_newline") {
          if (value !== "true" && value !== "false") {
            throw new ConfigError(`${location}: insert_final_newline must be true or false`);
          }

          value = value === "true";
        } else if (entry.key === "indent_size") {
          if (value === "tab") {
            continue;
          }

          value = Number(value);
        }

        const path = EDITOR_KEYS[entry.key];
        entries.push({ path, value: validateLeaf(path, value, location), source: location });
      }
    }
  }

  return entries;
}

function ignorePatterns(path) {
  if (!path) {
    return [];
  }

  const patterns = readUtf8(path).split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  validatePatterns(patterns, path);
  return patterns;
}

/** Resolve defaults < .editorconfig < editorSettings < fallbackIndent < project < matching overrides < CLI. */
export function resolveConfig(filePath, { configPath, cliLeaves = {}, editorSettings = {}, fallbackIndent = null } = {}) {
  const absoluteFile = resolve(filePath);
  const selected = configPath ? resolve(configPath) : findUp(dirname(absoluteFile), CONFIG_NAME);
  const project = selected ? loadProjectConfig(selected) : null;
  const leaves = defaultLeaves();
  const provenance = Object.fromEntries(Object.keys(leaves).map((key) => [key, "default"]));

  function apply(values, source) {
    for (const [key, value] of Object.entries(values)) {
      leaves[key] = value;
      provenance[key] = source;
    }
  }

  for (const entry of editorLeaves(absoluteFile)) {
    apply({ [entry.path]: entry.value }, entry.source);
  }

  if (editorSettings && Object.keys(editorSettings).length > 0) {
    apply(optionLeaves(editorSettings, "vscode-settings"), "vscode-settings");
  }

  if (fallbackIndent) {
    if (fallbackIndent.style && provenance["indent.style"] === "default") {
      leaves["indent.style"] = fallbackIndent.style;
      provenance["indent.style"] = "vscode-editor";
    }
    if (fallbackIndent.size && provenance["indent.size"] === "default") {
      leaves["indent.size"] = fallbackIndent.size;
      provenance["indent.size"] = "vscode-editor";
    }
  }

  if (project) {
    apply(project.leaves, project.path);

    project.overrides.forEach((override, index) => {
      if (override.files.some((pattern) => matchesGlob(absoluteFile, project.directory, pattern))) {
        apply(override.leaves, `${project.path}:overrides[${index}]`);
      }
    });
  }

  apply(optionLeaves(cliLeaves, "CLI"), "CLI");

  const ignorePath = project ? join(project.directory, IGNORE_NAME) : findUp(dirname(absoluteFile), IGNORE_NAME);
  const activeIgnoreFile = ignorePath && pathExists(ignorePath) ? ignorePath : null;
  const ignoreRules = [
    ...(project?.ignore ?? []).map((pattern) => ({ pattern, base: project.directory, source: project.path })),
    ...(activeIgnoreFile ? ignorePatterns(activeIgnoreFile).map((pattern) => ({
      pattern, base: dirname(activeIgnoreFile), source: activeIgnoreFile,
    })) : []),
  ];
  let ignored = false;
  let ignoreReason = null;

  // NOTE: The ignore file follows config.ignore, so its negation may restore a file.
  for (const rule of ignoreRules) {
    const negative = rule.pattern.startsWith("!");
    const pattern = negative ? rule.pattern.slice(1) : rule.pattern;

    if (matchesGlob(absoluteFile, rule.base, pattern)) {
      ignored = !negative;
      ignoreReason = `${rule.source}: ${rule.pattern}`;
    }
  }

  return {
    file: absoluteFile,
    config: project?.path ?? null,
    options: nestLeaves(leaves),
    leaves,
    provenance,
    ignored,
    ignoreReason,
    ignoreFile: activeIgnoreFile,
  };
}
