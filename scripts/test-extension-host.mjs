import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionRoot = join(packageRoot, "extension");
const hostTest = join(extensionRoot, "test", "host.cjs");
const vsixMode = process.argv.includes("--vsix");
const codePath = process.env.VSCODE_EXECUTABLE ??
  join(homedir(), "AppData", "Local", "Programs", "Microsoft VS Code", "Code.exe");

if (!existsSync(codePath)) {
  throw new Error("VS Code executable not found; set VSCODE_EXECUTABLE");
}

const runRoot = mkdtempSync(join(tmpdir(), "fcfmt-v5-code-"));
const resultPath = join(runRoot, "result.txt");

try {
  const userSettings = join(runRoot, "user", "User");
  mkdirSync(userSettings, { recursive: true });
  writeFileSync(join(userSettings, "settings.json"), JSON.stringify({
    "editor.defaultFormatter": "fc-format.fc-format-v5-vscode",
    "editor.formatOnSave": true,
  }));

  let developmentPath = extensionRoot;

  if (vsixMode) {
    const extensionPackage = JSON.parse(readFileSync(join(extensionRoot, "package.json"), "utf8"));
    const vsixPath = join(extensionRoot,
      `${extensionPackage.name}-${extensionPackage.version}.vsix`);

    if (!existsSync(vsixPath)) {
      throw new Error("VSIX not found; run scripts/package-vsix.ps1 first");
    }

    const cliWrapper = readFileSync(join(dirname(codePath), "bin", "code.cmd"), "utf8");
    const cliVersion = cliWrapper.match(/%~dp0\.\.\\([^\\"]+)\\resources\\app\\out\\cli\.js/i)?.[1];
    if (!cliVersion) {
      throw new Error("Cannot locate VS Code CLI entry in code.cmd");
    }

    const cliPath = join(dirname(codePath), cliVersion, "resources", "app", "out", "cli.js");
    const installation = spawnSync(codePath, [cliPath,
      "--user-data-dir", join(runRoot, "user"),
      "--extensions-dir", join(runRoot, "extensions"),
      "--install-extension", vsixPath, "--force",
    ], { encoding: "utf8", windowsHide: true, timeout: 60_000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", VSCODE_DEV: "" } });

    if (installation.error || installation.status !== 0) {
      throw new Error(`VSIX installation failed: ${installation.error?.message ??
        installation.stderr?.trim() ?? installation.stdout?.trim()}`);
    }

    // Test runner needs its own development extension; the formatter itself
    // must come solely from the installed VSIX in this mode.
    developmentPath = join(runRoot, "harness");
    mkdirSync(developmentPath);
    writeFileSync(join(developmentPath, "package.json"), JSON.stringify({
      name: "fcfmt-vsix-smoke-harness",
      publisher: "fc-format",
      version: "0.0.0",
      engines: { vscode: "^1.96.0" },
      main: "./index.cjs",
    }));
    writeFileSync(join(developmentPath, "index.cjs"), "exports.activate = () => {};\n");
  }

  const args = [
    "--new-window",
    "--disable-gpu",
    "--skip-welcome",
    "--user-data-dir", join(runRoot, "user"),
    "--extensions-dir", join(runRoot, "extensions"),
    "--extensionDevelopmentPath", developmentPath,
    "--extensionTestsPath", hostTest,
  ];

  const result = spawnSync(codePath, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      ...process.env,
      FCFMT_HOST_ROOT: runRoot,
      FCFMT_HOST_RESULT: resultPath,
    },
  });

  const marker = existsSync(resultPath) ? readFileSync(resultPath, "utf8") : "";

  if (result.error || result.status !== 0 || marker !== "passed\n") {
    const details = [result.error?.message, "VS Code exit: " + result.status,
      result.stderr?.trim().split(/\r?\n/).slice(-15).join("\n")].filter(Boolean);
    throw new Error(details.join("\n"));
  }

  process.stdout.write(vsixMode ? "Installed VSIX Extension Host parity test passed\n" :
    "VS Code Extension Host parity test passed\n");
} finally {
  const absolute = resolve(runRoot);
  const tempBase = resolve(tmpdir()) + sep;

  if (!absolute.startsWith(tempBase) || !absolute.split(sep).at(-1).startsWith("fcfmt-v5-code-")) {
    throw new Error("Unexpected Extension Host cleanup path");
  }

  rmSync(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
