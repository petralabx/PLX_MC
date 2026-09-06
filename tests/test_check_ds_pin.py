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


def _write_adopting_fixture(
    root: Path, *, integrity: str | None = None, with_desktop: bool = False
) -> str:
    tokens = b":root { --p-paper: #FBF9F5; }\n"
    tokens_ts = b"export const tokens = {};\n"
    font = b"font-bytes\n"
    desktop_font = b"desktop-ttf-bytes\n"
    artifacts = [
        {"path": "tokens.css", "sha256": _sha256(tokens)},
        {"path": "tokens.ts", "sha256": _sha256(tokens_ts)},
        {"path": "fonts/LICENSE.txt", "sha256": _sha256(font)},
    ]
    if with_desktop:
        # v1.4.0 added desktop-install cuts under fonts/desktop/.
        artifacts.append(
            {
                "path": "fonts/desktop/Inter-Regular.ttf",
                "sha256": _sha256(desktop_font),
            }
        )
        artifacts.append(
            {
                "path": "fonts/desktop/install-plx-fonts.ps1",
                "sha256": _sha256(desktop_font),
            }
        )
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


def _write_desktop_cut(root: Path, name: str = "Inter-Regular.ttf") -> None:
    """Vendor one desktop cut into the consumer package tree."""
    desktop = root / "design-system/fonts/desktop"
    desktop.mkdir(parents=True, exist_ok=True)
    (desktop / name).write_bytes(b"desktop-ttf-bytes\n")


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


def test_desktop_cuts_are_not_required(tmp_path):
    """A web consumer pins v1.4.0 without vendoring 2.9 MB of desktop fonts."""
    _write_adopting_fixture(tmp_path, with_desktop=True)
    result = _run(tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "missing pinned artifact" not in result.stdout


def test_desktop_cuts_never_demand_a_public_mirror(tmp_path):
    """Vendoring a desktop cut must not require serving it from public/.

    The old rule matched every path starting with 'fonts/', so a vendored
    fonts/desktop/install-plx-fonts.ps1 was demanded at
    public/fonts/mazius/install-plx-fonts.ps1 — a PowerShell script in the
    web root.
    """
    _write_adopting_fixture(tmp_path, with_desktop=True)
    _write_desktop_cut(tmp_path)
    _write_desktop_cut(tmp_path, "install-plx-fonts.ps1")
    result = _run(tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "missing consumer mirror" not in result.stdout
    assert not (tmp_path / "public/fonts/mazius/install-plx-fonts.ps1").exists()


def test_vendored_desktop_cut_still_hash_checked(tmp_path):
    """Opting in to a desktop cut opts in to its hash. Presence is optional;
    correctness is not."""
    _write_adopting_fixture(tmp_path, with_desktop=True)
    _write_desktop_cut(tmp_path)
    (tmp_path / "design-system/fonts/desktop/Inter-Regular.ttf").write_bytes(
        b"tampered\n"
    )
    result = _run(tmp_path)
    assert result.returncode == 1
    assert "drift: design-system/fonts/desktop/Inter-Regular.ttf" in result.stdout


def test_web_font_mirror_still_required(tmp_path):
    """Scoping the rule must not weaken it for web fonts."""
    _write_adopting_fixture(tmp_path)
    (tmp_path / "public/fonts/mazius/LICENSE.txt").unlink()
    result = _run(tmp_path)
    assert result.returncode == 1
    assert "missing consumer mirror: public/fonts/mazius/LICENSE.txt" in result.stdout
