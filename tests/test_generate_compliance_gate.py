"""Focused contracts for the generated PLX MC compliance workflow."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GENERATOR = REPO_ROOT / "scripts" / "generate-compliance-gate.py"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "compliance-gate.yml"


def _run(*arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GENERATOR), *arguments],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_compliance_generator_check_passes_for_canonical_workflow():
    assert _run("--check").returncode == 0


def test_compliance_generator_emit_matches_canonical_workflow():
    result = _run("--emit", "canonical")

    assert result.returncode == 0
    assert result.stdout == WORKFLOW.read_text(encoding="utf-8")


def test_canonical_and_downstream_send_full_and_legacy_repo_names():
    for variant in ("canonical", "downstream"):
        workflow = _run("--emit", variant).stdout

        assert "REPO_FULL_NAME: ${{ github.repository }}" in workflow
        assert "REPO_NAME: ${{ github.event.repository.name }}" in workflow
        assert '--arg repoFullName "$REPO_FULL_NAME"' in workflow
        assert (
            "{repo:$repo, repoFullName:$repoFullName, "
            "prNumber:$prNumber, headSha:$headSha"
        ) in workflow
        assert "module-shim — remove after 2026-10-15" in workflow


def test_pull_request_trigger_includes_edited_so_stamp_edits_rerun_gate():
    # TASK-2011: editing the MC-Checkout stamp in a PR body must re-run the
    # gate without a push, in both the canonical and downstream variants.
    for variant in ("canonical", "downstream"):
        workflow = _run("--emit", variant).stdout

        assert "types: [opened, synchronize, reopened, edited]" in workflow


def _trigger_section(workflow: str) -> str:
    start = workflow.index("\non:\n")
    return workflow[start : workflow.index("\npermissions:\n", start)]


def _gate_script(workflow: str) -> str:
    lines = workflow.splitlines()
    start = lines.index("        run: |") + 1
    script = []
    for line in lines[start:]:
        if line and not line.startswith("          "):
            break
        script.append(line[10:])
    return "\n".join(script) + "\n"


def _run_gate(tmp_path: Path, mode: str, head_ref: str, gh_exit: int):
    # Runs the generated step with no OIDC and a stub gh, so only the
    # merge_group resolve step and the verdict exits execute.
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    gh = bin_dir / "gh"
    gh.write_text(f"#!/bin/sh\necho gh-called >&2\nexit {gh_exit}\n")
    gh.chmod(0o755)
    script = tmp_path / "gate.sh"
    script.write_text(_gate_script(_run("--emit", "downstream").stdout))
    env = {
        "PATH": f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}",
        "MC_BASE_URL": "http://127.0.0.1:9",
        "MODE": mode,
        "GITHUB_EVENT_NAME": "merge_group",
        "MERGE_GROUP_HEAD_REF": head_ref,
        "REPO_FULL_NAME": "petralabx/PLX_MC",
    }
    # GitHub sets every step env key; merge_group leaves the PR fields empty.
    for key in ("MC_CI_TOKEN", "GH_TOKEN", "PR_BODY", "PR_NUMBER", "PR_HEAD_SHA"):
        env[key] = ""
    env.update(PR_LABELS="[]", PR_BASE_REF="", REPO_NAME="PLX_MC")
    return subprocess.run(
        ["bash", str(script)],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_merge_group_trigger_requests_checks_without_paths_filter():
    for variant in ("canonical", "downstream"):
        trigger = _trigger_section(_run("--emit", variant).stdout)

        assert "  merge_group:\n    types: [checks_requested]\n" in trigger, variant
        assert "paths" not in trigger, variant
        assert "types: [opened, synchronize, reopened, edited]" in trigger


def test_merge_group_branch_reads_pr_n_from_queue_ref_with_gh_api():
    for variant in ("canonical", "downstream"):
        workflow = _run("--emit", variant).stdout

        assert "\n  compliance:\n" in workflow
        assert "GH_TOKEN: ${{ github.token }}" in workflow
        assert (
            "MERGE_GROUP_HEAD_REF: ${{ github.event.merge_group.head_ref }}" in workflow
        )
        assert '"${GITHUB_EVENT_NAME:-}" = "merge_group"' in workflow
        assert "gh-readonly-queue/[^/]+/pr-([0-9]+)-[0-9a-f]+$" in workflow
        assert 'gh api "repos/${REPO_FULL_NAME}/pulls/${N}"' in workflow
        assert "pulls/${N}/files" in workflow
        assert "grep -oE 'MC-Checkout: dsp_[A-Za-z0-9]+'" in workflow
        assert (
            '(if $event == "merge_group" then {event:$event} else {} end)' in workflow
        )
        assert "merge_group: could not resolve the pull request" in workflow


def test_merge_group_adds_no_exit_and_no_skip():
    for variant in ("canonical", "downstream"):
        workflow = _run("--emit", variant).stdout

        script = _gate_script(workflow)

        assert script.count("exit 0") == 4, variant
        assert script.count("exit 1") == 2, variant
        assert "continue-on-error" not in workflow
        assert "\n    if:" not in workflow


def test_merge_group_script_parses_with_bash():
    for variant in ("canonical", "downstream"):
        script = _gate_script(_run("--emit", variant).stdout)
        result = subprocess.run(
            ["bash", "-n"], input=script, capture_output=True, text=True, check=False
        )

        assert result.returncode == 0, result.stderr


def test_merge_group_unresolved_ref_blocks_in_hard_mode(tmp_path):
    result = _run_gate(tmp_path, "hard", "refs/heads/not-a-queue-ref", 0)

    assert result.returncode == 1, result.stdout + result.stderr
    assert "merge_group: could not resolve the pull request" in result.stdout
    assert "Compliance gate: BLOCK" in result.stdout
    assert "gh-called" not in result.stderr


def test_merge_group_unreadable_pr_takes_the_soft_mode_exit(tmp_path):
    ref = "refs/heads/gh-readonly-queue/main/pr-42-0123abcd"
    result = _run_gate(tmp_path, "soft", ref, 1)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "gh-called" in result.stderr
    assert "merge_group: could not resolve the pull request" in result.stdout
    assert "soft mode — recording only, not failing the check" in result.stdout
