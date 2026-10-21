# Phase 6: project rollout review

## Current release: 0.9.0

The 0.9.0 source-boundary review fixes three reported contracts: the telemetry
section in FeatureFlags retains its blank boundary, long pooling log arguments
break at `+` while fitting nested calls stay together, and parameter break
positions are preserved by default. See
[continuation design](CONTINUATION_DESIGN.md) for ownership and alternatives.

The current read-only audit scanned **236** files under Assets/Scripts and found
**91** content changes, no EOL-only changes, no ignored files and no diagnostics.
These are measurements of this working-tree snapshot, not a cross-version
byte-compatibility promise. A disposable project formatted those 236 source
copies, checked their idempotence and passed the configured FC compiler with
**exit 0** and model/session markers. Scratch source and generated references
were removed; production source was only read.

| Area | Files scanned | Files that would change |
| --- | ---: | ---: |
| Systems | 96 | 30 |
| UI | 36 | 22 |
| Data | 30 | 9 |
| Storage | 20 | 12 |
| Other areas | 54 | 18 |
| **Total** | **236** | **91** |

The scoped Node suite covers **203** cases. All **202** executable cases passed
across the full run and a focused rerun; one Windows symlink-permission case was
skipped. The initial failure was an expected import gap in a new cap-0 test:
the cap also removes the import gap. The expected bytes were corrected and that
test plus the changed compiler-fixture inventory test were rerun successfully.
Corpus oracle acceptance/idempotence and unsaved CLI/editor parity passed.

Four added compiler positives cover func/nested function types, event/function
type declarations, logging concatenations and comment sections. FCC does not
support user function APIs, so declaration coverage uses a graph for funcs and
a library for events. The logging fixture declares its local ToString helper.
All **25/25** formatted compiler-positive fixtures passed with model/session
markers. The installed 0.9.0 VSIX passed the isolated Extension Host gate,
including named preserve/concatenation/comment-section output, CLI/core parity,
CRLF, cursor preservation, manual formatting, real format-on-save and invalid
input edit suppression. The built runtime remains the explicit 19-file boundary.
The artifact is **53,017 bytes**.

## Previous release: 0.8.0

The read-only audit formats FC source in memory through the shared CLI/editor
service. On the working-tree snapshot measured for 0.8.0, it scanned **236**
files under Assets/Scripts, found **111** that would change, no EOL-only changes,
and no diagnostics. File counts have changed since earlier phase measurements;
this is the historical 0.8.0 audit inventory. Formatter development wrote only tooling
and disposable source copies.

| Area | Files scanned | Files that would change |
| --- | ---: | ---: |
| Systems | 96 | 44 |
| UI | 36 | 21 |
| Data | 30 | 10 |
| Storage | 20 | 12 |
| Other areas | 54 | 24 |
| **Total** | **236** | **111** |

The operator review fixed spaced postfix updates, unary operands after compound
assignments/comparisons, repeated unary token merging, and missing spacing
before parenthesized operands. Split operators and missing operands are now
parser diagnostics before formatting. Component access after globalEntity,
index and call targets is recognized as a type-argument group.

The layout review restores broken map/struct separator alignment and logical
continuation indentation. Grouping parentheses are distinct from calls;
logical chains in value expressions follow `wrap.conditions`. The three
reported source cases were checked through the configured service in memory:
Client_SeedGrowVFXEntity's rarity map, CollectionRewardData's invalid-row
condition and Server_WalletManager's legitimate-coin assignment. Each now has
the expected layout. Source counts are snapshot measurements, not a cross-
version byte-compatibility promise.

The P0/P1 review adds syntactic type/signature and constructor checks,
decorator argument/placement validation, optional import organization,
operator/bracket controls and source ignore pragmas. Commented collections
reflow attached rows. Function types, cast calls and anonymous function bodies
have explicit roles; raw import paths retain their spelling. Import sorting
defaults to false, and assignment spacing defaults to inheriting operator
spacing. See [parity design](PARITY_DESIGN.md) for ownership and alternatives.

## Verification for 0.8.0

- Portable scoped Node suite: **188 passed, zero failed, one skipped** out of
  189 tests. The Windows symlink case is skipped because this account cannot
  create symlinks. Includes corpus oracle acceptance and idempotence.
- **21/21** formatted compiler-positive fixtures passed with model/session markers.
  New fixtures include continued function types, commented maps with source
  ignores, anonymous function statements and raw imports; prior operator,
  logical, call, collection, control-flow and declaration fixtures still pass.
- A disposable project copied Assets/Scripts and editor-generated references,
  inherited the root formatting configuration within an isolated repository
  boundary, formatted all 236 copied source files with 0.8.0 and passed the configured FC compiler
  with **exit 0** and model/session markers. Cleanup removed the scratch project.
- The 0.8.0 VSIX passed the installed Extension Host test in a temporary profile.
  The host exercises shared-core output, named operator/logical layouts,
  map alignment, sorted imports, commented collections, function pointers,
  source ignores, EOL handling, cursor preservation, manual formatting,
  real format-on-save and malformed operator/list/type edit suppression.
- The build test checks the copied runtime, schema, config/style/troubleshooting
  docs, changelog and schema contribution. README links were checked locally.
- Historical 0.6.0 five-run warm local medians: **257.51 ms** for Utils/BigNumber.fcg
  (88,551 input bytes) and **11.80 ms** for Contracts/CustomEvent.fcc
  (45,207 input bytes). These machine-local baselines were not remeasured for 0.8.0.

The compiler executable used was
`C:\Users\hoangtuan.ngo_ctv\AppData\Local\Programs\Craftland Studio\resources\LocalData\Utilities\UGCLanguage\release\fccompile_external.exe`.
Whole-project arguments included `-i Assets -agent GPT-6 -session <session-id>`;
the compiler accepted these flags.

See [test coverage and v4 migration](TEST_COVERAGE.md) for the reviewed legacy
expectations and what each gate establishes. The independent parser checks
structure, types/signatures, constructor shapes and operator operands;
some declaration alternatives remain
structural. FC compilation is still the semantic validation step. No in-game
runtime was exercised. Range formatting, arbitrary token-pair style switches
and alignment of standalone assignments remain outside the published API.

## Review and adoption

From the project root:

~~~sh
node tools/fc-format-v5/scripts/audit-rollout.mjs
node tools/fc-format-v5/scripts/fcfmt.mjs --check --diff Assets/Scripts/Core/FeatureFlags.fcg
node tools/fc-format-v5/scripts/fcfmt.mjs --check Assets/Scripts
~~~

Check exits 1 when files need formatting. Review representative diffs and agree
on project style, then apply a repository-wide write on an isolated branch and
compile that branch. Enable team CI/format-on-save after accepting that source
diff. Formatter development has not applied that write to game source.

The local release artifact is
`extension/fc-format-v5-vscode-0.9.0.vsix`.
Install through Extensions → ⋯ → Install from VSIX, then select FC Format v5
as the default formatter for an FC file. The [README](../README.md) and
[extension guide](../extension/README.md) describe configuration and migration.

From the formatter package root, rebuild and validate with:

~~~sh
node scripts/test.mjs
node scripts/build-extension.mjs
pwsh -NoProfile -File scripts/package-vsix.ps1
node scripts/test-extension-host.mjs --vsix
~~~

The local packager refuses to replace an existing versioned VSIX. Source changes
require a new version and rebuilt artifact. The host test uses isolated profile
and extension directories; it does not configure the normal user profile.
