"""Merge fresh AST extraction with legacy semantic (docs/concepts) nodes.

Rules:
- Legacy code IDs in chunk-1 style (scripts_*) are remapped to
  assets_scripts_* when the remapped ID exists in the AST node set.
- Nodes: AST wins on ID conflict; legacy-only nodes are kept.
- Edges: dedupe by (source, target, relation), AST edges first.
- Hyperedges: endpoint IDs remapped with the same rule, all kept.
"""
import argparse
import json
import subprocess
from pathlib import Path


def default_repo() -> Path:
    try:
        top = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        if top:
            return Path(top)
    except (OSError, subprocess.CalledProcessError):
        pass
    return Path.cwd()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=str(default_repo()),
                        help="Repository root (default: git toplevel or cwd).")
    parser.add_argument("--out", default=None,
                        help="Output dir (default: <repo>/graphify-out).")
    args = parser.parse_args()
    out = Path(args.out) if args.out else Path(args.repo) / "graphify-out"

    def load(name: str):
        return json.loads((out / name).read_text(encoding="utf-8"))

    def load_optional(name: str):
        path = out / name
        if not path.exists():
            print(f"note: {name} not found, skipping (AST-only merge)")
            return {"nodes": [], "edges": [], "hyperedges": []}
        return load(name)

    ast = load(".graphify_ast.json")
    c1 = load_optional(".graphify_chunk_01.json")
    c2 = load_optional(".graphify_chunk_02.json")

    ast_ids = {n["id"] for n in ast["nodes"]}

    def remap(node_id: str) -> str:
        if node_id in ast_ids:
            return node_id
        if node_id.startswith("scripts_"):
            cand = "assets_" + node_id
            if cand in ast_ids:
                return cand
        return node_id

    legacy_nodes = c1["nodes"] + c2["nodes"]
    legacy_edges = c1["edges"] + c2["edges"]
    legacy_hyper = c1.get("hyperedges", []) + c2.get("hyperedges", [])

    nodes = list(ast["nodes"])
    seen = set(ast_ids)
    kept_legacy, dropped = 0, 0
    for n in legacy_nodes:
        nid = remap(n["id"])
        if nid in seen:
            dropped += 1
            continue
        n = dict(n)
        n["id"] = nid
        nodes.append(n)
        seen.add(nid)
        kept_legacy += 1

    edges = list(ast["edges"])
    eseen = {(e["source"], e["target"], e.get("relation")) for e in edges}
    kept_e = 0
    for e in legacy_edges:
        e = dict(e)
        e["source"], e["target"] = remap(e["source"]), remap(e["target"])
        key = (e["source"], e["target"], e.get("relation"))
        if key in eseen:
            continue
        eseen.add(key)
        edges.append(e)
        kept_e += 1

    hyper = []
    for h in legacy_hyper:
        h = dict(h)
        h["nodes"] = [remap(n) for n in h["nodes"]]
        hyper.append(h)

    extraction = {
        "nodes": nodes,
        "edges": edges,
        "hyperedges": hyper,
        "input_tokens": 0,
        "output_tokens": 0,
    }
    (out / ".graphify_extract.json").write_text(json.dumps(extraction), encoding="utf-8")
    print(f"AST: {len(ast['nodes'])} nodes / {len(ast['edges'])} edges")
    print(f"legacy kept: {kept_legacy} nodes / {kept_e} edges, dropped dups: {dropped}")
    print(f"TOTAL: {len(nodes)} nodes / {len(edges)} edges / {len(hyper)} hyperedges")


if __name__ == "__main__":
    main()
