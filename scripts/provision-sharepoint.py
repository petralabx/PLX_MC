#!/usr/bin/env python3
"""Provision the PLX Mission Control SharePoint site from config/sharepoint-schema.json.

Idempotent: safe to re-run; existing site/lists/columns/folders are left alone
and only missing pieces are created. Nothing mutates without --apply.

Usage:
    python scripts/provision-sharepoint.py                  # dry-run against staging
    python scripts/provision-sharepoint.py --apply          # create missing pieces (staging)
    python scripts/provision-sharepoint.py --verify         # read back + diff against the schema
    python scripts/provision-sharepoint.py --env production --apply

Auth: client-credentials from MICROSOFT_GRAPH_TENANT_ID / _CLIENT_ID /
_CLIENT_SECRET (loaded by ~/load-secrets.ps1 from AWS Secrets Manager).
Site creation uses the Graph beta create-site API (requires Sites.Create.All);
everything else is Graph v1.0.

Exit codes: 0 — clean / verified; 1 — error or verification drift.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "config" / "sharepoint-schema.json"
GRAPH = "https://graph.microsoft.com/v1.0"
GRAPH_BETA = "https://graph.microsoft.com/beta"


def fail(msg: str) -> "sys.NoReturn":
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def get_token() -> str:
    tenant = os.environ.get("MICROSOFT_GRAPH_TENANT_ID")
    client = os.environ.get("MICROSOFT_GRAPH_CLIENT_ID")
    secret = os.environ.get("MICROSOFT_GRAPH_CLIENT_SECRET")
    if not (tenant and client and secret):
        fail("MICROSOFT_GRAPH_* env vars missing — run the secrets loader first")
    resp = requests.post(
        f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
        data={
            "client_id": client,
            "client_secret": secret,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        },
        timeout=30,
    )
    if resp.status_code != 200:
        fail(f"token request failed: {resp.status_code} {resp.text[:300]}")
    return resp.json()["access_token"]


class Graph:
    def __init__(self, token: str):
        self.s = requests.Session()
        self.s.headers.update({"Authorization": f"Bearer {token}"})

    def get(self, url: str, ok404: bool = False) -> dict[str, Any] | None:
        r = self.s.get(url, timeout=60)
        if r.status_code == 404 and ok404:
            return None
        if r.status_code >= 400:
            fail(f"GET {url} -> {r.status_code} {r.text[:300]}")
        return r.json()

    def post(self, url: str, body: dict[str, Any]) -> requests.Response:
        r = self.s.post(url, json=body, timeout=60)
        if r.status_code >= 400:
            fail(f"POST {url} -> {r.status_code} {r.text[:500]}")
        return r


# ─── Column rendering: schema entry -> Graph columnDefinition ─────────────────


def column_definition(
    col: dict[str, Any], lookup_list_ids: dict[str, str]
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "name": col["name"],
        "displayName": col["displayName"],
        "indexed": bool(col.get("indexed")),
        "required": bool(col.get("required")),
        "enforceUniqueValues": bool(col.get("unique")),
    }
    ctype = col["type"]
    if ctype == "text":
        out["text"] = {}
    elif ctype == "multiline":
        out["text"] = {"allowMultipleLines": True}
    elif ctype == "choice":
        out["choice"] = {
            "allowTextEntry": False,
            "choices": col["choices"],
            "displayAs": "dropDownMenu",
        }
    elif ctype == "person":
        out["personOrGroup"] = {
            "allowMultipleSelection": False,
            "chooseFromType": "peopleOnly",
        }
    elif ctype == "dateTime":
        out["dateTime"] = {"displayAs": "default", "format": "dateTime"}
    elif ctype == "number":
        out["number"] = {"decimalPlaces": "automatic"}
    elif ctype == "boolean":
        out["boolean"] = {}
    elif ctype == "hyperlink":
        out["hyperlinkOrPicture"] = {"isPicture": False}
    elif ctype == "lookup":
        out["lookup"] = {
            "listId": lookup_list_ids[col["lookupList"]],
            "columnName": "Title",
        }
    else:
        fail(f"unknown column type in schema: {ctype}")
    return out


def column_kind(definition: dict[str, Any]) -> str:
    for kind in (
        "text",
        "choice",
        "personOrGroup",
        "dateTime",
        "number",
        "boolean",
        "hyperlinkOrPicture",
        "lookup",
    ):
        if kind in definition and definition[kind] is not None:
            return kind
    return "unknown"


# ─── Provisioning steps ───────────────────────────────────────────────────────


def ensure_site(
    g: Graph, schema: dict[str, Any], site_path: str, apply: bool
) -> str | None:
    host = schema["site"]["hostname"]
    site = g.get(f"{GRAPH}/sites/{host}:{site_path}", ok404=True)
    if site:
        print(f"  site exists: {site['webUrl']}")
        return site["id"]
    print(f"  site MISSING: https://{host}{site_path}")
    if not apply:
        return None
    body = {
        "name": schema["site"]["displayName"],
        "webUrl": f"https://{host}{site_path}",
        "locale": schema["site"]["locale"],
        "description": schema["site"]["description"],
        "template": schema["site"]["template"],
        "ownerIdentityToResolve": {"email": schema["site"]["owner"]},
    }
    resp = g.post(f"{GRAPH_BETA}/sites", body)
    print(f"  create accepted ({resp.status_code}); polling for site...")
    for _ in range(30):
        time.sleep(10)
        site = g.get(f"{GRAPH}/sites/{host}:{site_path}", ok404=True)
        if site:
            print(f"  site created: {site['webUrl']}")
            return site["id"]
    fail("site did not materialize within 5 minutes")
    return None


def existing_lists(g: Graph, site_id: str) -> dict[str, dict[str, Any]]:
    data = g.get(f"{GRAPH}/sites/{site_id}/lists?$select=id,displayName,list")
    assert data is not None
    return {item["displayName"]: item for item in data.get("value", [])}


def ensure_lists(
    g: Graph, site_id: str, schema: dict[str, Any], apply: bool
) -> dict[str, str]:
    """Create missing lists + columns. Returns schema key -> list id (where known)."""
    by_name = existing_lists(g, site_id)
    list_ids: dict[str, str] = {}
    for spec in schema["lists"]:
        name = spec["displayName"]
        if name in by_name:
            print(f"  list exists: {name}")
            list_ids[spec["key"]] = by_name[name]["id"]
        else:
            print(f"  list MISSING: {name} ({spec['template']})")
            if not apply:
                continue
            resp = g.post(
                f"{GRAPH}/sites/{site_id}/lists",
                {
                    "displayName": name,
                    "description": spec.get("description", ""),
                    "list": {"template": spec["template"]},
                },
            )
            list_ids[spec["key"]] = resp.json()["id"]
            print(f"  list created: {name}")

        if spec["key"] in list_ids:
            ensure_columns(g, site_id, list_ids[spec["key"]], spec, list_ids, apply)
    return list_ids


def ensure_columns(
    g: Graph,
    site_id: str,
    list_id: str,
    spec: dict[str, Any],
    list_ids: dict[str, str],
    apply: bool,
) -> None:
    data = g.get(
        f"{GRAPH}/sites/{site_id}/lists/{list_id}/columns?$select=name,displayName"
    )
    assert data is not None
    have = {c["name"] for c in data.get("value", [])} | {
        c["displayName"] for c in data.get("value", [])
    }
    for col in spec["columns"]:
        if col["name"] in have or col["displayName"] in have:
            print(f"    column exists: {spec['displayName']}.{col['displayName']}")
            continue
        if col["type"] == "lookup" and col["lookupList"] not in list_ids:
            print(f"    column DEFERRED (lookup target missing): {col['displayName']}")
            continue
        print(
            f"    column MISSING: {spec['displayName']}.{col['displayName']} ({col['type']})"
        )
        if not apply:
            continue
        g.post(
            f"{GRAPH}/sites/{site_id}/lists/{list_id}/columns",
            column_definition(col, list_ids),
        )
        print(f"    column created: {col['displayName']}")


def ensure_folders(g: Graph, site_id: str, schema: dict[str, Any], apply: bool) -> None:
    folders_cfg = schema["documentFolders"]
    lib_name = next(
        s["displayName"] for s in schema["lists"] if s["key"] == folders_cfg["library"]
    )
    drives = g.get(f"{GRAPH}/sites/{site_id}/drives?$select=id,name")
    assert drives is not None
    drive = next((d for d in drives.get("value", []) if d["name"] == lib_name), None)
    if not drive:
        print(f"  drive for '{lib_name}' not found (library not created yet?)")
        return

    def ensure_folder(parent_path: str, name: str) -> None:
        check = g.get(
            f"{GRAPH}/drives/{drive['id']}/root:{parent_path}/{name}", ok404=True
        )
        if check:
            print(f"    folder exists: {parent_path}/{name}")
            return
        print(f"    folder MISSING: {parent_path}/{name}")
        if not apply:
            return
        parent = (
            f"{GRAPH}/drives/{drive['id']}/root/children"
            if parent_path == ""
            else f"{GRAPH}/drives/{drive['id']}/root:{parent_path}:/children"
        )
        g.post(
            parent,
            {"name": name, "folder": {}, "@microsoft.graph.conflictBehavior": "fail"},
        )
        print(f"    folder created: {parent_path}/{name}")

    ensure_folder("", folders_cfg["shared"])
    for initiative in folders_cfg["initiatives"]:
        ensure_folder("", initiative)
        for sub in folders_cfg["perInitiative"]:
            ensure_folder(f"/{initiative}", sub)


# ─── Verification: read back and diff against the schema ─────────────────────


def verify(g: Graph, site_id: str, schema: dict[str, Any]) -> list[str]:
    problems: list[str] = []
    by_name = existing_lists(g, site_id)
    expected_lookup_kinds = {
        "text": "text",
        "multiline": "text",
        "choice": "choice",
        "person": "personOrGroup",
        "dateTime": "dateTime",
        "number": "number",
        "boolean": "boolean",
        "hyperlink": "hyperlinkOrPicture",
        "lookup": "lookup",
    }
    for spec in schema["lists"]:
        name = spec["displayName"]
        if name not in by_name:
            problems.append(f"missing list: {name}")
            continue
        template = by_name[name].get("list", {}).get("template")
        if template != spec["template"]:
            problems.append(f"{name}: template {template} != {spec['template']}")
        cols = g.get(f"{GRAPH}/sites/{site_id}/lists/{by_name[name]['id']}/columns")
        assert cols is not None
        col_by_name = {c["name"]: c for c in cols.get("value", [])}
        col_by_display = {c["displayName"]: c for c in cols.get("value", [])}
        for col in spec["columns"]:
            actual = col_by_name.get(col["name"]) or col_by_display.get(
                col["displayName"]
            )
            if not actual:
                problems.append(f"{name}: missing column {col['displayName']}")
                continue
            kind = column_kind(actual)
            if kind != expected_lookup_kinds[col["type"]]:
                problems.append(
                    f"{name}.{col['displayName']}: kind {kind} != {col['type']}"
                )
            if col["type"] == "choice":
                actual_choices = actual.get("choice", {}).get("choices", [])
                if actual_choices != col["choices"]:
                    problems.append(
                        f"{name}.{col['displayName']}: choices {actual_choices} != {col['choices']}"
                    )
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", choices=["staging", "production"], default="staging")
    parser.add_argument(
        "--apply", action="store_true", help="create missing pieces (default: dry-run)"
    )
    parser.add_argument(
        "--verify", action="store_true", help="read back and diff against the schema"
    )
    args = parser.parse_args()

    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    site_path = schema["site"]["paths"][args.env]
    mode = "VERIFY" if args.verify else ("APPLY" if args.apply else "DRY-RUN")
    print(
        f"== provision-sharepoint [{mode}] {schema['site']['hostname']}{site_path} =="
    )

    g = Graph(get_token())

    print("\n[1/3] site")
    site_id = ensure_site(g, schema, site_path, apply=args.apply)
    if not site_id:
        print("\nsite absent — apply to create it (dry-run stops here)")
        return 0 if not args.verify else 1

    if args.verify:
        print("\n[verify] lists + columns")
        problems = verify(g, site_id, schema)
        if problems:
            print("\nVERIFICATION DRIFT:", file=sys.stderr)
            for p in problems:
                print(f"  - {p}", file=sys.stderr)
            return 1
        print("verification clean — tenant matches config/sharepoint-schema.json")
        return 0

    print("\n[2/3] lists + columns")
    ensure_lists(g, site_id, schema, apply=args.apply)

    print("\n[3/3] document library folders")
    ensure_folders(g, site_id, schema, apply=args.apply)

    print(f"\n== done [{mode}] ==")
    return 0


if __name__ == "__main__":
    sys.exit(main())
