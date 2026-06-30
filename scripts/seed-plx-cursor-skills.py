#!/usr/bin/env python3
"""One-time / refresh seed: copy allowlisted skills into plx-cursor-skills layout + manifest."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


def parse_frontmatter(path: Path) -> dict[str, str]:
    raw = path.read_text(encoding="utf-8")
    if not raw.startswith("---"):
        return {}
    end = raw.find("\n---", 3)
    if end == -1:
        return {}
    block = raw[4:end]
    out: dict[str, str] = {}
    for line in block.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        out[key.strip()] = value.strip().strip('"')
    return out


TAGS_BY_PREFIX: dict[str, list[str]] = {
    "project-": ["project-lifecycle"],
    "review-": ["quality", "review"],
    "create-": ["meta", "tooling"],
    "ui-ux": ["design"],
    "taste": ["design"],
    "vmc-": ["vmc", "integration"],
    "wterm": ["ci", "git"],
    "uat": ["quality", "testing"],
    "reliable": ["quality", "tdd"],
    "root-cause": ["debugging"],
    "codebase": ["debugging", "investigation"],
    "dead-code": ["cleanup"],
    "safe-deletion": ["cleanup"],
    "split-to": ["git", "workflow"],
    "claude-code": ["context"],
    "migrate-to": ["meta"],
    "autonomous": ["verification"],
    "quality": ["quality"],
    "isomorphic": ["refactoring"],
    "pre-plan": ["planning"],
    "automate": ["workflow"],
    "babysit": ["workflow"],
    "canvas": ["workflow", "artifacts"],
}


def infer_tags(skill_id: str) -> list[str]:
    for prefix, tags in TAGS_BY_PREFIX.items():
        if skill_id.startswith(prefix) or skill_id == prefix.rstrip("-"):
            return tags
    return ["engineering"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--allowlist",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "config" / "company-skills-allowlist.json",
    )
    parser.add_argument(
        "--swarm-root",
        type=Path,
        default=Path.home() / "agentic-swarm",
        help="Local agentic-swarm checkout (skills read from .cursor/skills/)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path.home() / "plx-cursor-skills",
        help="Output plx-cursor-skills repo root",
    )
    parser.add_argument("--version", default="1.0.0")
    parser.add_argument("--git-ref", default="", help="Commit SHA (fill after first commit if empty)")
    args = parser.parse_args()

    allowlist = json.loads(args.allowlist.read_text(encoding="utf-8"))
    skill_ids: list[str] = allowlist.get("skills") or []
    if not skill_ids:
        print("error: allowlist has no skills", file=sys.stderr)
        return 2

    swarm_skills = args.swarm_root / ".cursor" / "skills"
    out_skills = args.out / "skills"
    out_skills.mkdir(parents=True, exist_ok=True)

    imported_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    manifest_skills = []

    for sid in skill_ids:
        src = swarm_skills / sid
        dst = out_skills / sid
        skill_md = src / "SKILL.md"
        if not skill_md.is_file():
            print(f"error: missing {skill_md}", file=sys.stderr)
            return 1
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
        fm = parse_frontmatter(skill_md)
        manifest_skills.append(
            {
                "id": sid,
                "name": fm.get("name") or sid,
                "description": (fm.get("description") or "")[:1024],
                "status": "published",
                "tier": "company",
                "contentPath": f"skills/{sid}/",
                "runtimes": ["cursor", "claude"],
                "tags": infer_tags(sid),
                "owner": "ops@petralabx.com",
                "sourceProvenance": {
                    "repo": allowlist.get("sourceRepo", "taylorvalton/agentic-swarm"),
                    "ref": allowlist.get("sourceBranch", "main"),
                    "path": f".cursor/skills/{sid}/",
                    "importedAt": imported_at,
                },
            }
        )
        print(f"  copied {sid}")

    manifest = {
        "schemaVersion": "plx-cursor-skills-manifest/v1",
        "version": args.version,
        "publishedAt": imported_at,
        "gitRef": args.git_ref or "0000000000000000000000000000000000000000",
        "repo": "taylorvalton/plx-cursor-skills",
        "defaultBranch": "main",
        "maintainers": ["ops@petralabx.com"],
        "packages": [
            {
                "id": "plx-engineering-core",
                "name": "PLX Engineering Core",
                "description": "Default bundle for PLX_MC and portal contributors.",
                "skillIds": skill_ids,
            }
        ],
        "skills": manifest_skills,
    }

    schema_src = args.allowlist.parent.parent / "docs" / "plx-cursor-skills" / "manifest.schema.json"
    schemas_dir = args.out / "schemas"
    schemas_dir.mkdir(parents=True, exist_ok=True)
    if schema_src.is_file():
        shutil.copy2(schema_src, schemas_dir / "manifest.schema.json")

    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote manifest.json ({len(manifest_skills)} skills) -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
