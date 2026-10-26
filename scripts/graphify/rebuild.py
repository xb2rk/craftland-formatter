"""Full graphify rebuild from high-signal AST extraction.

Reads <out>/.graphify_extract.json, runs regularized community clustering (with hub exclusion),
and exports:
- graph.json & graph.html (interactive network visualization)
- obsidian/ (markdown vault with cross-links)
- GRAPH_REPORT.md (architectural report)
- manifest.json & .graphify_analysis.json
"""
import argparse
import json
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

# Ensure UTF-8 output on Windows
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

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
    out.mkdir(parents=True, exist_ok=True)

    extract_path = out / ".graphify_extract.json"
    if not extract_path.exists():
        sys.exit(f"Error: {extract_path} not found.")

    extraction = json.loads(extract_path.read_text(encoding="utf-8"))

    problems = build.validate_extraction(extraction)
    if problems:
        print(f"validate_extraction: {len(problems)} issues found (showing up to 5)")
        for p in problems[:5]:
            print("  [WARN]", p)

    graph = build.build_from_json(extraction, directed=False, root=str(repo))
    print(f"Graph built: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges")

    diag = diagnostics.diagnose_extraction(extraction, directed=False, root=str(repo))
    print(f"Diagnostics: raw_edges={diag.get('raw_edge_count')}, duplicate_edges={diag.get('exact_duplicate_edges')}")

    # Run Leiden community detection with hub exclusion (95th percentile)
    # This prevents utility hubs from corrupting domain clusters
    communities = cluster.cluster(graph, resolution=1.0, exclude_hubs_percentile=95.0)
    cohesion = cluster.score_all(graph, communities)
    auto_labels = cluster.label_communities_by_hub(graph, communities)

    sizes = sorted(((c, len(v)) for c, v in communities.items()), key=lambda t: -t[1])
    print(f"Communities detected: {len(communities)}; Top cluster sizes: {sizes[:8]}")

    gods = analyze.god_nodes(graph, top_n=12)
    print("Top Hub Nodes:", [g["id"] if isinstance(g, dict) else g for g in gods[:6]])

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
    (out / ".graphify_analysis.json").write_text(json.dumps(analysis, indent=2), encoding="utf-8")

    # Export interactive HTML and JSON
    export.to_json(graph, communities, str(out / "graph.json"), community_labels=auto_labels)
    export.to_html(graph, communities, str(out / "graph.html"), community_labels=auto_labels)
    print(f"Exported interactive HTML: {out / 'graph.html'}")

    # Export Obsidian Markdown Vault
    obs = out / "obsidian"
    if obs.exists():
        shutil.rmtree(obs)
    n_notes = export.to_obsidian(graph, communities, str(obs),
                                 community_labels=auto_labels, cohesion=cohesion)
    print(f"Exported Obsidian vault: {n_notes} notes in {obs}")

    # Generate architectural report
    fc_files = sorted(str(p) for p in (repo / "Assets" / "Scripts").rglob("*")
                      if p.suffix.lower() in (".fcc", ".fcg"))
    docs = [str(p) for p in (repo / "docs").glob("*.md")]
    total_words = 0
    for p in list(fc_files) + docs:
        try:
            total_words += len(Path(p).read_text(encoding="utf-8").split())
        except OSError:
            pass

    detection_result = {
        "files": {},
        "root": str(repo),
        "total_files": len(fc_files) + len(docs),
        "total_words": total_words,
    }
    token_cost = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}

    report_md = report.generate(
        graph, communities, cohesion, auto_labels, gods, surprises, detection_result,
        token_cost, str(repo), suggested_questions=questions, obsidian=True,
    )
    (out / "GRAPH_REPORT.md").write_text(report_md, encoding="utf-8")
    print(f"Generated architectural report: {out / 'GRAPH_REPORT.md'}")

    files = {p: ["code"] for p in fc_files}
    files.update({p: ["document"] for p in docs})
    manifest.save_manifest(files, str(out / "manifest.json"), kind="both", root=repo)
    print("Rebuild pipeline complete!")


if __name__ == "__main__":
    main()
