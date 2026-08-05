#!/usr/bin/env python3
"""Validate the TASK-477 machine-readable program and dispatch dry-run.

The gate is deterministic and read-only. It validates JSON Schema shape,
architecture invariants, references, dependency DAGs, and requirement coverage.
`--print-mc-plan` emits the exact Mission Control import proposal without making
network calls or mutating repository state.
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

DEFAULT_REPO_ROOT = Path(__file__).resolve().parents[1]
BUNDLE_PATH = Path("artifacts/platform/2026-07-29-unified-knowledge-architecture")
PROGRAM_PATH = BUNDLE_PATH / "program.json"
SCHEMA_PATH = BUNDLE_PATH / "program.schema.json"
REQUIRED_PACKAGE_FILES = (
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

REQUIRED_INVARIANT_PHRASES = (
    "Knowledge Ledger with Disposable Projections",
    "rebuildable",
    "Ontology changes are versioned",
    "Department heads remain accountable",
    "Part 11",
    "deny by default",
    "machine readable",
    "SharePoint is the system of record",
    "Mission Control is workflow authority",
    "mirror-is-boring gate must be met",
)


def _load_json(path: Path, label: str) -> tuple[Any | None, list[str]]:
    if not path.is_file():
        return None, [f"missing {label}: {path.as_posix()}"]
    try:
        return json.loads(path.read_text(encoding="utf-8")), []
    except json.JSONDecodeError as exc:
        return None, [f"{label} is not valid JSON: {exc}"]


def _schema_path(error: Any) -> str:
    path = ".".join(str(part) for part in error.absolute_path)
    return path or "<root>"


def _duplicates(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    return sorted(duplicates)


def _ids(program: dict[str, Any], section: str) -> list[str]:
    return [
        item.get("id", "")
        for item in program.get(section, [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    ]


def _check_unique_ids(program: dict[str, Any]) -> list[str]:
    violations: list[str] = []
    for section in (
        "invariants",
        "phase_zero_gates",
        "requirements",
        "milestones",
        "tasks",
        "risks",
        "gates",
        "validation",
    ):
        for item_id in _duplicates(_ids(program, section)):
            violations.append(f'{section}: duplicate id "{item_id}"')
    return violations


def _check_references(program: dict[str, Any]) -> list[str]:
    violations: list[str] = []
    requirement_ids = set(_ids(program, "requirements"))
    milestone_ids = set(_ids(program, "milestones"))
    task_ids = set(_ids(program, "tasks"))
    risk_ids = set(_ids(program, "risks"))

    for milestone in program.get("milestones", []):
        milestone_id = milestone["id"]
        for dependency in milestone["depends_on"]:
            if dependency not in milestone_ids:
                violations.append(
                    f'{milestone_id}: unknown milestone dependency "{dependency}"'
                )
        for requirement in milestone["requirements"]:
            if requirement not in requirement_ids:
                violations.append(
                    f'{milestone_id}: unknown requirement "{requirement}"'
                )
        for risk in milestone["risks"]:
            if risk not in risk_ids:
                violations.append(f'{milestone_id}: unknown risk "{risk}"')

    for task in program.get("tasks", []):
        task_id = task["id"]
        if task["milestone"] not in milestone_ids:
            violations.append(f'{task_id}: unknown milestone "{task["milestone"]}"')
        for dependency in task["depends_on"]:
            if dependency not in task_ids:
                violations.append(f'{task_id}: unknown task dependency "{dependency}"')
        for requirement in task["requirements"]:
            if requirement not in requirement_ids:
                violations.append(f'{task_id}: unknown requirement "{requirement}"')

    for gate in program.get("gates", []):
        if gate["after_milestone"] not in milestone_ids:
            violations.append(
                f'{gate["id"]}: unknown milestone "{gate["after_milestone"]}"'
            )

    for phase_gate in program.get("phase_zero_gates", []):
        for blocked in phase_gate["blocks"]:
            if blocked not in milestone_ids:
                violations.append(
                    f'{phase_gate["id"]}: unknown blocked milestone "{blocked}"'
                )

    return violations


def _dependency_cycle(
    records: list[dict[str, Any]],
    *,
    dependency_key: str,
) -> list[str] | None:
    dependencies = {record["id"]: list(record[dependency_key]) for record in records}
    visiting: set[str] = set()
    visited: set[str] = set()
    stack: list[str] = []

    def visit(item_id: str) -> list[str] | None:
        if item_id in visiting:
            start = stack.index(item_id)
            return stack[start:] + [item_id]
        if item_id in visited:
            return None
        visiting.add(item_id)
        stack.append(item_id)
        for dependency in dependencies.get(item_id, []):
            if dependency not in dependencies:
                continue
            cycle = visit(dependency)
            if cycle:
                return cycle
        stack.pop()
        visiting.remove(item_id)
        visited.add(item_id)
        return None

    for item_id in dependencies:
        cycle = visit(item_id)
        if cycle:
            return cycle
    return None


def _check_dependency_graphs(program: dict[str, Any]) -> list[str]:
    violations: list[str] = []
    for label, section in (
        ("milestone", "milestones"),
        ("task", "tasks"),
    ):
        cycle = _dependency_cycle(
            program.get(section, []),
            dependency_key="depends_on",
        )
        if cycle:
            violations.append(f"{label} dependency cycle: {' -> '.join(cycle)}")
    return violations


def _check_invariants(program: dict[str, Any]) -> list[str]:
    corpus = "\n".join(
        invariant["statement"] for invariant in program.get("invariants", [])
    )
    return [
        f"required invariant missing phrase: {phrase!r}"
        for phrase in REQUIRED_INVARIANT_PHRASES
        if phrase not in corpus
    ]


def _check_coverage(program: dict[str, Any]) -> list[str]:
    violations: list[str] = []
    requirement_ids = set(_ids(program, "requirements"))
    covered_requirements = {
        requirement
        for task in program.get("tasks", [])
        for requirement in task["requirements"]
    }
    for requirement in sorted(requirement_ids - covered_requirements):
        violations.append(f"{requirement}: not covered by any task")

    milestone_ids = set(_ids(program, "milestones"))
    covered_milestones = {task["milestone"] for task in program.get("tasks", [])}
    for milestone in sorted(milestone_ids - covered_milestones):
        violations.append(f"{milestone}: has no implementation task")
    return violations


def _check_blocked_statuses(program: dict[str, Any]) -> list[str]:
    violations: list[str] = []
    blocked_milestone_ids = {
        milestone_id
        for gate in program.get("phase_zero_gates", [])
        if gate["status"] != "passed"
        for milestone_id in gate["blocks"]
    }
    milestones = {
        milestone["id"]: milestone for milestone in program.get("milestones", [])
    }
    for milestone_id in sorted(blocked_milestone_ids):
        milestone = milestones.get(milestone_id)
        if milestone and milestone["status"] != "blocked":
            violations.append(
                f"{milestone_id}: must remain blocked while a Phase 0 gate is open"
            )

    blocked_task_milestones = {
        milestone["id"]
        for milestone in milestones.values()
        if milestone["status"] == "blocked"
    }
    for task in program.get("tasks", []):
        if task["milestone"] in blocked_task_milestones and task["status"] != "blocked":
            violations.append(
                f"{task['id']}: must remain blocked with milestone {task['milestone']}"
            )
    return violations


def _check_package(repo_root: Path, program: dict[str, Any]) -> list[str]:
    bundle = repo_root / BUNDLE_PATH
    violations: list[str] = []
    for filename in REQUIRED_PACKAGE_FILES:
        path = bundle / filename
        if not path.is_file() or path.stat().st_size == 0:
            violations.append(f"missing or empty required package file: {filename}")

    markdown_names = (
        "index.md",
        "REQUIREMENTS.md",
        "RESEARCH.md",
        "SPEC.md",
        "DECISIONS.md",
        "REPORT.md",
    )
    markdown_corpus = "\n".join(
        (bundle / name).read_text(encoding="utf-8")
        for name in markdown_names
        if (bundle / name).is_file()
    )
    for phrase in (
        program["title"],
        program["source_task"],
        program["accountable_owner"],
        program["architecture_pattern"],
    ):
        if phrase not in markdown_corpus:
            violations.append(f"canonical package missing required phrase: {phrase!r}")

    documented_requirements = set()
    for token in markdown_corpus.replace("`", " ").replace("|", " ").split():
        normalized = token.strip(".,:;()[]")
        if normalized.startswith("REQ-") and normalized[4:].isdigit():
            documented_requirements.add(normalized)
    requirement_ids = set(_ids(program, "requirements"))
    for requirement in sorted(requirement_ids - documented_requirements):
        violations.append(
            f"{requirement}: missing from canonical Markdown requirement trace"
        )

    report = bundle / "REPORT.md"
    if report.is_file():
        report_text = report.read_text(encoding="utf-8")
        expected_counts = (
            f"{len(program['requirements'])} traced requirements",
            f"{len(program['milestones'])} dependency-ordered milestones",
            f"{len(program['tasks'])} tasks",
            f"{len(program['risks'])} risks",
            f"{len(program['gates'])} approval gates",
            f"{len(program['validation'])} validation commands",
        )
        for count_text in expected_counts:
            if count_text not in report_text:
                violations.append(
                    f"REPORT.md program count drift: expected {count_text!r}"
                )

    pdf = bundle / "unified-plx-document-knowledge-architecture.pdf"
    if pdf.is_file() and not pdf.read_bytes().startswith(b"%PDF-"):
        violations.append("PDF export does not have a PDF signature")

    docx = bundle / "unified-plx-document-knowledge-architecture.docx"
    if docx.is_file():
        try:
            with zipfile.ZipFile(docx) as archive:
                if "word/document.xml" not in archive.namelist():
                    violations.append("DOCX export is missing word/document.xml")
        except zipfile.BadZipFile:
            violations.append("DOCX export is not a valid ZIP container")

    return violations


def validate_program(repo_root: Path) -> tuple[dict[str, Any] | None, list[str]]:
    program_path = repo_root / PROGRAM_PATH
    schema_path = repo_root / SCHEMA_PATH
    program, program_errors = _load_json(program_path, "program")
    schema, schema_errors = _load_json(schema_path, "program schema")
    violations = [*program_errors, *schema_errors]
    if violations:
        return None, violations
    if not isinstance(program, dict):
        return None, ["program root must be an object"]
    if not isinstance(schema, dict):
        return None, ["program schema root must be an object"]

    try:
        Draft202012Validator.check_schema(schema)
    except Exception as exc:  # jsonschema raises detailed schema exceptions.
        return None, [f"program schema is invalid: {exc}"]

    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    schema_violations = sorted(
        (
            f"schema {_schema_path(error)}: {error.message}"
            for error in validator.iter_errors(program)
        )
    )
    if schema_violations:
        return program, schema_violations

    violations.extend(_check_unique_ids(program))
    violations.extend(_check_references(program))
    violations.extend(_check_dependency_graphs(program))
    violations.extend(_check_invariants(program))
    violations.extend(_check_coverage(program))
    violations.extend(_check_blocked_statuses(program))
    violations.extend(_check_package(repo_root, program))
    return program, violations


def mission_control_dry_run(program: dict[str, Any]) -> dict[str, Any]:
    gates_by_milestone: dict[str, list[str]] = {}
    for gate in program["gates"]:
        gates_by_milestone.setdefault(gate["after_milestone"], []).append(gate["id"])

    return {
        "dry_run": True,
        "schema_version": "plx-mc-import-plan/v1",
        "program_id": program["program_id"],
        "source_task": program["source_task"],
        "accountable_owner": program["accountable_owner"],
        "mutation_count": 0,
        "milestones": [
            {
                "milestone_id": milestone["id"],
                "title": milestone["title"],
                "owner": milestone["owner"],
                "status": milestone["status"],
                "depends_on": milestone["depends_on"],
                "gate_ids": sorted(gates_by_milestone.get(milestone["id"], [])),
                "acceptance_evidence": milestone["acceptance_evidence"],
            }
            for milestone in sorted(
                program["milestones"], key=lambda item: item["order"]
            )
        ],
        "tasks": [
            {
                "task_id": task["id"],
                "title": task["title"],
                "milestone": task["milestone"],
                "owner": task["owner"],
                "executor": task["executor"],
                "autonomy": task["autonomy"],
                "status": task["status"],
                "depends_on": task["depends_on"],
                "requirements": task["requirements"],
                "repo": task["repo"],
                "done_when": task["done_when"],
            }
            for task in sorted(program["tasks"], key=lambda item: item["id"])
        ],
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Validate the TASK-477 unified knowledge program."
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=DEFAULT_REPO_ROOT,
        help="Repository root (default: this script's repository).",
    )
    parser.add_argument(
        "--print-mc-plan",
        action="store_true",
        help="Print a deterministic, non-mutating Mission Control import proposal.",
    )
    args = parser.parse_args(argv)

    program, violations = validate_program(args.repo_root.resolve())
    if violations:
        print("unified knowledge program FAIL:", file=sys.stderr)
        for violation in violations:
            print(f"  - {violation}", file=sys.stderr)
        return 1

    assert program is not None
    if args.print_mc_plan:
        print(json.dumps(mission_control_dry_run(program), indent=2, sort_keys=True))
    else:
        print(
            "unified knowledge program clean "
            f"({len(program['requirements'])} requirements, "
            f"{len(program['milestones'])} milestones, "
            f"{len(program['tasks'])} tasks, "
            f"{len(program['gates'])} gates)"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
