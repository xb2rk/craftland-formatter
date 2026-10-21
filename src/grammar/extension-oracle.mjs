/**
 * Development-only oracle for the pinned Craftland Studio 1.11.0 syntax bundle.
 *
 * The bundle's normal entry starts a language server. This module replaces only
 * that entry in memory and exposes its generated ANTLR classes for tests. The
 * bundle is never copied into v5 or imported by the formatter runtime.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import Module from "node:module";
import { dirname, join, resolve } from "node:path";

const baseline = JSON.parse(readFileSync(new URL("../../grammar/baseline.json", import.meta.url), "utf8"));
const cache = new Map();

/** Find the exact pinned bundle, with an explicit path taking precedence. */
export function locateSyntaxBundle(explicitPath) {
  const selected = explicitPath ?? process.env.FC_GRAMMAR_BUNDLE;

  if (selected) {
    const path = resolve(selected);

    if (!existsSync(path)) {
      throw new Error("Craftland syntax bundle not found: " + path);
    }

    return path;
  }

  const home = process.env.USERPROFILE ?? process.env.HOME;

  if (!home) {
    throw new Error("Set FC_GRAMMAR_BUNDLE or pass --bundle PATH.");
  }

  for (const editor of [".vscode", ".vscode-insiders"]) {
    const path = join(
      home,
      editor,
      "extensions",
      baseline.extension + "-" + baseline.version,
      baseline.artifact,
    );

    if (existsSync(path)) {
      return path;
    }
  }

  throw new Error(
    "Craftland extension " + baseline.version +
    " is not installed. Set FC_GRAMMAR_BUNDLE or pass --bundle PATH.",
  );
}

/**
 * Loads the generated lexer/parser classes after checking provenance.
 *
 * NOTE: Webpack module IDs and entry shape are private to this pinned hash.
 * A changed bundle must fail here; review the new grammar before updating the
 * baseline instead of guessing at a compatible internal shape.
 */
export function loadExtensionOracle(explicitPath) {
  const path = locateSyntaxBundle(explicitPath);
  const cached = cache.get(path);

  if (cached) {
    return cached;
  }

  let source = readFileSync(path, "utf8");
  const sha256 = createHash("sha256").update(source).digest("hex");
  if (sha256 !== baseline.sha256) {
    throw new Error(
      "Craftland grammar hash mismatch for " + path +
      ": expected " + baseline.sha256 + ", got " + sha256,
    );
  }

  const names = ["FCGLexer", "FCGParser", "ANTLRInputStream", "CommonTokenStream"];
  const exports = names.map((name) => {
    const id = findModuleId(source, name);
    return name + ": __webpack_require__(" + id + ")." + name;
  });

  const entryPattern = /__webpack_require__\(8762\);[\s\S]*?module\.exports = __webpack_exports__;/;

  if (!entryPattern.test(source)) {
    throw new Error("Pinned Craftland bundle entry shape is not recognized.");
  }

  source = source.replace(entryPattern, "module.exports = { " + exports.join(", ") + " };");

  const isolated = new Module(path);
  isolated.filename = path;
  isolated.paths = Module._nodeModulePaths(dirname(path));
  isolated._compile(source, path);

  const classes = isolated.exports;

  for (const name of names) {
    if (typeof classes[name] !== "function") {
      throw new Error("Bundle export missing: " + name);
    }
  }

  if (classes.FCGParser.ruleNames.length !== baseline.parserRuleCount) {
    throw new Error("Parser rule count differs from pinned baseline.");
  }

  const oracle = { baseline, path, sha256, ...classes };
  cache.set(path, oracle);

  return oracle;
}

