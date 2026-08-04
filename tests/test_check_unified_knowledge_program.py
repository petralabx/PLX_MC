"""Exit-code behavior for the unified knowledge program gate."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GATE = REPO_ROOT / "scripts" / "check-unified-knowledge-program.py"
BUNDLE = (
    REPO_ROOT / "artifacts" / "platform" / "2026-07-29-unified-knowledge-architecture"
)
PACKAGE_FILES = (
    "index.md",
    "REQUIREMENTS.md",
    "RESEARCH.md",
    "SPEC.md",
    "DECISIONS.md",
    "REPORT.md",
    "program.json",
    "program.schema.json",
    "unified-plx-document-knowledge-architecture.pdf",
    "unified-plx-document-knowledge-architecture.docx",
)


def _run_gate(repo_root: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GATE), "--repo-root", str(repo_root), *extra],
        capture_output=True,
        text=True,
        check=False,
    )


def _copy_package(tmp_path: Path) -> tuple[Path, Path]:
    repo = tmp_path / "mc"
    bundle = (
        repo / "artifacts" / "platform" / "2026-07-29-unified-knowledge-architecture"
    )
    bundle.mkdir(parents=True)
    for filename in PACKAGE_FILES:
        shutil.copy(BUNDLE / filename, bundle / filename)
    return repo, bundle


def _mutate_program(bundle: Path, mutate) -> None:
    path = bundle / "program.json"
    program = json.loads(path.read_text(encoding="utf-8"))
    mutate(program)
    path.write_text(json.dumps(program, indent=2) + "\n", encoding="utf-8")


def test_committed_program_passes() -> None:
    result = _run_gate(REPO_ROOT)
    assert result.returncode == 0, result.stderr
    assert "unified knowledge program clean" in result.stdout


def test_exit_1_for_schema_violation(tmp_path: Path) -> None:
    repo, bundle = _copy_package(tmp_path)
    _mutate_program(bundle, lambda program: program.pop("accountable_owner"))
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "accountable_owner" in result.stderr


def test_exit_1_for_empty_acceptance_evidence(tmp_path: Path) -> None:
    repo, bundle = _copy_package(tmp_path)
    _mutate_program(
        bundle,
        lambda program: program["milestones"][0].__setitem__("acceptance_evidence", []),
    )
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "acceptance_evidence" in result.stderr
    assert "should be non-empty" in result.stderr


def test_exit_1_for_missing_required_output(tmp_path: Path) -> None:
    repo, bundle = _copy_package(tmp_path)
    (bundle / "SPEC.md").unlink()
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "missing or empty required package file: SPEC.md" in result.stderr


def test_exit_1_for_missing_required_invariant(tmp_path: Path) -> None:
    repo, bundle = _copy_package(tmp_path)
    _mutate_program(
        bundle,
        lambda program: program["invariants"].__setitem__(
            0,
            {
                **program["invariants"][0],
                "statement": "A weaker architecture pattern is acceptable.",
            },
        ),
    )
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "required invariant" in result.stderr


def test_exit_1_without_mirror_is_boring_invariant(tmp_path: Path) -> None:
    repo, bundle = _copy_package(tmp_path)

    def remove_invariant(program: dict) -> None:
        program["invariants"] = [
            invariant
            for invariant in program["invariants"]
            if invariant["id"] != "INV-14"
        ]

    _mutate_program(bundle, remove_invariant)
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "mirror-is-boring gate must be met" in result.stderr


def test_exit_1_for_dangling_reference(tmp_path: Path) -> None:
    repo, bundle = _copy_package(tmp_path)
    _mutate_program(
        bundle,
        lambda program: program["tasks"][0]["requirements"].append("REQ-999"),
    )
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "unknown requirement" in result.stderr


def test_exit_1_for_dependency_cycle(tmp_path: Path) -> None:
    repo, bundle = _copy_package(tmp_path)

    def add_cycle(program: dict) -> None:
        program["milestones"][0]["depends_on"] = ["MS-07"]

    _mutate_program(bundle, add_cycle)
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "dependency cycle" in result.stderr


def test_exit_1_for_uncovered_requirement(tmp_path: Path) -> None:
    repo, bundle = _copy_package(tmp_path)

    def remove_coverage(program: dict) -> None:
        for task in program["tasks"]:
            task["requirements"] = [
                requirement
                for requirement in task["requirements"]
                if requirement != "REQ-09"
            ]

    _mutate_program(bundle, remove_coverage)
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "not covered by any task" in result.stderr


def test_exit_1_when_open_phase_gate_milestone_is_actionable(tmp_path: Path) -> None:
    repo, bundle = _copy_package(tmp_path)

    def make_blocked_milestone_ready(program: dict) -> None:
        milestone = next(
            item for item in program["milestones"] if item["id"] == "MS-01"
        )
        milestone["status"] = "ready"

    _mutate_program(bundle, make_blocked_milestone_ready)
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "MS-01: must remain blocked while a Phase 0 gate is open" in result.stderr


def test_exit_1_when_task_in_blocked_milestone_is_actionable(tmp_path: Path) -> None:
    repo, bundle = _copy_package(tmp_path)

    def make_blocked_task_ready(program: dict) -> None:
        task = next(item for item in program["tasks"] if item["id"] == "UKA-004")
        task["status"] = "ready"

    _mutate_program(bundle, make_blocked_task_ready)
    result = _run_gate(repo)
    assert result.returncode == 1
    assert "UKA-004: must remain blocked with milestone MS-01" in result.stderr


def test_print_mc_plan_is_deterministic_and_non_mutating(tmp_path: Path) -> None:
    repo, _bundle = _copy_package(tmp_path)
    before = sorted(
        (path.relative_to(repo).as_posix(), path.read_bytes())
        for path in repo.rglob("*")
        if path.is_file()
    )
    first = _run_gate(repo, "--print-mc-plan")
    second = _run_gate(repo, "--print-mc-plan")
    after = sorted(
        (path.relative_to(repo).as_posix(), path.read_bytes())
        for path in repo.rglob("*")
        if path.is_file()
    )

    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    assert first.stdout == second.stdout
    assert '"dry_run": true' in first.stdout
    assert '"task_id": "UKA-001"' in first.stdout
    assert before == after


def test_default_repo_root_self_resolves_independent_of_cwd(tmp_path: Path) -> None:
    result = subprocess.run(
        [sys.executable, str(GATE)],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
