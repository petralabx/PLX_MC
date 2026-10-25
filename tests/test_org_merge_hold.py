"""The org-wide merge-hold check (TASK-3902): its job script, run against a stub gh."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
import yaml

WORKFLOW = (
    Path(__file__).resolve().parents[1] / ".github" / "workflows" / "org-merge-hold.yml"
)


def _script() -> str:
    job = yaml.safe_load(WORKFLOW.read_text())["jobs"]["merge-hold"]
    return job["steps"][0]["run"]


def _run(
    tmp_path: Path, event: str, *, labels: str = "", fail: bool = False, **env: str
):
    """Run the job script. The stub gh prints `labels`, or fails every call when `fail`."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "gh.log"
    gh = bin_dir / "gh"
    gh.write_text(
        f'#!/bin/sh\necho "$*" >> "{log}"\n'
        + ("exit 1\n" if fail else f"printf '%s' '{labels}'\n")
    )
    sleep = bin_dir / "sleep"
    sleep.write_text("#!/bin/sh\nexit 0\n")
    for stub in (gh, sleep):
        stub.chmod(0o755)
    result = subprocess.run(
        ["bash", "-c", _script()],
        capture_output=True,
        text=True,
        env={
            "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
            "REPO": "petralabx/x",
            "EVENT": event,
            **env,
        },
        check=False,
    )
    calls = log.read_text().splitlines() if log.exists() else []
    return result, calls


def test_the_workflow_runs_on_pull_requests_and_merge_groups_and_reports_merge_hold():
    workflow = yaml.safe_load(WORKFLOW.read_text())
    # PyYAML reads the bare key `on` as True.
    assert set(workflow[True]) == {"pull_request", "merge_group"}
    assert workflow["jobs"]["merge-hold"]["name"] == "merge-hold"


def test_a_pr_without_the_hold_label_passes(tmp_path):
    result, calls = _run(tmp_path, "pull_request", labels="bug\nready", PR_NUMBER="7")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "#7 has no hold label." in result.stdout
    assert calls == ["api repos/petralabx/x/issues/7/labels --jq .[].name"]


def test_a_held_pr_fails(tmp_path):
    result, _ = _run(tmp_path, "pull_request", labels="bug\nhold", PR_NUMBER="7")
    assert result.returncode == 1
    assert "#7 has the 'hold' label" in result.stdout


def test_only_the_exact_hold_label_counts(tmp_path):
    result, _ = _run(
        tmp_path, "pull_request", labels="on-hold\nhold-review", PR_NUMBER="7"
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_a_merge_group_checks_the_pr_it_was_built_for(tmp_path):
    ref = "refs/heads/gh-readonly-queue/main/pr-42-0123abcd"
    result, calls = _run(tmp_path, "merge_group", labels="hold", QUEUE_REF=ref)
    assert result.returncode == 1
    assert "#42 has the 'hold' label" in result.stdout
    assert calls == ["api repos/petralabx/x/issues/42/labels --jq .[].name"]


def test_an_unknown_pr_fails(tmp_path):
    result, calls = _run(
        tmp_path, "merge_group", labels="", QUEUE_REF="refs/heads/elsewhere"
    )
    assert result.returncode == 1
    assert "Could not tell which PR" in result.stdout
    assert calls == []


@pytest.mark.parametrize("event", ["pull_request", "merge_group"])
def test_unreadable_labels_fail_after_three_tries(tmp_path, event):
    env = (
        {"PR_NUMBER": "7"}
        if event == "pull_request"
        else {"QUEUE_REF": "refs/heads/gh-readonly-queue/main/pr-7-abc"}
    )
    result, calls = _run(tmp_path, event, fail=True, **env)
    assert result.returncode == 1
    assert "Could not read the labels of #7" in result.stdout
    assert len(calls) == 3
