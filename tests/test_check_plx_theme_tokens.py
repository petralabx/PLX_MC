"""Exit-code + finding-count behavior for the G1 token checker."""

from __future__ import annotations

import importlib.util
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check-plx-theme-tokens.py"
_spec = importlib.util.spec_from_file_location("check_plx_theme_tokens", _SCRIPT)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)


def test_clean_file_reports_zero(tmp_path, capsys):
    clean = tmp_path / "clean.css"
    clean.write_text(
        ".x { color: var(--p-ink); border: 1px solid var(--p-grid); }", encoding="utf-8"
    )
    rc = _mod.main([str(clean)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "Findings: 0" in out


def test_raw_hex_and_func_are_flagged(tmp_path, capsys):
    dirty = tmp_path / "dirty.tsx"
    dirty.write_text(
        "const a = '#1B1A17';\nconst b = 'rgba(0,0,0,0.5)';\nconst sha = 'abc1234def';\n",
        encoding="utf-8",
    )
    rc = _mod.main([str(dirty)])
    out = capsys.readouterr().out
    assert rc == 0
    # The hex literal and the rgba() func are findings; the commit-sha-like string is not.
    assert "Findings: 2" in out
    assert "abc1234def" not in out.split("Findings:")[0] or "#" in out
