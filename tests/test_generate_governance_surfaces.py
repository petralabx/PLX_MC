"""Handshake surfaces of generate-governance-surfaces.py (TASK-4348).

The contract's handshake renders into both MCP servers' modules and, with
--fleet, into a marked block in each tracked repo checked out beside PLX_MC.
These tests pin the drift checks: a stale block fails --check, adoption replaces
only a hand-written handshake section, and nothing is appended blindly.
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "gen_surfaces", ROOT / "scripts" / "generate-governance-surfaces.py"
)
gen = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(gen)

HANDWRITTEN = """# CLAUDE.md

Intro stays.

## Mission Control handshake (Claude Code and every agent)

1. Old step that says to ask CIP to close and reopen.

## Workstream protocol

Workstream text stays.
"""


@pytest.fixture()
def handshake() -> dict:
    return gen.load_contract()["handshake"]


@pytest.fixture()
def repos() -> dict:
    return gen.load_registry()


def make_repo(parent: Path, name: str, files: dict[str, str]) -> Path:
    root = parent / name
    root.mkdir()
    for rel, text in files.items():
        (root / rel).write_text(text, encoding="utf-8")
    return root


def test_committed_mcp_modules_match_the_contract(handshake: dict, repos: dict) -> None:
    for rel in handshake["surfaces"]["mcp_modules"]:
        expected = gen.render_mcp_module(
            handshake, repos, typescript=rel.endswith(".ts")
        )
        assert (ROOT / rel).read_text(encoding="utf-8") == expected, (
            f"{rel} drifted: run the generator"
        )


def test_every_registry_repo_gets_a_complete_block(
    handshake: dict, repos: dict
) -> None:
    for slug, info in repos.items():
        block = gen.render_fleet_block(handshake, slug, info)
        assert not re.search(r"\{[a-z_]+\}", block), slug
        assert block.startswith(gen.HANDSHAKE_START) and block.endswith(
            gen.HANDSHAKE_END
        )
        assert f"mc_create_task in {info['default_bucket']}" in block
        assert len(re.findall(r"^\d+\. ", block, re.M)) == len(handshake["steps"])


def test_fleet_adopts_a_handwritten_section_then_checks_clean(
    tmp_path: Path, handshake: dict, repos: dict
) -> None:
    root = make_repo(
        tmp_path, "furgenics", {"CLAUDE.md": HANDWRITTEN, "AGENTS.md": HANDWRITTEN}
    )

    assert gen.fleet(handshake, repos, tmp_path, check_mode=False) == 0
    text = (root / "CLAUDE.md").read_text(encoding="utf-8")
    assert "Old step that says" not in text
    assert (
        gen.render_fleet_block(
            handshake, "petralabx/furgenics", repos["petralabx/furgenics"]
        )
        in text
    )
    assert text.startswith("# CLAUDE.md\n\nIntro stays.\n\n")
    assert "## Workstream protocol\n\nWorkstream text stays.\n" in text

    assert gen.fleet(handshake, repos, tmp_path, check_mode=True) == 0
    # A second write changes nothing.
    assert gen.fleet(handshake, repos, tmp_path, check_mode=False) == 0
    assert (root / "CLAUDE.md").read_text(encoding="utf-8") == text


def test_fleet_check_fails_on_a_stale_block(
    tmp_path: Path, handshake: dict, repos: dict
) -> None:
    root = make_repo(tmp_path, "local-inference", {"AGENTS.md": HANDWRITTEN})
    assert gen.fleet(handshake, repos, tmp_path, check_mode=False) == 0
    path = root / "AGENTS.md"
    path.write_text(
        path.read_text(encoding="utf-8").replace(
            "re-run the failed compliance job", "ask CIP to close and reopen"
        ),
        encoding="utf-8",
    )

    assert gen.fleet(handshake, repos, tmp_path, check_mode=True) == 1
    assert gen.fleet(handshake, repos, tmp_path, check_mode=False) == 0
    assert gen.fleet(handshake, repos, tmp_path, check_mode=True) == 0


def test_fleet_check_only_notes_a_repo_that_has_not_adopted_yet(
    tmp_path: Path, handshake: dict, repos: dict
) -> None:
    root = make_repo(tmp_path, "for-and-against", {"CLAUDE.md": HANDWRITTEN})
    assert gen.fleet(handshake, repos, tmp_path, check_mode=True) == 0
    assert (root / "CLAUDE.md").read_text(encoding="utf-8") == HANDWRITTEN


def test_fleet_never_appends_to_a_file_without_a_handshake(
    tmp_path: Path, handshake: dict, repos: dict
) -> None:
    text = "# AGENTS.md\n\n## CI / Mission Control handshake\n\nPortal-specific text.\n"
    root = make_repo(tmp_path, "plx-customer-portal", {"AGENTS.md": text})
    assert gen.fleet(handshake, repos, tmp_path, check_mode=False) == 0
    assert (root / "AGENTS.md").read_text(encoding="utf-8") == text


def test_fleet_leaves_the_hub_alone(
    tmp_path: Path, handshake: dict, repos: dict
) -> None:
    root = make_repo(tmp_path, "PLX_MC", {"CLAUDE.md": HANDWRITTEN})
    assert gen.fleet(handshake, repos, tmp_path, check_mode=False) == 0
    assert (root / "CLAUDE.md").read_text(encoding="utf-8") == HANDWRITTEN
