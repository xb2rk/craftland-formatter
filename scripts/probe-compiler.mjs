#!/usr/bin/env node
/**
 * Compile isolated FC layout fixtures with the project-configured compiler.
 *
 * Each fixture receives a fresh temporary project and a temporary copy of
 * editorGen references. No game source or generated reference is modified.
 */
import { spawnSync } from "node:child_process";
import { existsSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { parseWithOracle } from "../src/grammar/extension-oracle.mjs";
import { formatSource } from "../src/printer.mjs";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(packageRoot, "..", "..");
const configPath = join(repositoryRoot, "Temp", "UGCLanguage", "fcconfig.json");
const editorGenPath = join(repositoryRoot, "Temp", "UGCLanguage", "editorGen");
const fixtures = JSON.parse(readFileSync(new URL("../grammar/compiler-fixtures.json", import.meta.url), "utf8"));

function marker(value, name) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(name + " must contain only letters, digits, - or _");
  }

  return value;
}

/** Run the configured compiler and retain stderr for fixture diagnostics. */
function runCompiler(executable, cwd, args) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  return { status: result.status, output: (result.stdout ?? "") + (result.stderr ?? "") };
}

/** One scratch project per fixture prevents generated output from leaking across cases. */
function compileFixture(fixture, executable, model, session, tempParent, formatted) {
  const formatResult = formatted ? formatSource(fixture.source, fixture.kind) : null;

  if (formatted && formatResult.output === null) {
    throw new Error("Formatter rejected compiler fixture " + fixture.name + ": " + formatResult.diagnostics[0]?.message);
  }

  const source = formatResult?.output ?? fixture.source;
  const parsed = parseWithOracle(source, fixture.kind);
  const expectedParserAcceptance = fixture.expectParserSuccess ?? true;
  const expectedCompilerAcceptance = fixture.expectCompilerSuccess ?? true;

  const scratch = resolve(mkdtempSync(join(tempParent, "fc-v5-probe-")));

  if (!scratch.startsWith(tempParent + sep)) {
    throw new Error("Temporary project escaped the temp directory");
  }

  try {
    const assets = join(scratch, "Assets");
    mkdirSync(assets, { recursive: true });

    const generatedParent = join(scratch, "Temp", "UGCLanguage");
    mkdirSync(generatedParent, { recursive: true });
    cpSync(editorGenPath, join(generatedParent, "editorGen"), { recursive: true });

    const file = join(assets, "Fixture." + fixture.kind);
    writeFileSync(file, source, "utf8");

    const argumentsWithMarkers = ["-i", "Assets", "-agent", model, "-session", session];
    let result = runCompiler(executable, scratch, argumentsWithMarkers);
    let usedMarkers = true;

    if (result.status !== 0 && /flag provided but not defined: -(agent|session)/.test(result.output)) {
      result = runCompiler(executable, scratch, ["-i", "Assets"]);
      usedMarkers = false;
    }

    const compilerAccepted = result.status === 0;
    const passed = parsed.accepted === expectedParserAcceptance &&
      compilerAccepted === expectedCompilerAcceptance;

    return {
      name: fixture.name,
      formatted,
      status: passed ? "passed" : "failed",
      parserAccepted: parsed.accepted,
      compilerAccepted,
      expectedParserAcceptance,
      expectedCompilerAcceptance,
      exitCode: result.status,
      usedMarkers,
      parserErrors: parsed.errors.slice(0, 2),
      output: result.output.trim().slice(-1000),
    };
  } finally {
    const checked = resolve(scratch);

    if (!checked.startsWith(tempParent + sep)) {
      throw new Error("Refusing recursive cleanup outside temp");
    }

    rmSync(checked, { recursive: true, force: true });
  }
}

try {
  const formatted = process.argv.includes("--formatted");
  const selectedFixtures = formatted
    ? fixtures.filter((fixture) => (fixture.expectParserSuccess ?? true) && (fixture.expectCompilerSuccess ?? true))
    : fixtures;
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const executable = config.CompilerExecutable;

  if (!executable || !existsSync(executable)) {
    throw new Error("Configured compiler unavailable: " + executable);
  }

  if (!existsSync(editorGenPath)) {
    throw new Error("editorGen references unavailable: " + editorGenPath);
  }

  const model = marker(process.env.FC_COMPILE_MODEL ?? "unknown-model", "FC_COMPILE_MODEL");
  const session = marker(process.env.FC_COMPILE_SESSION ?? randomUUID(), "FC_COMPILE_SESSION");
  const tempParent = resolve(realpathSync(tmpdir()));
  let failures = 0;

  for (const fixture of selectedFixtures) {
    const result = compileFixture(fixture, executable, model, session, tempParent, formatted);
    console.log(JSON.stringify(result));

    if (result.status !== "passed") {
      failures += 1;
    }
  }

  console.log((formatted ? "Formatted compiler fixtures: " : "Compiler fixtures: ") +
    (selectedFixtures.length - failures) + "/" + selectedFixtures.length + " passed");

  if (failures) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
