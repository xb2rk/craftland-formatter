# Fresh FC compiler and grammar evidence — 2026-10-26

This report records a fresh check of the FC grammar and the configured
`fccompile_external.exe`. The existing formatter package already contains the
grammar oracle and compiler probe; this adds current evidence without changing
game scripts or replacing the historical Phase 1 report.

## Results

- Full project compile: `fccompile_external.exe -i Assets` returned exit code 0
  and emitted no compiler output.
- External compiler fixture matrix: **34/34 expected outcomes**, with **25
  accepted** and **9 rejected** by both the pinned parser and compiler.
- Grammar corpus: **301/301 files accepted**. The corpus reached **119/124
  parser rules**; the four rare-rule fixtures brought observed rule coverage to
  **124/124**. This is rule-entry coverage, not all grammar alternative or
  branch coverage.
- Pinned parser: Craftland Studio VS Code extension `1.11.0`,
  `dist/server_syntax.js`, SHA-256
  `fbfe4b87158096a84a9978cb54552b8fe33e24e561807ebee5f2f085463f9367`.

## What the external compiler work does

`fccompile_external.exe` is the syntax/build acceptance authority for these
checks. The full compile validates the project's `Assets` directory. The
fixture probe in `scripts/probe-compiler.mjs` creates a disposable project for
each case, copies the current `editorGen` references, writes one fixture, runs
the configured compiler, records its exit code, and removes the scratch
project. It does not change game source files.

The compiler supplies accept/reject evidence; it does not expose a browsable
grammar corpus. The grammar probe uses the generated parser shipped inside the
pinned VS Code extension. The installed extension contains 47 library `.fcc`
samples, but no `.g4` grammar source files were found in that extension.

## Corpus used

| Source | FC files |
| --- | ---: |
| Project `Assets` | 250 |
| `Temp/UGCLanguage/editorGen` | 4 |
| Extension `library/release` | 47 |
| **Total** | **301** |

All 301 files parsed with no rejection. The four checked-in rare-rule fixtures
also parsed, and the combined set reached every one of the pinned parser's 124
rule indices.

## Reproduce

Run the full project compile from the repository root:

```powershell
& 'C:\Users\hoangtuan.ngo_ctv\AppData\Local\Programs\Craftland Studio\resources\LocalData\Utilities\UGCLanguage\release\fccompile_external.exe' -i Assets
```

Run the corpus grammar probe from `tools/fc-format`:

```powershell
node scripts/probe-grammar.mjs --json `
  --corpus ..\..\Assets `
  --corpus ..\..\Temp\UGCLanguage\editorGen `
  --corpus 'C:\Users\hoangtuan.ngo_ctv\.vscode\extensions\craftlandstudio.ffugclanguage-1.11.0\library\release'
```

Run the isolated external compiler matrix from `tools/fc-format`:

```powershell
$env:FC_COMPILE_MODEL = 'unknown-model'
$env:FC_COMPILE_SESSION = '01a176d1-2833-7b32-929d-289a110146e3'
node scripts/probe-compiler.mjs
```

The compiler executable configured by `Temp/UGCLanguage/fcconfig.json` was
`C:\Users\hoangtuan.ngo_ctv\AppData\Local\Programs\Craftland Studio\resources\LocalData\Utilities\UGCLanguage\release\fccompile_external.exe`.
The `N0BODY` path supplied for this task was not present in this environment;
the configured executable above was used for the fresh runs.
