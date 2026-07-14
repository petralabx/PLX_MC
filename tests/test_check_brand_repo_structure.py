"""Exit-code behavior for the marketing-brand structure gate."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GATE = REPO_ROOT / "scripts" / "check-brand-repo-structure.py"


def _run(repo_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GATE), "--repo-root", str(repo_root)],
        capture_output=True,
        text=True,
    )


def _write_marketing_fixture(
    root: Path, *, slug: str, prefix: str, boundary: str
) -> None:
    (root / "README.md").write_text("# Brand\n", encoding="utf-8")
    (root / "AGENTS.md").write_text("# Agents\n", encoding="utf-8")
    manifest = {
        "schemaVersion": "plx-brand/v1",
        "repoKind": "marketing-brand",
        "brand": {"slug": slug, "displayName": "Test Brand"},
        "designSystem": {
            "adoptsPlxTokens": False,
            "tokenPrefix": prefix,
            "boundaryClass": boundary,
            "decidedBy": "vince",
            "decidedAt": "2026-06-30",
            "rationale": "Test fixture for structure gate.",
        },
        "mc": {"github": f"taylorvalton/{slug}", "registryId": slug},
    }
    (root / "plx-brand.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    ds = root / "docs/design-system"
    ds.mkdir(parents=True)
    (ds / "README.md").write_text("# DS\n", encoding="utf-8")
    (ds / "tokens.css").write_text(
        f".{boundary} {{ {prefix}ink: #111; }}\n", encoding="utf-8"
    )
    (ds / "tokens.ts").write_text("export const tokens = {};\n", encoding="utf-8")
    (ds / "REFERENCE.md").write_text("# Ref\n", encoding="utf-8")
    (ds / "COMPONENT-INVENTORY.md").write_text("# Inv\n", encoding="utf-8")
    (ds / "CONTRIBUTING.md").write_text("# Contrib\n", encoding="utf-8")
    decisions = ds / "decisions"
    decisions.mkdir()
    (decisions / "ADR-001-vocabulary.md").write_text("# ADR\n", encoding="utf-8")

    mod = root / "docs/modules/design-system"
    mod.mkdir(parents=True)
    (mod / "README.md").write_text("# Module\n", encoding="utf-8")


def test_exit_0_when_no_plx_brand_json(tmp_path):
    assert _run(tmp_path).returncode == 0


def test_exit_0_on_valid_marketing_fixture(tmp_path):
    _write_marketing_fixture(
        tmp_path, slug="furgenics", prefix="--fg-", boundary="brand-furgenics"
    )
    result = _run(tmp_path)
    assert result.returncode == 0
    assert "brand repo structure clean" in result.stdout


def test_exit_0_on_digit_leading_prefix(tmp_path):
    # Digit-leading brands (e.g. "1HR-After" -> --1hr-) are valid: --1hr- is
    # legal CSS and boundaryClass already permits digits.
    _write_marketing_fixture(
        tmp_path, slug="1hr-after", prefix="--1hr-", boundary="brand-1hr-after"
    )
    result = _run(tmp_path)
    assert result.returncode == 0
    assert "brand repo structure clean" in result.stdout


def test_exit_1_when_plx_tokens_defined(tmp_path):
    _write_marketing_fixture(
        tmp_path, slug="furgenics", prefix="--fg-", boundary="brand-furgenics"
    )
    tokens = tmp_path / "docs/design-system/tokens.css"
    tokens.write_text(
        tokens.read_text(encoding="utf-8") + "\n--p-paper: #fff;\n", encoding="utf-8"
    )
    result = _run(tmp_path)
    assert result.returncode == 1
    assert "--p-paper" in result.stdout


def test_exit_1_when_required_file_missing(tmp_path):
    _write_marketing_fixture(
        tmp_path, slug="1hr-after", prefix="--1hr-", boundary="brand-1hr-after"
    )
    (tmp_path / "docs/design-system/CONTRIBUTING.md").unlink()
    result = _run(tmp_path)
    assert result.returncode == 1
    assert "CONTRIBUTING.md" in result.stdout


def test_exit_1_on_invalid_json(tmp_path):
    (tmp_path / "plx-brand.json").write_text("{not json", encoding="utf-8")
    assert _run(tmp_path).returncode == 1
