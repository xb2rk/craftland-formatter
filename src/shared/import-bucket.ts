/**
 * @module shared/import-bucket - shared import-bucket logic.
 *
 * Buckets are ordered to match the requested style:
 *   0 - library normal (`import "Foo.fcc" as Bar` bare, except Std/EditorGen)
 *   1 - StdLibrary.fcc
 *   2 - EditorGenLib.fcc
 *   3 - script `from` (`import Foo [as Bar] from "path"` non-Contracts)
 *   4 - Contracts (`.../Contracts/...`)
 *   5 - ../ depth
 *   6 - ./ local and everything else
 *
 * `format/format.ts` (formatter) and `lint/rules/imports.ts` (linter) share
 * this so `fmt` and `Fix All` cannot drift. Blanks are inserted between
 * buckets where the project expects them (see `renderSortedBlock`).
 */

export type ImportKindBucket = "library" | "script";

/**
 * Determine the bucket for an import path.
 *
 * @param kind - import kind (`library` vs `script`).
 * @param rawPath - import path.
 * @returns bucket 0–6.
 */
export function importBucket(kind: ImportKindBucket, rawPath: string): number {
  const path = rawPath.replace(/\\/gu, "/");
  // Exact Std/EditorGen splits before generic checks.
  if (path === "StdLibrary.fcc") {
    return 1;
  }
  if (path === "EditorGenLib.fcc") {
    return 2;
  }
  // Contracts always after the library/script preamble.
  if (/(^|\/)Contracts(\/|$)/u.test(path)) {
    return 4;
  }
  // Bare library (`import "Foo.fcc" as Bar` without slash) before Std/EditorGen.
  if (kind === "library" && !path.includes("/") && !path.startsWith(".")) {
    return 0;
  }
  // Script `from` before Contracts (except local `./` which stays last).
  // `Foo as Bar from "../Systems/..."` should sort before Contracts.
  if (kind === "script" && !path.startsWith("./")) {
    return 3;
  }
  if (path.startsWith("../")) {
    return 5;
  }
  return 6;
}
