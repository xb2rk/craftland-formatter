#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "./parse.js";
import { format } from "./format.js";
import { lint } from "./lint.js";

const cmd = process.argv[2] ?? "parse";
const target = process.argv[3] ?? "Assets/Scripts";
const writeFlag = process.argv.includes("--write");

function walk(dir: string, out: string[]): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (e.endsWith(".fcg") || e.endsWith(".fcc")) out.push(p);
  }
  return out;
}

const files = statSync(target).isDirectory() ? walk(target, []) : [target];

if (cmd === "parse") {
  let ok = 0;
  let err = 0;
  const problems: string[] = [];
  for (const f of files) {
    try {
      const src = readFileSync(f, "utf8");
      const model = parse(src);
      ok++;
      if (process.env.DETAIL) {
        console.log(
          `${relative(process.cwd(), f)}: imports=${model.imports.length} graphs=${model.graphs.length} funcs=${model.funcs.length} enums=${model.enums.length}`,
        );
      }
    } catch (e) {
      err++;
      problems.push(`${f}: ${(e as Error).message}`);
    }
  }
  console.log(`parsed: ${ok} ok, ${err} failed, ${files.length} total`);
  for (const p of problems.slice(0, 40)) console.log("ERR " + p);
} else if (cmd === "fmt") {
  let changed = 0;
  let err = 0;
  for (const f of files) {
    try {
      const src = readFileSync(f, "utf8");
      const out = format(src);
      if (out !== src) {
        changed++;
        if (writeFlag) writeFileSync(f, out);
        else console.log(`--- ${relative(process.cwd(), f)} ---\n${out}`);
      }
    } catch (e) {
      err++;
      console.error(`ERR ${f}: ${(e as Error).message}`);
    }
  }
  console.log(`fmt: ${changed} changed, ${err} errors, ${files.length} total`);
} else if (cmd === "lint") {
  let errors = 0;
  let warnings = 0;
  let err = 0;
  for (const f of files) {
    try {
      const src = readFileSync(f, "utf8");
      const diags = lint(src);
      for (const d of diags) {
        const loc = `${relative(process.cwd(), f)}:${d.line}:${d.column}`;
        if (d.severity === "error") {
          errors++;
          console.log(`ERR  ${loc} [${d.ruleId}] ${d.message}`);
        } else {
          warnings++;
          console.log(`WARN ${loc} [${d.ruleId}] ${d.message}`);
        }
      }
    } catch (e) {
      err++;
      console.error(`ERR ${f}: ${(e as Error).message}`);
    }
  }
  console.log(`lint: ${errors} errors, ${warnings} warnings, ${err} file-errors, ${files.length} total`);
} else {
  console.error("unknown command");
  process.exit(1);
}