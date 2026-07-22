"""Exit-code behavior for the architecture diagram pack gate."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GATE = REPO_ROOT / "scripts" / "check-architecture-diagrams.py"

STEMS = ("context", "containers", "task-lifecycle")

HONEST_MMD = (
    "flowchart TB\n"
    "  sync[Sync — delta engine current;\n"
    "  Graph change-notifications deferred (P11)]\n"
    "  host[Production web on Vercel at https://mc.plxcustomer.io]\n"
)


def _run_gate(repo_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GATE), "--repo-root", str(repo_root)],
        capture_output=True,
        text=True,
    )


def _minimal_source(*, commit: str = "abc123") -> dict:
    claim = {
        "fact_id": "node-a",
        "canonical_claim": "Node A",
        "canonical_summary": "Summary.",
        "sources": [
            {
                "path": "AGENTS.md",
                "start_line": 1,
                "end_line": 2,
                "authority_class": "canonical_architecture",
                "source_commit": commit,
            }
        ],
    }
    node = {
        "mermaid_id": "a",
        "display_label": "A",
        "claims": [claim],
    }
    edge = {
        "mermaid_id": "a__b",
        "display_label": "calls",
        "from": "a",
        "to": "b",
        "claims": [{**claim, "fact_id": "edge-a-b", "canonical_claim": "A calls B"}],
    }
    node_b = {
        **node,
        "mermaid_id": "b",
        "display_label": "B",
        "claims": [{**claim, "fact_id": "node-b"}],
    }
    view = {
        "nodes": [node, node_b],
        "edges": [edge],
        "boundaries": {"missionControlBoundary": ["a", "b"]},
    }
    return {
        "schema_version": "plx-architecture-source-map/v3",
        "notice": "Generated guide — not official.",
        "source_commit": commit,
        "views": {stem: view for stem in STEMS},
    }


def _write_clean_pack(repo: Path, *, commit: str = "abc123") -> None:
    arch = repo / "docs" / "architecture"
    arch.mkdir(parents=True)
    for stem in STEMS:
        svg = f'<svg xmlns="http://www.w3.org/2000/svg"><title>{stem}</title></svg>\n'
        (arch / f"{stem}.mmd").write_text(HONEST_MMD, encoding="utf-8")
        (arch / f"{stem}.svg").write_text(svg, encoding="utf-8")
    (repo / "AGENTS.md").write_text("# AGENTS\n", encoding="utf-8")
    (arch / "source-map.json").write_text(
        json.dumps(_minimal_source(commit=commit), indent=2) + "\n",
        encoding="utf-8",
    )
    public = repo / "public" / "architecture"
    public.mkdir(parents=True)
    for stem in STEMS:
        (public / f"{stem}.svg").write_text(
            (arch / f"{stem}.svg").read_text(encoding="utf-8"),
            encoding="utf-8",
        )


def test_exit_0_when_diagram_pack_is_honest(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    _write_clean_pack(repo)
    result = _run_gate(repo)
    assert result.returncode == 0, result.stderr
    assert "architecture diagrams clean" in result.stdout
    assert "source-map" in result.stdout


def test_exit_1_when_mmd_missing(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    _write_clean_pack(repo)
    (repo / "docs" / "architecture" / "context.mmd").unlink()
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "context.mmd" in result.stderr


def test_exit_1_when_svg_missing(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    _write_clean_pack(repo)
    (repo / "docs" / "architecture" / "containers.svg").unlink()
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "containers.svg" in result.stderr


def test_exit_1_when_required_phrase_absent(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    arch = repo / "docs" / "architecture"
    arch.mkdir(parents=True)
    thin = "flowchart TB\n  n[Vercel mc.plxcustomer.io only]\n"
    for stem in STEMS:
        (arch / f"{stem}.mmd").write_text(thin, encoding="utf-8")
        (arch / f"{stem}.svg").write_text("<svg/>\n", encoding="utf-8")
    (repo / "AGENTS.md").write_text("# AGENTS\n", encoding="utf-8")
    (arch / "source-map.json").write_text(
        json.dumps(_minimal_source()) + "\n", encoding="utf-8"
    )
    public = repo / "public" / "architecture"
    public.mkdir(parents=True)
    for stem in STEMS:
        (public / f"{stem}.svg").write_text("<svg/>\n", encoding="utf-8")
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "delta engine current" in result.stderr


def test_exit_1_when_hosting_signal_absent(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    arch = repo / "docs" / "architecture"
    arch.mkdir(parents=True)
    no_host = (
        "flowchart TB\n"
        "  sync[Sync — delta engine current;\n"
        "  Graph change-notifications deferred (P11)]\n"
    )
    for stem in STEMS:
        (arch / f"{stem}.mmd").write_text(no_host, encoding="utf-8")
        (arch / f"{stem}.svg").write_text("<svg/>\n", encoding="utf-8")
    (repo / "AGENTS.md").write_text("# AGENTS\n", encoding="utf-8")
    (arch / "source-map.json").write_text(
        json.dumps(_minimal_source()) + "\n", encoding="utf-8"
    )
    public = repo / "public" / "architecture"
    public.mkdir(parents=True)
    for stem in STEMS:
        (public / f"{stem}.svg").write_text("<svg/>\n", encoding="utf-8")
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "hosting signal" in result.stderr


def test_exit_1_when_forbidden_phrase_present(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    _write_clean_pack(repo)
    (repo / "docs" / "architecture" / "README.md").write_text(
        "Note: Sync engine (planned) must never return.\n",
        encoding="utf-8",
    )
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "forbidden" in result.stderr
    assert "Sync engine (planned)" in result.stderr


def test_exit_1_when_source_map_view_missing(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    _write_clean_pack(repo)
    source_map = _minimal_source()
    del source_map["views"]["task-lifecycle"]
    (repo / "docs" / "architecture" / "source-map.json").write_text(
        json.dumps(source_map) + "\n",
        encoding="utf-8",
    )
    result = _run_gate(repo)
    assert result.returncode == 1
    assert 'missing required view "task-lifecycle"' in result.stderr


def test_exit_1_when_duplicate_node_id(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    _write_clean_pack(repo)
    source_map = _minimal_source()
    view = source_map["views"]["context"]
    view["nodes"].append(view["nodes"][0])
    (repo / "docs" / "architecture" / "source-map.json").write_text(
        json.dumps(source_map) + "\n",
        encoding="utf-8",
    )
    result = _run_gate(repo)
    assert result.returncode == 1
    assert 'duplicate node id "a"' in result.stderr


def test_exit_1_when_edge_references_unknown_node(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    _write_clean_pack(repo)
    source_map = _minimal_source()
    source_map["views"]["context"]["edges"][0]["to"] = "missing"
    (repo / "docs" / "architecture" / "source-map.json").write_text(
        json.dumps(source_map) + "\n",
        encoding="utf-8",
    )
    result = _run_gate(repo)
    assert result.returncode == 1
    assert 'unknown target node "missing"' in result.stderr


def test_exit_1_when_boundary_references_unknown_node(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    _write_clean_pack(repo)
    source_map = _minimal_source()
    source_map["views"]["context"]["boundaries"]["externalBoundary"] = ["missing"]
    (repo / "docs" / "architecture" / "source-map.json").write_text(
        json.dumps(source_map) + "\n",
        encoding="utf-8",
    )
    result = _run_gate(repo)
    assert result.returncode == 1
    assert 'references unknown node "missing"' in result.stderr


def test_exit_1_when_source_file_missing(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    _write_clean_pack(repo)
    (repo / "AGENTS.md").unlink()
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "referenced source file missing: AGENTS.md" in result.stderr


def test_exit_1_when_source_line_range_invalid(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    _write_clean_pack(repo)
    source_map = _minimal_source()
    source_map["views"]["context"]["nodes"][0]["claims"][0]["sources"][0][
        "end_line"
    ] = 0
    (repo / "docs" / "architecture" / "source-map.json").write_text(
        json.dumps(source_map) + "\n",
        encoding="utf-8",
    )
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "end_line must be a positive integer" in result.stderr


def test_exit_1_when_node_count_exceeds_cap(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    _write_clean_pack(repo)
    source_map = _minimal_source()
    view = source_map["views"]["context"]
    claim = view["nodes"][0]["claims"][0]
    node_ids = ["a", "b"]
    for index in range(2, 32):
        node_id = f"node-{index}"
        node_ids.append(node_id)
        view["nodes"].append(
            {
                "mermaid_id": node_id,
                "display_label": node_id,
                "claims": [{**claim, "fact_id": node_id}],
            }
        )
    view["boundaries"]["missionControlBoundary"] = node_ids
    view["edges"] = []
    (repo / "docs" / "architecture" / "source-map.json").write_text(
        json.dumps(source_map) + "\n",
        encoding="utf-8",
    )
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "maximum is 30" in result.stderr


def test_exit_1_when_public_svg_fallback_drifts(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    _write_clean_pack(repo)
    (repo / "public" / "architecture" / "context.svg").write_text(
        "<svg><title>stale</title></svg>\n",
        encoding="utf-8",
    )
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "public SVG fallback drift" in result.stderr


def test_committed_diagram_pack_passes_in_repo() -> None:
    result = _run_gate(REPO_ROOT)
    assert result.returncode == 0, result.stderr
    assert "architecture diagrams clean" in result.stdout


def test_default_repo_root_self_resolves_independent_of_cwd(tmp_path: Path) -> None:
    result = subprocess.run(
        [sys.executable, str(GATE)],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "architecture diagrams clean" in result.stdout
