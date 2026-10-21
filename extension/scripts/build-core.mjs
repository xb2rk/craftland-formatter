import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const extensionDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const formatterDirectory = resolve(extensionDirectory, "..");
await execute(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], { cwd: formatterDirectory });
