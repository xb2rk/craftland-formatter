import { existsSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadExtensionOracle } from "../src/grammar/extension-oracle.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const fixturesRoot = join(packageRoot, "tests", "fixtures");
const extensionRoot = dirname(dirname(loadExtensionOracle().path));

const roots = [
  fixturesRoot,
  join(extensionRoot, "library", "release"),
  process.env.FC_CORPUS_DIR ? resolve(process.env.FC_CORPUS_DIR) : null,
].filter(Boolean);

/** Walk only FC source files. */
function collectFcFiles(root) {
  if (!root || !existsSync(root)) {
    return [];
  }

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
