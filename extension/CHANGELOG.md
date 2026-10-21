# Changelog

## 0.3.0

- Adds scope-aware P7B lint diagnostics for unused bindings, duplicate declarations/import aliases, self-assignment, unreachable statements, and empty blocks.
- Adds conservative P7C CFG/data-flow diagnostics for constant conditions and dead stores, including nested-loop reachability and unknown-call/`wait`/`start` barriers.
- Adds P7D workspace diagnostics for unresolved project imports, missing named project declarations, explicit server/client import isolation, and unused imports. P7D.3 resolves unique unqualified names through complete project declaration surfaces. The index overlays unsaved buffers and keeps incremental results equivalent to a rebuilt snapshot; generated/bare libraries remain opaque and import cycles remain non-diagnostic metadata.
- Adds debounced live diagnostics, a manual **FC Format: Lint Document** command, and validated lint severity settings.

## 0.2.0

- First FC Format v3 extension release.
- Adds compiler-safe document and range formatting for `.fcg` and `.fcc` files.
- Adds validated, user-configurable layout settings backed by the v3 formatter core.
