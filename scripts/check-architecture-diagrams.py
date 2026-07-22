#!/usr/bin/env python3
"""Architecture diagram pack gate — maintained C4 sources must stay honest.

Verifies the promoted diagram pack under docs/architecture/:
  - Required .mmd + matching .svg exist for context, containers, task-lifecycle
  - Required maturity / hosting phrases appear somewhere in the .mmd set
  - Forbidden honesty-oracle lies are absent anywhere under docs/architecture/
  - source-map.json structure, view IDs, unique IDs, boundaries, provenance
    sources, line ranges, and the 30-node-per-view cap (P1 contract)
  - public/architecture/*.svg fallback copies match docs/architecture/*.svg

Patterned on check-arch-parity.py: cheap, deterministic, exit 1 on drift,
wired into preflight policy gates.

Usage:
    python scripts/check-architecture-diagrams.py
    python scripts/check-architecture-diagrams.py --repo-root path/to/repo
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

DEFAULT_REPO_ROOT = Path(__file__).resolve().parents[1]

DIAGRAM_STEMS = ("context", "containers", "task-lifecycle")
VIEW_IDS = DIAGRAM_STEMS
MAX_NODES_PER_VIEW = 30
SOURCE_MAP_PATH = "docs/architecture/source-map.json"
PUBLIC_ARCH_DIR = "public/architecture"

# Required somewhere across the combined .mmd corpus (case-sensitive substrings).
REQUIRED_MMD_PHRASES = (
    "delta engine current",
    "Graph change-notifications deferred (P11)",
)

# Hosting signal: at least one of these must appear in the .mmd set.
HOSTING_SIGNAL_ANY_OF = (
    "mc.plxcustomer.io",
    "Vercel",
)

# Forbidden anywhere under docs/architecture/ (all file types).
FORBIDDEN_ARCHITECTURE_PHRASES = (
    "Production hosting unknown",
    "still says planned",
    "needs owner reconciliation",
    "Sync engine (planned)",
)


def _normalize(text: str) -> str:
    """Collapse fancy dashes so Windows/editor variants still match."""
    return text.replace("\u2013", "—").replace("--", "—")


def _non_empty_string(value: Any, at: str) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()


def _duplicate_ids(ids: list[str]) -> list[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for item_id in ids:
        if item_id in seen:
            duplicates.add(item_id)
        seen.add(item_id)
    return sorted(duplicates)


def _validate_source_reference(
    repo_root: Path,
    source: Any,
    *,
    at: str,
    map_commit: str,
) -> list[str]:
    violations: list[str] = []
    if not isinstance(source, dict):
        return [f"{at}: source must be an object"]

    path = _non_empty_string(source.get("path"), f"{at} path")
    if path is None:
        violations.append(f"{at}: source path must be a non-empty string")
        return violations

    authority = _non_empty_string(
        source.get("authority_class"), f"{at} authority_class"
    )
    if authority is None:
        violations.append(f"{at}: source authority_class must be a non-empty string")

    source_commit = _non_empty_string(
        source.get("source_commit"), f"{at} source_commit"
    )
    if source_commit is None:
        violations.append(f"{at}: source source_commit must be a non-empty string")
    elif source_commit != map_commit:
        violations.append(
            f"{at}: source_commit {source_commit!r} does not match "
            f"source-map source_commit {map_commit!r}"
        )

    start_line = source.get("start_line")
    end_line = source.get("end_line")
    if not isinstance(start_line, int) or start_line < 1:
        violations.append(f"{at}: start_line must be a positive integer")
    else:
        if end_line is not None:
            if not isinstance(end_line, int) or end_line < 1:
                violations.append(f"{at}: end_line must be a positive integer when set")
            elif end_line < start_line:
                violations.append(
                    f"{at}: end_line ({end_line}) is before start_line ({start_line})"
                )

    source_path = repo_root / path
    if not source_path.is_file():
        violations.append(f"{at}: referenced source file missing: {path}")

    return violations


def _validate_claims(
    repo_root: Path,
    claims: Any,
    *,
    entity_kind: str,
    entity_id: str,
    view_id: str,
    map_commit: str,
) -> list[str]:
    violations: list[str] = []
    if not isinstance(claims, list) or not claims:
        violations.append(
            f'source-map view "{view_id}" {entity_kind} "{entity_id}" has no claims'
        )
        return violations

    for index, claim in enumerate(claims):
        at = f'source-map view "{view_id}" {entity_kind} "{entity_id}" claim {index}'
        if not isinstance(claim, dict):
            violations.append(f"{at}: claim must be an object")
            continue

        fact_id = _non_empty_string(claim.get("fact_id"), f"{at} fact_id")
        canonical = _non_empty_string(
            claim.get("canonical_claim"), f"{at} canonical_claim"
        )
        if fact_id is None:
            violations.append(f"{at}: fact_id must be a non-empty string")
        if canonical is None:
            violations.append(f"{at}: canonical_claim must be a non-empty string")

        sources = claim.get("sources")
        if not isinstance(sources, list) or not sources:
            violations.append(f"{at}: claim has no source links")
            continue

        for source_index, source in enumerate(sources):
            violations.extend(
                _validate_source_reference(
                    repo_root,
                    source,
                    at=f"{at} source {source_index}",
                    map_commit=map_commit,
                )
            )

    return violations


def _validate_boundaries(
    boundaries: Any,
    *,
    view_id: str,
    node_ids: set[str],
) -> list[str]:
    violations: list[str] = []
    if boundaries is None:
        violations.append(f'source-map view "{view_id}" is missing boundaries')
        return violations
    if not isinstance(boundaries, dict):
        violations.append(f'source-map view "{view_id}" boundaries must be an object')
        return violations

    membership: dict[str, int] = {node_id: 0 for node_id in node_ids}

    for boundary_id, members in boundaries.items():
        if not isinstance(boundary_id, str) or not boundary_id.strip():
            violations.append(f'source-map view "{view_id}" has an empty boundary id')
            continue
        if not isinstance(members, list):
            violations.append(
                f'source-map view "{view_id}" boundary "{boundary_id}" must be an array'
            )
            continue
        for index, member in enumerate(members):
            if not isinstance(member, str) or not member.strip():
                violations.append(
                    f'source-map view "{view_id}" boundary "{boundary_id}" '
                    f"member {index} must be a non-empty string"
                )
                continue
            member_id = member.strip()
            if member_id not in node_ids:
                violations.append(
                    f'source-map view "{view_id}" boundary "{boundary_id}" '
                    f'references unknown node "{member_id}"'
                )
            else:
                membership[member_id] = membership.get(member_id, 0) + 1

    for node_id, count in sorted(membership.items()):
        if count == 0:
            violations.append(
                f'source-map view "{view_id}" node "{node_id}" is outside every boundary'
            )
        elif count > 1:
            violations.append(
                f'source-map view "{view_id}" node "{node_id}" belongs to multiple boundaries'
            )

    return violations


def _validate_entities(
    entities: Any,
    *,
    view_id: str,
    entity_kind: str,
    id_field: str,
    repo_root: Path,
    map_commit: str,
) -> tuple[list[str], list[str], set[str]]:
    violations: list[str] = []
    ids: list[str] = []

    if not isinstance(entities, list):
        violations.append(f'source-map view "{view_id}" {entity_kind} must be an array')
        return violations, ids, set()

    for index, entity in enumerate(entities):
        at = f'source-map view "{view_id}" {entity_kind} {index}'
        if not isinstance(entity, dict):
            violations.append(f"{at}: must be an object")
            continue

        entity_id = _non_empty_string(entity.get(id_field), f"{at} {id_field}")
        if entity_id is None:
            violations.append(f"{at}: {id_field} must be a non-empty string")
            continue
        ids.append(entity_id)

        display_label = _non_empty_string(
            entity.get("display_label"), f"{at} display_label"
        )
        if display_label is None:
            violations.append(f"{at}: display_label must be a non-empty string")

        violations.extend(
            _validate_claims(
                repo_root,
                entity.get("claims"),
                entity_kind=entity_kind.rstrip("s"),
                entity_id=entity_id,
                view_id=view_id,
                map_commit=map_commit,
            )
        )

    node_id_set = set(ids)
    for duplicate in _duplicate_ids(ids):
        violations.append(
            f'source-map view "{view_id}" duplicate {entity_kind[:-1]} id "{duplicate}"'
        )

    return violations, ids, node_id_set


def check_source_map(repo_root: Path) -> list[str]:
    violations: list[str] = []
    source_map_file = repo_root / SOURCE_MAP_PATH

    if not source_map_file.is_file():
        violations.append(f"missing required source map: {SOURCE_MAP_PATH}")
        return violations

    try:
        source_map = json.loads(source_map_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"{SOURCE_MAP_PATH} is not valid JSON: {exc}"]

    if not isinstance(source_map, dict):
        return [f"{SOURCE_MAP_PATH} root must be a JSON object"]

    schema_version = _non_empty_string(
        source_map.get("schema_version"), "source-map schema_version"
    )
    if schema_version is None:
        violations.append("source-map schema_version must be a non-empty string")

    notice = _non_empty_string(source_map.get("notice"), "source-map notice")
    if notice is None:
        violations.append("source-map notice must be a non-empty string")

    map_commit = _non_empty_string(
        source_map.get("source_commit"), "source-map source_commit"
    )
    if map_commit is None:
        violations.append("source-map source_commit must be a non-empty string")
        return violations

    views = source_map.get("views")
    if not isinstance(views, dict):
        violations.append("source-map views must be an object")
        return violations

    for view_id in VIEW_IDS:
        if view_id not in views:
            violations.append(f'source-map missing required view "{view_id}"')

    for view_id, raw_view in views.items():
        if view_id not in VIEW_IDS:
            continue
        if not isinstance(raw_view, dict):
            violations.append(f'source-map view "{view_id}" must be an object')
            continue

        node_violations, _node_ids_list, node_ids = _validate_entities(
            raw_view.get("nodes"),
            view_id=view_id,
            entity_kind="nodes",
            id_field="mermaid_id",
            repo_root=repo_root,
            map_commit=map_commit,
        )
        violations.extend(node_violations)

        if len(node_ids) > MAX_NODES_PER_VIEW:
            violations.append(
                f'source-map view "{view_id}" has {len(node_ids)} nodes; '
                f"the maximum is {MAX_NODES_PER_VIEW}"
            )

        edge_violations, _edge_ids_list, _edge_id_set = _validate_entities(
            raw_view.get("edges"),
            view_id=view_id,
            entity_kind="edges",
            id_field="mermaid_id",
            repo_root=repo_root,
            map_commit=map_commit,
        )
        violations.extend(edge_violations)

        if isinstance(raw_view.get("edges"), list):
            edge_ids_seen: list[str] = []
            for edge in raw_view["edges"]:
                if isinstance(edge, dict):
                    edge_id = _non_empty_string(edge.get("mermaid_id"), "edge id")
                    if edge_id:
                        edge_ids_seen.append(edge_id)
                        from_id = _non_empty_string(
                            edge.get("from"), f'edge "{edge_id}" from'
                        )
                        to_id = _non_empty_string(
                            edge.get("to"), f'edge "{edge_id}" to'
                        )
                        if from_id is None:
                            violations.append(
                                f'source-map view "{view_id}" edge "{edge_id}" '
                                f"from must be a non-empty string"
                            )
                        elif from_id not in node_ids:
                            violations.append(
                                f'source-map view "{view_id}" edge "{edge_id}" '
                                f'references unknown source node "{from_id}"'
                            )
                        if to_id is None:
                            violations.append(
                                f'source-map view "{view_id}" edge "{edge_id}" '
                                f"to must be a non-empty string"
                            )
                        elif to_id not in node_ids:
                            violations.append(
                                f'source-map view "{view_id}" edge "{edge_id}" '
                                f'references unknown target node "{to_id}"'
                            )
            for duplicate in _duplicate_ids(edge_ids_seen):
                violations.append(
                    f'source-map view "{view_id}" duplicate edge id "{duplicate}"'
                )

        violations.extend(
            _validate_boundaries(
                raw_view.get("boundaries"),
                view_id=view_id,
                node_ids=node_ids,
            )
        )

    return violations


def _file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_svg_fallback_parity(repo_root: Path) -> list[str]:
    violations: list[str] = []
    docs_dir = repo_root / "docs" / "architecture"
    public_dir = repo_root / PUBLIC_ARCH_DIR

    for stem in DIAGRAM_STEMS:
        docs_svg = docs_dir / f"{stem}.svg"
        public_svg = public_dir / f"{stem}.svg"
        if not public_svg.is_file():
            violations.append(
                f"missing public SVG fallback: {PUBLIC_ARCH_DIR}/{stem}.svg"
            )
            continue
        if not docs_svg.is_file():
            continue
        if _file_digest(docs_svg) != _file_digest(public_svg):
            violations.append(
                f"public SVG fallback drift: {PUBLIC_ARCH_DIR}/{stem}.svg "
                f"does not match docs/architecture/{stem}.svg"
            )

    return violations


def check_architecture_diagrams(repo_root: Path) -> list[str]:
    violations: list[str] = []
    arch_dir = repo_root / "docs" / "architecture"

    if not arch_dir.is_dir():
        violations.append(f"missing directory: {arch_dir.as_posix()}")
        return violations

    mmd_corpus_parts: list[str] = []

    for stem in DIAGRAM_STEMS:
        mmd_path = arch_dir / f"{stem}.mmd"
        svg_path = arch_dir / f"{stem}.svg"
        if not mmd_path.is_file():
            violations.append(
                f"missing required diagram source: docs/architecture/{stem}.mmd"
            )
        else:
            mmd_corpus_parts.append(_normalize(mmd_path.read_text(encoding="utf-8")))
        if not svg_path.is_file():
            violations.append(
                f"missing required diagram render: docs/architecture/{stem}.svg"
            )

    mmd_corpus = "\n".join(mmd_corpus_parts)

    if mmd_corpus_parts:
        for phrase in REQUIRED_MMD_PHRASES:
            if phrase not in mmd_corpus:
                violations.append(
                    f"docs/architecture/*.mmd missing required phrase: {phrase!r}"
                )

        if not any(signal in mmd_corpus for signal in HOSTING_SIGNAL_ANY_OF):
            signals = " or ".join(repr(s) for s in HOSTING_SIGNAL_ANY_OF)
            violations.append(
                f"docs/architecture/*.mmd missing hosting signal ({signals})"
            )

    # Scan every file under docs/architecture/ for forbidden honesty lies.
    for path in sorted(arch_dir.rglob("*")):
        if not path.is_file():
            continue
        try:
            text = _normalize(path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, OSError):
            # Binary / unreadable artifacts are not honesty-oracle prose.
            continue
        rel = path.relative_to(repo_root).as_posix()
        for phrase in FORBIDDEN_ARCHITECTURE_PHRASES:
            if phrase in text:
                violations.append(f"forbidden phrase {phrase!r} found in {rel}")

    violations.extend(check_source_map(repo_root))
    violations.extend(check_svg_fallback_parity(repo_root))

    return violations


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Verify docs/architecture diagram pack exists and stays "
            "honesty-oracle clean."
        )
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=DEFAULT_REPO_ROOT,
        help="Mission Control repo root (default: this script's own repo root)",
    )
    args = parser.parse_args(argv)
    repo_root = args.repo_root.resolve()

    violations = check_architecture_diagrams(repo_root)
    if violations:
        print("architecture diagrams FAIL:", file=sys.stderr)
        for line in violations:
            print(f"  {line}", file=sys.stderr)
        return 1

    print(
        "architecture diagrams clean "
        "(context/containers/task-lifecycle + honesty phrases + source-map + SVG fallback)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
