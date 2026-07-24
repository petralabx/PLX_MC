"""Unit tests for plx-ds-prepare-adopt / record-decline."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PREPARE = REPO / "scripts" / "plx-ds-prepare-adopt.py"
DECLINE = REPO / "scripts" / "plx-ds-record-decline.py"


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _authority(tmp: Path, version: str = "1.0.1") -> tuple[Path, str]:
    auth = tmp / "authority"
    ds = auth / "design-system"
    fonts = ds / "fonts"
    fonts.mkdir(parents=True)
    tokens = b":root { --p-paper: #fff; }\n"
    tokens_ts = b"export const tokens = {};\n"
    font = b"font\n"
    (ds / "tokens.css").write_bytes(tokens)
    (ds / "tokens.ts").write_bytes(tokens_ts)
    (ds / "CHANGELOG.md").write_text(f"## {version}\n\n- test\n", encoding="utf-8")
    (ds / "README.md").write_text("# pkg\n", encoding="utf-8")
    (fonts / "LICENSE.txt").write_bytes(font)
    artifacts = [
        {"path": "tokens.css", "sha256": _sha(tokens)},
        {"path": "tokens.ts", "sha256": _sha(tokens_ts)},
        {"path": "fonts/LICENSE.txt", "sha256": _sha(font)},
    ]
    integrity = (
        "sha256-"
        + hashlib.sha256("\n".join(a["sha256"] for a in artifacts).encode()).hexdigest()
    )
    (ds / "manifest.json").write_text(
        json.dumps(
            {
                "name": "plx-design-system",
                "version": version,
                "channel": "staging",
                "sourceCommit": "abc",
                "authority": "petralabx/plx-customer-portal",
                "artifacts": artifacts,
                "integrity": integrity,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (auth / "portal/src/styles").mkdir(parents=True)
    (auth / "portal/src/styles/brand-tokens.css").write_bytes(
        b"/* runtime */\n:root { --p-paper: #fff; }\n"
    )
    return auth, integrity


def _mc(tmp: Path) -> Path:
    mc = tmp / "mc"
    (mc / "docs/design-system").mkdir(parents=True)
    (mc / "src/styles").mkdir(parents=True)
    (mc / "public/fonts/mazius").mkdir(parents=True)
    (mc / "design-system").mkdir(parents=True)
    (mc / "config").mkdir(parents=True)
    (mc / "plx-brand.json").write_text(
        json.dumps(
            {
                "schemaVersion": "plx-brand/v1",
                "repoKind": "operational",
                "brand": {"slug": "plx", "displayName": "PLX"},
                "designSystem": {
                    "adoptsPlxTokens": True,
                    "authority": "petralabx/plx-customer-portal",
                    "channel": "staging",
                    "pinnedVersion": "1.0.0",
                    "pinnedIntegrity": "sha256-" + ("a" * 64),
                    "tokenPrefix": "--p-",
                    "boundaryClass": "brand-plx",
                    "decidedBy": "vince",
                    "decidedAt": "2026-07-24",
                    "rationale": "test fixture for adopt prepare.",
                },
                "mc": {"github": "petralabx/PLX_MC", "registryId": "plx"},
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (mc / "design-system/SYNC-LOG.md").write_text("# log\n", encoding="utf-8")
    (mc / "docs/design-system/tokens.css").write_text("old\n", encoding="utf-8")
    (mc / "docs/design-system/tokens.ts").write_text("old\n", encoding="utf-8")
    (mc / "src/styles/brand-tokens.css").write_text("old\n", encoding="utf-8")
    return mc


def test_prepare_bumps_pin(tmp_path):
    auth, integrity = _authority(tmp_path)
    mc = _mc(tmp_path)
    result = subprocess.run(
        [
            sys.executable,
            str(PREPARE),
            "--authority-root",
            str(auth),
            "--version",
            "1.0.1",
            "--integrity",
            integrity,
            "--repo-root",
            str(mc),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    brand = json.loads((mc / "plx-brand.json").read_text(encoding="utf-8"))
    assert brand["designSystem"]["pinnedVersion"] == "1.0.1"
    assert brand["designSystem"]["pinnedIntegrity"] == integrity
    assert "PENDING" in (mc / "design-system/SYNC-LOG.md").read_text(encoding="utf-8")


def test_prepare_skips_same_pin(tmp_path):
    auth, integrity = _authority(tmp_path, version="1.0.0")
    mc = _mc(tmp_path)
    brand = json.loads((mc / "plx-brand.json").read_text(encoding="utf-8"))
    brand["designSystem"]["pinnedVersion"] = "1.0.0"
    brand["designSystem"]["pinnedIntegrity"] = integrity
    (mc / "plx-brand.json").write_text(
        json.dumps(brand, indent=2) + "\n", encoding="utf-8"
    )
    result = subprocess.run(
        [
            sys.executable,
            str(PREPARE),
            "--authority-root",
            str(auth),
            "--version",
            "1.0.0",
            "--integrity",
            integrity,
            "--repo-root",
            str(mc),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "skip:" in result.stdout


def test_record_decline_flips_pending(tmp_path):
    mc = _mc(tmp_path)
    (mc / "design-system/SYNC-LOG.md").write_text(
        "# log\n\n## 1.0.0 → v1.0.1   (2026-07-24)\n- decision: **PENDING** — human\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        [
            sys.executable,
            str(DECLINE),
            "--version",
            "1.0.1",
            "--reason",
            "defer",
            "--repo-root",
            str(mc),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    text = (mc / "design-system/SYNC-LOG.md").read_text(encoding="utf-8")
    assert "DECLINED" in text
    assert "PENDING" not in text
