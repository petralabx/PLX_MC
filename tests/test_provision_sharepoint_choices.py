"""TASK-2529: provision-sharepoint.py appends missing choices (ToDos Status 'Cancelled')
to an existing choice column and never removes one. Offline: Graph is a fake."""

import importlib.util
import json
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load():
    # The script imports requests at module load; the helpers under test never use it.
    sys.modules.setdefault("requests", types.ModuleType("requests"))
    spec = importlib.util.spec_from_file_location(
        "provision_sharepoint", ROOT / "scripts" / "provision-sharepoint.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


mod = _load()


class FakeGraph:
    def __init__(self):
        self.patches = []

    def patch(self, url, body):
        self.patches.append((url, body))


def _status_column(schema):
    todos = next(spec for spec in schema["lists"] if spec["key"] == "todos")
    return todos, next(c for c in todos["columns"] if c["name"] == "Status")


def test_schema_declares_cancelled_and_cancel_columns():
    schema = json.loads(
        (ROOT / "config" / "sharepoint-schema.json").read_text(encoding="utf-8")
    )
    todos, status = _status_column(schema)
    assert status["choices"][-1] == "Cancelled"
    names = {c["name"]: c for c in todos["columns"]}
    assert names["CancelReason"]["choices"] == [
        "Duplicate",
        "Obsolete",
        "Superseded",
        "Delivered without PR",
    ]
    assert names["ReplacedBy"]["type"] == "text"


def test_merged_choices_appends_only_missing_and_keeps_order():
    assert mod.merged_choices(["A", "B", "Extra"], ["A", "B", "C"]) == [
        "A",
        "B",
        "Extra",
        "C",
    ]


def test_dry_run_reports_missing_choice_without_writing(capsys):
    schema = json.loads(
        (ROOT / "config" / "sharepoint-schema.json").read_text(encoding="utf-8")
    )
    todos, status = _status_column(schema)
    existing = [
        {
            "id": "c1",
            "name": "Status",
            "displayName": "Status",
            "choice": {"choices": status["choices"][:-1], "displayAs": "dropDownMenu"},
        }
    ]
    g = FakeGraph()
    mod.ensure_choices(g, "site", "list", todos, status, existing, apply=False)
    assert g.patches == []
    assert "Cancelled" in capsys.readouterr().out


def test_apply_patches_the_column_once_with_existing_choices_preserved():
    schema = json.loads(
        (ROOT / "config" / "sharepoint-schema.json").read_text(encoding="utf-8")
    )
    todos, status = _status_column(schema)
    have = status["choices"][:-1]
    existing = [
        {
            "id": "c1",
            "name": "Status",
            "displayName": "Status",
            "choice": {"choices": have, "displayAs": "dropDownMenu"},
        }
    ]
    g = FakeGraph()
    mod.ensure_choices(g, "site", "list", todos, status, existing, apply=True)
    assert len(g.patches) == 1
    url, body = g.patches[0]
    assert url.endswith("/lists/list/columns/c1")
    assert body["choice"]["choices"] == status["choices"]
    assert body["choice"]["displayAs"] == "dropDownMenu"


def test_no_patch_when_choices_already_present():
    schema = json.loads(
        (ROOT / "config" / "sharepoint-schema.json").read_text(encoding="utf-8")
    )
    todos, status = _status_column(schema)
    existing = [
        {
            "id": "c1",
            "name": "Status",
            "displayName": "Status",
            "choice": {"choices": list(status["choices"])},
        }
    ]
    g = FakeGraph()
    mod.ensure_choices(g, "site", "list", todos, status, existing, apply=True)
    assert g.patches == []
