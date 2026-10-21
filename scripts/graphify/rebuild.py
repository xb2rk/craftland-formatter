"""Full graphify rebuild from merged AST+semantic extraction.

Reads <out>/.graphify_extract.json, regenerates graph.json, graph.html,
obsidian/, GRAPH_REPORT.md, .graphify_analysis.json, manifest.json.
Deterministic; zero LLM tokens. Requires the `graphify` package
(`pip install graphifyy`) in the running interpreter.
"""
import argparse
import json
import shutil
import subprocess
from collections import Counter
from pathlib import Path

from graphify import analyze, build, cluster, diagnostics, export, manifest, report


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
    repo = Path(args.repo)
    out = Path(args.out) if args.out else repo / "graphify-out"

    extraction = json.loads((out / ".graphify_extract.json").read_text(encoding="utf-8"))

    problems = build.validate_extraction(extraction)
    print(f"validate_extraction: {len(problems)} problems")
    for p in problems[:10]:
        print("  ", p)

    graph = build.build_from_json(extraction, directed=False, root=str(repo))
    print(f"graph: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges")

    diag = diagnostics.diagnose_extraction(extraction, directed=False, root=str(repo))
    for key in ("node_count", "raw_edge_count", "missing_endpoint_edges",
                "dangling_endpoint_edges", "self_loop_edges", "exact_duplicate_edges",
                "post_build_node_count", "post_build_edge_count", "post_build_error"):
        print(f"diagnose.{key}: {diag.get(key)}")

    communities = cluster.cluster(graph)
    cohesion = cluster.score_all(graph, communities)
    auto_labels = cluster.label_communities_by_hub(graph, communities)
    sizes = sorted(((c, len(v)) for c, v in communities.items()), key=lambda t: -t[1])
    print(f"communities: {len(communities)}; top sizes: {sizes[:12]}")
    singletons = sum(1 for _, n in sizes if n == 1)
    print(f"singletons: {singletons}")

    gods = analyze.god_nodes(graph, top_n=15)
    print("top gods:", [(g["id"] if isinstance(g, dict) else g,) for g in gods[:8]])
    surprises = analyze.surprising_connections(graph, communities)
    questions = analyze.suggest_questions(graph, communities, auto_labels)

    analysis = {
        "communities": {str(k): v for k, v in communities.items()},
        "cohesion": {str(k): v for k, v in cohesion.items()},
        "labels": {str(k): v for k, v in auto_labels.items()},
        "gods": gods,
        "surprises": surprises,
        "questions": questions,
    }
    (out / ".graphify_analysis.json").write_text(json.dumps(analysis), encoding="utf-8")

    export.to_json(graph, communities, str(out / "graph.json"), community_labels=auto_labels)
    export.to_html(graph, communities, str(out / "graph.html"), community_labels=auto_labels, node_limit=5000)

    obs = out / "obsidian"
    if obs.exists():
        shutil.rmtree(obs)
    n_notes = export.to_obsidian(graph, communities, str(obs),
                                 community_labels=auto_labels, cohesion=cohesion)
    print(f"obsidian notes: {n_notes}")

    conf = Counter(e.get("confidence") for e in extraction["edges"])
    print("edge confidence:", dict(conf))

    fc_files = sorted(str(p) for p in (repo / "Assets" / "Scripts").rglob("*")
                      if p.suffix.lower() in (".fcc", ".fcg"))
    docs = [str(repo / "docs" / name) for name in ("ARCHITECTURE.md", "CODING_CONVENTION.md")]
    total_words = 0
    for p in list(fc_files) + docs:
        try:
            total_words += len(Path(p).read_text(encoding="utf-8").split())
        except OSError:
            pass
    detection_result = {"files": {}, "root": str(repo),
                        "total_files": len(fc_files) + len(docs),
                        "total_words": total_words}
    token_cost = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
    report_md = report.generate(
        graph, communities, cohesion, auto_labels, gods, surprises, detection_result,
        token_cost, str(repo), suggested_questions=questions, obsidian=True,
    )
    (out / "GRAPH_REPORT.md").write_text(report_md, encoding="utf-8")

    files = {"code": fc_files, "document": docs}
    manifest.save_manifest(files, str(out / "manifest.json"), kind="both", root=repo)
    print(f"manifest rows: {sum(len(v) for v in files.values())}; report words: {total_words}; fc files: {len(fc_files)}")
    print("DONE")


if __name__ == "__main__":
    main()