/** A lexical result including hidden-channel tokens and exact source slices. */
export function lexWithOracle(source, explicitPath) {
  const oracle = loadExtensionOracle(explicitPath);
  const lexer = new oracle.FCGLexer(new oracle.ANTLRInputStream(source));
  const errors = [];
  lexer.removeErrorListeners();
  lexer.addErrorListener(errorListener("lexer", errors));

  const tokens = [];

  for (;;) {
    const token = lexer.nextToken();

    tokens.push({
      type: token.type,
      name: oracle.FCGLexer._SYMBOLIC_NAMES[token.type] ?? null,
      text: token.text ?? "",
      channel: token.channel,
      start: token.startIndex,
      end: token.stopIndex + 1,
    });

    if (token.type === -1) {
      break;
    }
  }

  return { errors, tokens };
}

/**
 * Parses one complete FC file and returns diagnostics plus exercised rule IDs.
 * Parser recovery is useful for diagnostics, but any recovery makes acceptance
 * false; a formatter must not print an incomplete parse.
 */
export function parseWithOracle(source, kind, explicitPath) {
  if (kind !== "fcg" && kind !== "fcc") {
    throw new TypeError("kind must be fcg or fcc");
  }

  const oracle = loadExtensionOracle(explicitPath);
  const errors = [];
  const lexer = new oracle.FCGLexer(new oracle.ANTLRInputStream(source));

  lexer.removeErrorListeners();
  lexer.addErrorListener(errorListener("lexer", errors));

  const tokens = new oracle.CommonTokenStream(lexer);
  const parser = new oracle.FCGParser(tokens);

  parser.removeErrorListeners();
  parser.addErrorListener(errorListener("parser", errors));

  const tree = parser.sourceFile();
  const expectedEntryIndex = oracle.FCGParser.ruleNames.indexOf(oracle.baseline.entries[kind]);
  const observedEntryIndex = tree.children?.find((child) => Number.isInteger(child.ruleIndex))?.ruleIndex;

  if (observedEntryIndex !== expectedEntryIndex) {
    errors.push({ phase: "file-kind", line: 1, column: 0, message: "Expected " + kind + " grammar entry" });
  }

  tokens.fill();

  const reachedEof = parser.currentToken?.type === -1;

  return {
    accepted: errors.length === 0 && reachedEof,
    errors,
    reachedEof,
    observedEntryIndex,
    ruleIndices: collectRuleIndices(tree),
    tokenTypes: [...new Set(tokens.tokens.map((token) => token.type))].sort((left, right) => left - right),
  };
}

/** Walk the oracle parse tree to measure rule entry, not grammar alternatives. */
function collectRuleIndices(tree) {
  const rules = new Set();
  const pending = [tree];

  while (pending.length > 0) {
    const node = pending.pop();

    if (Number.isInteger(node.ruleIndex)) {
      rules.add(node.ruleIndex);
    }

    for (const child of node.children ?? []) {
      pending.push(child);
    }
  }

  return [...rules].sort((left, right) => left - right);
}

export function grammarMetadata(explicitPath) {
  const oracle = loadExtensionOracle(explicitPath);
  return {
    baseline: oracle.baseline,
    path: oracle.path,
    sha256: oracle.sha256,
    ruleNames: [...oracle.FCGParser.ruleNames],
    symbolicNames: [...oracle.FCGLexer._SYMBOLIC_NAMES],
  };
}

function errorListener(phase, errors) {
  return {
    syntaxError(_recognizer, _symbol, line, column, message) {
      errors.push({ phase, line, column, message });
    },
  };
}

/** Locate a named export inside one webpack module, without executing the entry. */
function findModuleId(bundle, name) {
  const headers = [...bundle.matchAll(/\/\*\*\*\/\s+(\d+):/g)];
  const target = "exports." + name + " =";

  for (let index = 0; index < headers.length; index += 1) {
    const start = headers[index].index;
    const end = headers[index + 1]?.index ?? bundle.length;

    if (bundle.slice(start, end).includes(target)) {
      return headers[index][1];
    }
  }

  throw new Error("Pinned Craftland bundle has no module exporting " + name);
}
