#!/usr/bin/env node
/**
 * Report syntax acceptance and grammar-rule coverage against the pinned
 * extension parser. This development probe never formats or writes FC files.
 */
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { grammarMetadata, parseWithOracle } from "../src/grammar/extension-oracle.mjs";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultCorpus = join(resolve(packageRoot, "..", ".."), "Assets", "Scripts");

/** Parse the probe's explicit inputs without accepting ambiguous flags. */
function readArguments(args) {
  const options = { bundle: undefined, corpora: [], json: false };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--bundle" || argument === "--corpus") {
      const value = args[++index];

      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for " + argument);
      }

      if (argument === "--bundle") {
        options.bundle = resolve(value);
      } else {
        options.corpora.push(resolve(value));
      }
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new Error("Unknown argument: " + argument);
    }
  }

  if (options.corpora.length === 0) {
    options.corpora.push(defaultCorpus);
  }

  return options;
}

/** Recursively enumerate only FC text sources in a deterministic order. */
function collectFcFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFcFiles(path));
    } else if (entry.isFile() && [".fcg", ".fcc"].includes(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }

  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function run() {
  const options = readArguments(process.argv.slice(2));
  const metadata = grammarMetadata(options.bundle);
  const families = JSON.parse(readFileSync(new URL("../grammar/rule-families.json", import.meta.url), "utf8"));
  const rareFixtures = JSON.parse(readFileSync(new URL("../grammar/rare-fixtures.json", import.meta.url), "utf8"));

  for (let index = 0; index < metadata.ruleNames.length; index += 1) {
    const matches = families.filter((family) => family.first <= index && index <= family.last);

    if (matches.length !== 1) {
      throw new Error("Rule " + index + " must have exactly one family");
    }
  }

  const covered = new Set();
  const failures = [];
  let fileCount = 0;
  const seen = new Set();

  for (const root of options.corpora) {
    for (const path of collectFcFiles(root)) {
      if (seen.has(path)) {
        continue;
      }

      seen.add(path);
      fileCount += 1;

      const source = readFileSync(path, "utf8");
      const kind = extname(path).slice(1).toLowerCase();
      const result = parseWithOracle(source, kind, options.bundle);

      if (!result.accepted) {
        failures.push({
          file: join(relative(process.cwd(), root), relative(root, path)).replaceAll("\\", "/"),
          errors: result.errors.slice(0, 5),
          reachedEof: result.reachedEof,
          observedEntryIndex: result.observedEntryIndex,
        });
      }

      for (const index of result.ruleIndices) {
        covered.add(index);
      }
    }
  }

  const corpusRulesCovered = covered.size;
  const fixtureFailures = [];
  for (const fixture of rareFixtures) {
    const result = parseWithOracle(fixture.source, fixture.kind, options.bundle);
    const missing = fixture.expectedRuleIndices.filter((index) => !result.ruleIndices.includes(index));

    if (!result.accepted || missing.length) {
      fixtureFailures.push({ name: fixture.name, errors: result.errors, missing });
    }

    for (const index of result.ruleIndices) {
      covered.add(index);
    }
  }

  const familyCoverage = families.map((family) => {
    const missing = [];
    let used = 0;

    for (let index = family.first; index <= family.last; index += 1) {
      if (covered.has(index)) {
        used += 1;
      } else {
        missing.push({ index, name: metadata.ruleNames[index] });
      }
    }

    return { family: family.family, used, total: family.last - family.first + 1, missing };
  });

  const report = {
    extension: metadata.baseline.extension + "-" + metadata.baseline.version,
    sha256: metadata.sha256,
    corpora: options.corpora,
    files: fileCount,
    accepted: fileCount - failures.length,
    rejected: failures.length,
    corpusRulesCovered,
    fixtures: rareFixtures.length,
    fixturesAccepted: rareFixtures.length - fixtureFailures.length,
    fixtureFailures,
    rulesCovered: covered.size,
    ruleCount: metadata.ruleNames.length,
    familyCoverage,
    failures,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    console.log(report.extension + " " + report.sha256);
    console.log("Corpus: " + report.accepted + "/" + report.files + " accepted");
    console.log("Rules: " + report.corpusRulesCovered + "/" + report.ruleCount + " corpus, " + report.rulesCovered + "/" + report.ruleCount + " with fixtures");
    console.log("Rare fixtures: " + report.fixturesAccepted + "/" + report.fixtures + " accepted");
    for (const family of familyCoverage) {
      const missing = family.missing.map((item) => item.index + ":" + item.name).join(", ");
      console.log("  " + family.family + ": " + family.used + "/" + family.total + (missing ? " | missing " + missing : ""));
    }
    for (const failure of failures.slice(0, 20)) {
      console.log("  FAIL " + failure.file + " " + JSON.stringify(failure.errors));
    }

    if (failures.length > 20) {
      console.log("  ... " + (failures.length - 20) + " more failures");
    }

    for (const failure of fixtureFailures) {
      console.log("  FIXTURE FAIL " + failure.name + " " + JSON.stringify(failure));
    }
  }

  if (failures.length || fixtureFailures.length) {
    process.exitCode = 1;
  }
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
