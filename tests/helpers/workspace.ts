import { readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repositoryRoot = resolve(packageRoot, "..", "..");

const FC_SOURCE_EXTENSIONS = new Set([".fcc", ".fcg"]);

export function getPackageRoot(): string {
  return packageRoot;
}

export function getRepositoryRoot(): string {
  return repositoryRoot;
}

export function getCorpusRoot(): string {
  return join(repositoryRoot, "Assets", "Scripts");
}

export function collectCorpusFiles(directory = getCorpusRoot()): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectCorpusFiles(path));
    } else if (entry.isFile() && FC_SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}
