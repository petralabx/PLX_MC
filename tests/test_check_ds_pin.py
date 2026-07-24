"""Exit-code behavior for the ADR-005 design-system pin gate."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GATE = REPO_ROOT / "scripts" / "check-ds-pin.py"


def _sha256(data: bytes) -> str:
    data = data.replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def _run(repo_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GATE), "--repo-root", str(repo_root)],
        capture_output=True,
        text=True,
    )


def _write_adopting_fixture(root: Path, *, integrity: str | None = None) -> str:
    tokens = b":root { --p-paper: #FBF9F5; }\n"
    tokens_ts = b"export const tokens = {};\n"
    font = b"font-bytes\n"
    artifacts = [
        {"path": "tokens.css", "sha256": _sha256(tokens)},
        {"path": "tokens.ts", "sha256": _sha256(tokens_ts)},
        {"path": "fonts/LICENSE.txt", "sha256": _sha256(font)},
    ]
    hashes = [a["sha256"] for a in artifacts]
    actual_integrity = (
        "sha256-" + hashlib.sha256("\n".join(hashes).encode()).hexdigest()
    )
    if integrity is None:
        integrity = actual_integrity

    brand = {
        "schemaVersion": "plx-brand/v1",
        "repoKind": "operational",
        "brand": {"slug": "plx", "displayName": "Petra Lab-X"},
        "designSystem": {
            "adoptsPlxTokens": True,
            "authority": "petralabx/plx-customer-portal",
            "channel": "staging",
            "pinnedVersion": "1.0.0",
            "pinnedIntegrity": integrity,
            "tokenPrefix": "--p-",
            "boundaryClass": "brand-plx",
            "decidedBy": "vince",
            "decidedAt": "2026-07-24",
            "rationale": "Test fixture for pin gate.",
        },
        "mc": {"github": "petralabx/PLX_MC", "registryId": "plx-mission-control"},
    }
    (root / "plx-brand.json").write_text(
        json.dumps(brand, indent=2) + "\n", encoding="utf-8"
    )

    ds = root / "design-system"
    ds.mkdir(parents=True)
    (ds / "tokens.css").write_bytes(tokens)
    (ds / "tokens.ts").write_bytes(tokens_ts)
    (ds / "fonts").mkdir()
    (ds / "fonts/LICENSE.txt").write_bytes(font)
    (ds / "manifest.json").write_text(
        json.dumps(
            {
                "name": "plx-design-system",
                "version": "1.0.0",
                "integrity": actual_integrity,
                "artifacts": artifacts,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    (root / "docs/design-system").mkdir(parents=True)
    (root / "docs/design-system/tokens.css").write_bytes(tokens)
    (root / "docs/design-system/tokens.ts").write_bytes(tokens_ts)
    (root / "public/fonts/mazius").mkdir(parents=True)
    (root / "public/fonts/mazius/LICENSE.txt").write_bytes(font)
    return actual_integrity


def test_exit_0_when_no_plx_brand_json(tmp_path):
    assert _run(tmp_path).returncode == 0


def test_exit_0_when_pin_matches(tmp_path):
    _write_adopting_fixture(tmp_path)
    result = _run(tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "design-system pin clean" in result.stdout


def test_exit_1_on_mirror_drift(tmp_path):
    _write_adopting_fixture(tmp_path)
    (tmp_path / "docs/design-system/tokens.css").write_bytes(
        b":root { --p-paper: #000; }\n"
    )
    result = _run(tmp_path)
    assert result.returncode == 1
    assert "mirror drift" in result.stdout


def test_exit_1_on_pin_integrity_mismatch(tmp_path):
    _write_adopting_fixture(
        tmp_path,
        integrity="sha256-" + ("0" * 64),
    )
    result = _run(tmp_path)
    assert result.returncode == 1
    assert "pin integrity drift" in result.stdout
