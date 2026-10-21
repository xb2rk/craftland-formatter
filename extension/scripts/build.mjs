import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
import "./build-core.mjs";

const extensionDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await build({
  absWorkingDir: extensionDirectory,
  entryPoints: ["./src/extension.ts"],
  bundle: true,
  external: ["vscode"],
  format: "esm",
  platform: "node",
  sourcemap: true,
  target: "node20",
  outfile: "dist/extension.js",
});
