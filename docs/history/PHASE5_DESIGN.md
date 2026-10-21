# Phase 5: VS Code adapter design

## Review before implementation

The v2 extension provides the precedent: it registers a document formatter for
Craftland's `ffugclanguage` and uses VS Code's format-on-save mechanism. It also
registered range formatting that rewrote an entire file. V5 will not register
range formatting until a range edit can be shown to preserve the enclosing FC
syntax and protected bytes.

Two viable adapters are a CLI child process and a direct core call. A direct
call is chosen: it handles unsaved buffers, shares one config resolver and
printer with the CLI, avoids process startup on every save, and returns
structured diagnostics. `src/service.mjs` owns this shared boundary. The CLI
owns disk I/O and safe replacement; the extension owns VS Code UI and text
edits. Neither adapter owns FC grammar or an alternate style configuration.

The extension registers a full-document formatting provider, diagnostics,
and read-only preview and config-explanation commands. Standard VS Code
`editor.formatOnSave` invokes the provider after the user selects v5 as their
default formatter. Installation and settings remain explicit user actions.
The provider returns a minimal replacement edit so unchanged text before
and after the changed span retains its editor position. VS Code owns cursor
mapping within the changed span; no editor selection is changed directly.
The editor's single EOL mode is a separate boundary: the provider cannot
change that mode through a formatting edit. It refuses a mismatch with a
diagnostic, while the explicit manual command applies the EOL change and
replacement together through a TextEditorEdit. Mixed or CR-only output is
left to the CLI because the editor cannot preserve those bytes.

The extension package copies an explicit runtime module list from v5 at build
time. The pinned Craftland oracle, corpus, compiler fixture, and development
tests do not ship in it. The extension has no runtime dependency on the
Craftland syntax bundle or compiler.

## Implementation

The CLI and extension call formatConfiguredSource() in src/service.mjs.
The extension runs on the current unsaved document buffer and resolves the
same on-disk project configuration as the CLI. It registers the Craftland
language and .fcg/.fcc path patterns, so it does not require a separate
language grammar. Its manual format command changes only the editor buffer;
the preview command opens a virtual read-only diff. Explain Configuration
opens the resolver result as a virtual read-only JSON document.

Invalid syntax or configuration produces diagnostics and no formatting edit.
Open documents are rechecked after buffer changes and when a project config,
ignore file, or EditorConfig file changes. A project-ignored file receives
neither a formatting edit nor diagnostics. The adapter does not expose a
range formatter and does not silently change VS Code's default formatter
or format-on-save settings.

The build script copies nine explicit ESM core files plus the CommonJS
adapter to extension/dist. Tests load this copied runtime from a fresh
temporary directory. No oracle, compiler, corpus, CLI, or test file enters
the copied runtime.

## Verification and remaining limit

The integration tests compare the editor provider with the CLI on identical
unsaved text and the same per-file EditorConfig and .fcfmt.json rules.
They check config provenance, preview/explanation content, manual formatting,
malformed source/config diagnostics, ignored files, and minimal edits around
UTF-16 surrogate pairs and CRLF. The curated extension runtime build
completed. The full local suite passed 86 tests; one Windows symlink test
was skipped because this account could not create symlinks.

An isolated VS Code 1.140 Extension Host test activated the built extension,
checked the full-document provider on unsaved text against the shared core,
verified that an EOL mismatch suppresses the provider edit, exercised the
manual command's EOL conversion, checked that a cursor before the changed
span stays in place, and confirmed real format-on-save wrote the expected
bytes. The test runs with a temporary user profile, extension
directory and FC file, then removes them after the host exits.

@vscode/vsce was unavailable locally, so VSIX packaging and an installed
extension session remain unverified. The host test used development-extension
mode rather than installing a VSIX.

Later Phase 6 work added a local PowerShell VSIX packager and verified the
installed package in an isolated profile. See [the rollout review](PHASE6_ROLLOUT.md)
for the current release evidence; the paragraph above records the Phase 5
gate at the time it was completed.
