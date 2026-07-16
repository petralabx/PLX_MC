"""Exit-code behavior for the architecture maturity parity gate."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GATE = REPO_ROOT / "scripts" / "check-arch-parity.py"

DELTA_CURRENT = "Sync engine (delta) — current"
WEBHOOKS_DEFERRED = "Graph change-notifications — deferred (P11)"


def _run_gate(repo_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GATE), "--repo-root", str(repo_root)],
        capture_output=True,
        text=True,
    )


def _write_aligned_docs(repo: Path) -> None:
    (repo / "AGENTS.md").write_text(
        f"| {DELTA_CURRENT} | shipped |\n| {WEBHOOKS_DEFERRED} | scaffolding |\n",
        encoding="utf-8",
    )
    (repo / "TOOLS.md").write_text(
        "Inbound delta poll on ToDos/Risk Register.\n"
        f"Maturity wording must stay aligned: “{WEBHOOKS_DEFERRED}”.\n"
        "The five-minute delta sweep remains the correctness backbone.\n",
        encoding="utf-8",
    )


def test_exit_0_when_maturity_cells_agree(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    _write_aligned_docs(repo)
    result = _run_gate(repo)
    assert result.returncode == 0, result.stderr
    assert "arch parity clean" in result.stdout


def test_exit_1_when_agents_still_says_planned(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    _write_aligned_docs(repo)
    agents = repo / "AGENTS.md"
    agents.write_text(
        agents.read_text(encoding="utf-8") + "\n| Sync engine (planned) | not yet |\n",
        encoding="utf-8",
    )
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "forbidden" in result.stderr or "planned" in result.stderr


def test_exit_1_when_tools_missing_deferred_phrase(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    (repo / "AGENTS.md").write_text(
        f"| {DELTA_CURRENT} |\n| {WEBHOOKS_DEFERRED} |\n",
        encoding="utf-8",
    )
    (repo / "TOOLS.md").write_text(
        "The five-minute delta sweep is the backbone.\n",
        encoding="utf-8",
    )
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "drift" in result.stderr


def test_exit_1_when_tools_lacks_delta_current_signal(tmp_path: Path) -> None:
    repo = tmp_path / "mc"
    repo.mkdir()
    (repo / "AGENTS.md").write_text(
        f"| {DELTA_CURRENT} |\n| {WEBHOOKS_DEFERRED} |\n",
        encoding="utf-8",
    )
    (repo / "TOOLS.md").write_text(
        f"{WEBHOOKS_DEFERRED}\nNo mention of the live path.\n",
        encoding="utf-8",
    )
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "delta" in result.stderr.lower()


def test_committed_docs_pass_in_repo() -> None:
    result = _run_gate(REPO_ROOT)
    assert result.returncode == 0, result.stderr
    assert "arch parity clean" in result.stdout


def test_default_repo_root_self_resolves_independent_of_cwd(tmp_path: Path) -> None:
    result = subprocess.run(
        [sys.executable, str(GATE)],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "arch parity clean" in result.stdout
