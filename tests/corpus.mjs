import { readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadExtensionOracle } from "../src/grammar/extension-oracle.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const projectRoot = resolve(packageRoot, "..", "..");
const extensionRoot = dirname(dirname(loadExtensionOracle().path));

const roots = [
  join(projectRoot, "Assets", "Scripts"),
  join(extensionRoot, "library", "release"),
  join(projectRoot, "Temp", "UGCLanguage", "editorGen"),
];

/** Walk only FC source files; the game inventory may change during development. */
function collectFcFiles(root) {
  const files = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFcFiles(path));
    } else if (entry.isFile() && [".fcc", ".fcg"].includes(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }

  return files.sort();
}

export function targetCorpus() {
  return [...new Set(roots.flatMap(collectFcFiles))];
}
