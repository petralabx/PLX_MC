"""Exit-code behavior for the architecture diagram pack gate."""

from __future__ import annotations

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


def _write_clean_pack(repo: Path) -> None:
    arch = repo / "docs" / "architecture"
    arch.mkdir(parents=True)
    for stem in STEMS:
        (arch / f"{stem}.mmd").write_text(HONEST_MMD, encoding="utf-8")
        (arch / f"{stem}.svg").write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg"><title>{stem}</title></svg>\n',
            encoding="utf-8",
        )


def test_exit_0_when_diagram_pack_is_honest(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    _write_clean_pack(repo)
    result = _run_gate(repo)
    assert result.returncode == 0, result.stderr
    assert "architecture diagrams clean" in result.stdout


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
