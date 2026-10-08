"""Provisioning plan for the ToDos CompletedAt column (offline, mocked Graph)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "provision-sharepoint.py"
SCHEMA = json.loads((REPO_ROOT / "config" / "sharepoint-schema.json").read_text("utf-8"))


def _load():
    spec = importlib.util.spec_from_file_location("provision_sharepoint", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


prov = _load()
TODOS = next(s for s in SCHEMA["lists"] if s["key"] == "todos")
COMPLETED_AT = next(c for c in TODOS["columns"] if c["name"] == "CompletedAt")


class FakeGraph:
    def __init__(self, existing: list[dict]):
        self.existing = existing
        self.posts: list[tuple[str, dict]] = []
        self.patches: list[tuple[str, dict]] = []

    def get(self, url, ok404=False):
        return {"value": self.existing}

    def post(self, url, body):
        self.posts.append((url, body))

    def patch(self, url, body):
        self.patches.append((url, body))


def _ensure(g, apply=True):
    prov.ensure_columns(g, "site", "list", {"displayName": "ToDos", "columns": [COMPLETED_AT]}, {}, apply)


def test_schema_declares_completed_at_exactly():
    assert COMPLETED_AT["type"] == "dateTime"
    assert COMPLETED_AT["includeTime"] is True
    assert COMPLETED_AT["required"] is False
    assert COMPLETED_AT["hidden"] is True
    assert "default" not in COMPLETED_AT and "defaultValue" not in COMPLETED_AT


def test_no_task_2529_columns_or_status_change():
    names = {c["name"] for c in TODOS["columns"]}
    assert not names & {"Cancelled", "CancelReason", "ReplacedBy", "CancelledAt"}


def test_create_plan_is_datetime_with_time_optional_no_default_hidden():
    g = FakeGraph([])
    _ensure(g)
    (_, body), = g.posts
    assert body["dateTime"]["format"] == "dateTime"
    assert body["required"] is False
    assert body["hidden"] is True
    assert "defaultValue" not in body


def test_other_date_columns_unchanged():
    other = {"name": "X", "displayName": "X", "type": "dateTime"}
    body = prov.column_definition(other, {})
    assert body["dateTime"]["format"] == "dateTime"
    assert "hidden" not in body


def test_existing_old_definition_is_updated():
    old = {"id": "c14", "name": "CompletedAt", "displayName": "Completed At",
           "required": False, "dateTime": {"format": "dateOnly"}, "defaultValue": {"value": "[today]"}}
    g = FakeGraph([old])
    _ensure(g)
    assert not g.posts
    (url, body), = g.patches
    assert url.endswith("/columns/c14")
    assert body["dateTime"]["format"] == "dateTime"
    assert body["hidden"] is True and body["required"] is False
    assert body["defaultValue"] is None


def test_existing_matching_definition_is_left_alone_and_dry_run_never_writes():
    good = {"id": "c14", "name": "CompletedAt", "displayName": "Completed At",
            "required": False, "hidden": True, "dateTime": {"format": "dateTime"}}
    g = FakeGraph([good])
    _ensure(g)
    assert not g.posts and not g.patches
    stale = {**good, "hidden": False}
    g = FakeGraph([stale])
    _ensure(g, apply=False)
    assert not g.posts and not g.patches
