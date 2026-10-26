/** Copy only the runtime core needed by the VS Code adapter. */

import { copyFileSync, existsSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const extensionRoot = join(packageRoot, "extension");
const defaultOutput = join(extensionRoot, "dist");

const CORE_FILES = Object.freeze([
  "service.mjs",
  "config.mjs",
  "config-registry.mjs",
  "cache.mjs",
  "diff.mjs",
  "printer.mjs",
  "document.mjs",
  "render.mjs",
  "imports.mjs",
  "pragmas.mjs",
  "layout/collection-alignment.mjs",
  "layout/declaration-alignment.mjs",
  "layout/logical-chain.mjs",
  "syntax/parser.mjs",
  "syntax/types.mjs",
  "syntax/operators.mjs",
  "syntax/lexer.mjs",
  "syntax/lexicon.generated.mjs",
  "lint/engine.mjs",
  "lint/rules/index.mjs",
  "lint/rules/no-assignment-in-condition.mjs",
  "lint/rules/no-empty-block.mjs",
  "lint/rules/no-self-compare.mjs",
  "lint/rules/no-unreachable-code.mjs",
  "lint/rules/no-unused-imports.mjs",
  "lint/rules/no-zero-step-for-loop.mjs",
  "symbols/extractor.mjs",
  "symbols/indexer.mjs",
]);
const USER_FILES = Object.freeze([
  ["schema.json", "fcfmt.schema.json"],
  ["docs/CONFIG_REFERENCE.md", "docs/CONFIG_REFERENCE.md"],
  ["docs/STYLE_GUIDE.md", "docs/STYLE_GUIDE.md"],
  ["docs/TROUBLESHOOTING.md", "docs/TROUBLESHOOTING.md"],
  ["CHANGELOG.md", "docs/CHANGELOG.md"],
]);

/** The explicit list is also the runtime dependency boundary. */
export function copyExtensionRuntime(outputDirectory) {
  const output = resolve(outputDirectory);

  if (existsSync(output) && lstatSync(output).isSymbolicLink()) {
    throw new Error("Extension output cannot be a symbolic link");
  }

  mkdirSync(output, { recursive: true });
  copyFileSync(join(extensionRoot, "src", "extension.cjs"), join(output, "extension.cjs"));
  for (const [sourcePath, targetPath] of USER_FILES) {
    const target = join(output, targetPath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(packageRoot, sourcePath), target);
  }

  for (const relativePath of CORE_FILES) {
    const source = join(packageRoot, "src", relativePath);
    const target = join(output, "core", relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }

  return ["extension.cjs", ...USER_FILES.map(([, target]) => target),
    ...CORE_FILES.map((file) => "core/" + file)];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Delete only the known generated dist folder directly under this extension.
  if (dirname(defaultOutput) !== extensionRoot ||
      relative(extensionRoot, defaultOutput).split(sep).join("/") !== "dist") {
    throw new Error("Unexpected extension build target");
  }

  if (existsSync(defaultOutput) && lstatSync(defaultOutput).isSymbolicLink()) {
    throw new Error("Extension build target cannot be a symbolic link");
  }

  rmSync(defaultOutput, { recursive: true, force: true });
  const files = copyExtensionRuntime(defaultOutput);
  process.stdout.write("Built FC Format v5 extension runtime (" + files.length + " files)\n");
}
