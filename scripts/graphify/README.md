# FC graphify pipeline

Deterministic, zero-LLM-token knowledge-graph rebuild for `Assets/Scripts`,
driven by the `fc-format-v3` AST bridge plus the preserved semantic
(docs/concepts) nodes. One command:

```sh
cd tools/fc-format-v3
npm run graphify
```

## Prerequisites

1. **Node** >= 20.19, then `npm install` in `tools/fc-format-v3`.
2. **Python** with the `graphify` package (PyPI name `graphifyy`):
   ```sh
   pip install graphifyy
   # or: uv tool install graphifyy
   ```
   The pipeline uses `GRAPHIFY_PYTHON` when set, otherwise plain `python`:
   ```sh
   GRAPHIFY_PYTHON=/path/to/python npm run graphify
   ```

## What one run does

1. **AST bridge** (`src/cli/graphify.ts`, in-process): extracts
   `contains` / `calls` / `imports` / `references` edges from all
   `.fcc` / `.fcg` files under `Assets/Scripts` → `.graphify_ast.json`.
2. **Merge** (`scripts/graphify/merge_ast.py`): AST wins on ID conflicts;
   legacy-only semantic nodes (docs, concepts, unparsed-file leftovers)
   are kept; chunk-1-style IDs are remapped when the AST has the match
   → `.graphify_extract.json`.
3. **Rebuild** (`scripts/graphify/rebuild.py`): validate → build →
   cluster → gods → `graph.json`, `graph.html`, `obsidian/`,
   `GRAPH_REPORT.md`, `.graphify_analysis.json`, `manifest.json`.

Options: `npm run graphify -- [--repo <dir>] [--out <dir>] [--scope <dir>]`.

## What is committed vs ignored

Committed (inputs + pipeline): `src/graphify/bridge.ts`,
`src/cli/bridge.ts`, `src/cli/graphify.ts`, `tests/bridge/`,
`scripts/graphify/*.py`, `graphify-out/.graphify_chunk_*.json`
(semantic provenance), `graphify-out/manifest.json`.

Ignored (regenerable products): `graph.json`, `graph.html`,
`obsidian/`, `GRAPH_REPORT.md`, `.graphify_analysis.json`,
`.graphify_ast.json`, `.graphify_extract.json`, stale intermediates.

## Prompt to rerun

> graphify Assets/Scripts with the fc-format-v3 bridge

(in Build mode — Plan mode can only discuss it).
