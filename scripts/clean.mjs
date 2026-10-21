import { existsSync, lstatSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const extensionRoot = join(packageRoot, "extension");
const defaultOutput = join(extensionRoot, "dist");

if (existsSync(defaultOutput)) {
  if (dirname(defaultOutput) !== extensionRoot ||
      relative(extensionRoot, defaultOutput).split(sep).join("/") !== "dist") {
    throw new Error("Unexpected extension dist path");
  }

  if (lstatSync(defaultOutput).isSymbolicLink()) {
    throw new Error("Extension dist cannot be a symbolic link");
  }

  rmSync(defaultOutput, { recursive: true, force: true });
  process.stdout.write("Cleaned extension/dist\n");
} else {
  process.stdout.write("Nothing to clean\n");
}
