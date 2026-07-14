"""Exit-code behavior for the brand portal parity gate."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GATE = REPO_ROOT / "scripts" / "check-brand-portal-parity.py"
SYNC = REPO_ROOT / "scripts" / "sync-brand-from-portal.sh"
MANIFEST = REPO_ROOT / "config" / "brand-portal-parity.json"


def _sha256(path: Path) -> str:
    data = path.read_bytes()
    if path.suffix.lower() in {
        ".css",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".json",
        ".md",
        ".txt",
        ".svg",
    }:
        data = data.replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def _run_gate(repo_root: Path, manifest: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(GATE),
            "--repo-root",
            str(repo_root),
            "--manifest",
            str(manifest),
        ],
        capture_output=True,
        text=True,
    )


def test_exit_0_when_manifest_matches(tmp_path):
    repo = tmp_path / "mc"
    repo.mkdir()
    artifact = repo / "docs/design-system/tokens.css"
    artifact.parent.mkdir(parents=True)
    # Explicit LF bytes — Path.write_text may emit CRLF on Windows.
    artifact.write_bytes(b":root { --p-paper: #FBF9F5; }\n")
    manifest = repo / "config/brand-portal-parity.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text(
        json.dumps(
            {
                "schemaVersion": "plx-brand-parity/v1",
                "portalCommit": "abc1234",
                "files": [
                    {
                        "path": "docs/design-system/tokens.css",
                        "sha256": _sha256(artifact),
                    }
                ],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    result = _run_gate(repo, manifest)
    assert result.returncode == 0
    assert "brand portal parity clean" in result.stdout


def test_exit_1_on_checksum_mismatch(tmp_path):
    repo = tmp_path / "mc"
    repo.mkdir()
    artifact = repo / "src/styles/brand-tokens.css"
    artifact.parent.mkdir(parents=True)
    artifact.write_bytes(b"drifted\n")
    manifest = repo / "config/brand-portal-parity.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text(
        json.dumps(
            {
                "portalCommit": "abc1234",
                "files": [{"path": "src/styles/brand-tokens.css", "sha256": "0" * 64}],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    result = _run_gate(repo, manifest)
    assert result.returncode == 1
    assert "drift" in result.stderr


def test_committed_manifest_passes_in_repo():
    if not MANIFEST.is_file():
        return
    result = _run_gate(REPO_ROOT, MANIFEST)
    assert result.returncode == 0, result.stderr


def test_sync_script_exists_and_executable():
    assert SYNC.is_file()
    # Windows checkout has no Unix exec bit; require it only on POSIX.
    if sys.platform != "win32":
        assert oct(SYNC.stat().st_mode)[-3:] in {"755", "775", "777"}


def test_default_repo_root_self_resolves_independent_of_cwd(tmp_path):
    """Default --repo-root uses __file__, so a foreign cwd still finds the manifest."""
    result = subprocess.run(
        [sys.executable, str(GATE)],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "brand portal parity clean" in result.stdout


def test_repo_root_default_is_not_cwd():
    import importlib.util

    spec = importlib.util.spec_from_file_location("check_brand_portal_parity", GATE)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    assert module.DEFAULT_REPO_ROOT == REPO_ROOT
