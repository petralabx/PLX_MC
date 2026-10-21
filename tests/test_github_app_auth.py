"""GitHub App credential helper: short-lived PR-write tokens, no personal PATs."""

from __future__ import annotations

import base64
import importlib.util
import io
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "github-app-auth.py"


def load_auth():
    spec = importlib.util.spec_from_file_location("github_app_auth", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def auth():
    return load_auth()


@pytest.fixture(scope="module")
def rsa_pem(tmp_path_factory: pytest.TempPathFactory) -> str:
    path = tmp_path_factory.mktemp("keys") / "app.pem"
    subprocess.run(
        [
            "openssl",
            "genpkey",
            "-algorithm",
            "RSA",
            "-pkeyopt",
            "rsa_keygen_bits:2048",
            "-out",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    return path.read_text(encoding="utf-8")


def app_env(slug: str = "plx-agents-writer") -> dict[str, str]:
    return {
        "PLX_GITHUB_APP_SLUG": slug,
        "PLX_GITHUB_APP_ID": "42",
        "PLX_GITHUB_APP_INSTALLATION_ID": "7",
        "PLX_GITHUB_APP_PRIVATE_KEY_SECRET_ID": f"plx/github/apps/{slug}/private-key",
    }


def test_permissions_are_pr_write_only(auth) -> None:
    body = auth.installation_token_body()
    assert body == {
        "permissions": {
            "contents": "write",
            "metadata": "read",
            "pull_requests": "write",
        }
    }
    assert "administration" not in body["permissions"]


def test_private_key_secret_id_rejects_ec2_bundle(auth) -> None:
    with pytest.raises(SystemExit, match="private-key"):
        auth.validate_private_key_secret_id("prod/ec2-secrets")
    with pytest.raises(SystemExit, match="does not match"):
        env = app_env()
        env["PLX_GITHUB_APP_PRIVATE_KEY_SECRET_ID"] = (
            "plx/github/apps/other-bot/private-key"
        )
        auth.load_app_env(env)


def test_per_bot_slug_is_accepted(auth) -> None:
    cfg = auth.load_app_env(app_env("cursor-cloud"))
    assert cfg["secret_id"] == "plx/github/apps/cursor-cloud/private-key"


def test_jwt_is_rs256_and_expires_within_ten_minutes(
    auth, rsa_pem: str, tmp_path: Path
) -> None:
    now = 1_700_000_000
    token = auth.mint_app_jwt("42", rsa_pem, now)
    header_b, payload_b, sig_b = token.split(".")

    def decode(part: str) -> dict:
        pad = "=" * (-len(part) % 4)
        return json.loads(base64.urlsafe_b64decode(part + pad))

    assert decode(header_b)["alg"] == "RS256"
    payload = decode(payload_b)
    assert payload["iss"] == "42"
    assert payload["iat"] == now - 60
    assert payload["exp"] == now + 540
    key = tmp_path / "key.pem"
    pub = tmp_path / "pub.pem"
    key.write_text(rsa_pem, encoding="utf-8")
    subprocess.run(
        ["openssl", "pkey", "-in", str(key), "-pubout", "-out", str(pub)],
        check=True,
        capture_output=True,
    )
    sig = base64.urlsafe_b64decode(sig_b + "=" * (-len(sig_b) % 4))
    sig_path = tmp_path / "sig"
    data = tmp_path / "data"
    sig_path.write_bytes(sig)
    data.write_bytes(f"{header_b}.{payload_b}".encode())
    proc = subprocess.run(
        [
            "openssl",
            "dgst",
            "-sha256",
            "-verify",
            str(pub),
            "-signature",
            str(sig_path),
            str(data),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr


def test_token_is_cached_and_refreshed_before_expiry(
    auth, rsa_pem: str, tmp_path: Path
) -> None:
    calls: list[dict] = []

    def post(url: str, headers: dict, body: dict) -> tuple[int, dict]:
        calls.append(
            {"url": url, "auth": headers.get("Authorization", ""), "body": body}
        )
        return 201, {"token": f"ghs_{len(calls)}", "expires_at": "2026-10-21T13:00:00Z"}

    expires = auth.parse_expires_at("2026-10-21T13:00:00Z")
    fresh_now = expires - 120
    token = auth.get_installation_token(
        env=app_env(),
        now_s=fresh_now,
        home=tmp_path,
        fetch_private_key=lambda secret_id: rsa_pem,
        post_json=post,
    )
    assert token == "ghs_1"
    assert calls[0]["url"].endswith("/app/installations/7/access_tokens")
    assert calls[0]["body"]["permissions"]["pull_requests"] == "write"
    assert "administration" not in calls[0]["body"]["permissions"]
    assert "ghs_1" not in calls[0]["auth"]
    cache = tmp_path / ".cache" / "plx-github-app" / "plx-agents-writer.json"
    assert cache.stat().st_mode & 0o777 == 0o600

    def boom(*_args, **_kwargs):
        raise AssertionError("cache should satisfy this call")

    again = auth.get_installation_token(
        env=app_env(),
        now_s=expires - 61,
        home=tmp_path,
        fetch_private_key=boom,
        post_json=boom,
    )
    assert again == "ghs_1"

    refreshed = auth.get_installation_token(
        env=app_env(),
        now_s=expires - 60,
        home=tmp_path,
        fetch_private_key=lambda secret_id: rsa_pem,
        post_json=post,
    )
    assert refreshed == "ghs_2"
    assert len(calls) == 2


def test_http_error_does_not_echo_the_jwt(auth) -> None:
    def post(url: str, headers: dict, body: dict) -> tuple[int, dict]:
        return 401, {"message": "bad credentials"}

    with pytest.raises(SystemExit, match="HTTP 401") as exc:
        auth.request_installation_token("jwt-secret-value", "7", post_json=post)
    assert "jwt-secret-value" not in str(exc.value)
    assert "bad credentials" in str(exc.value)


def test_git_credential_get_store_and_erase(auth, tmp_path: Path) -> None:
    cache = auth.cache_path_for("plx-agents-writer", tmp_path)
    auth.write_cached_token(cache, "ghs_cached", 1_800_000_000)
    text = auth.render_git_credential(
        "get",
        "protocol=https\nhost=github.com\n",
        "ghs_live",
        on_erase=lambda: None,
    )
    assert "username=x-access-token" in text
    assert "password=ghs_live" in text
    assert (
        auth.render_git_credential(
            "get", "protocol=https\nhost=gitlab.com\n", None, on_erase=lambda: None
        )
        == ""
    )
    erased = {"n": 0}

    def erase() -> None:
        erased["n"] += 1
        auth.erase_cached_token(cache)

    assert auth.render_git_credential("erase", "", None, on_erase=erase) == ""
    assert erased["n"] == 1
    assert not cache.exists()
    assert auth.render_git_credential("store", "", None, on_erase=erase) == ""


def test_gh_env_strips_personal_pats(auth) -> None:
    env = auth.gh_child_env(
        {
            "PATH": "/usr/bin",
            "PETRALABX_GITHUB_TOKEN": "personal-pat-sentinel",
            "PETRALABX_GITHUB": "alias-pat",
            "PLX_GITHUB_PAT": "plx-pat",
            "GITHUB_TOKEN": "legacy-pat",
            "GH_TOKEN": "old",
        },
        "ghs_app",
    )
    assert env["GH_TOKEN"] == "ghs_app"
    for name in (
        "PETRALABX_GITHUB_TOKEN",
        "PETRALABX_GITHUB",
        "PLX_GITHUB_PAT",
        "GITHUB_TOKEN",
    ):
        assert name not in env
    assert "personal-pat-sentinel" not in env.values()


def test_find_real_gh_skips_the_wrapper_directory(auth, tmp_path: Path) -> None:
    home = tmp_path / "home"
    wrapper = home / ".local" / "bin"
    wrapper.mkdir(parents=True)
    wrapped = wrapper / "gh"
    wrapped.write_text("#!/bin/sh\n", encoding="utf-8")
    wrapped.chmod(0o755)
    real_dir = tmp_path / "real"
    real_dir.mkdir()
    real = real_dir / "gh"
    real.write_text("#!/bin/sh\n", encoding="utf-8")
    real.chmod(0o755)
    found = auth.find_real_gh(
        os.pathsep.join([str(wrapper), str(real_dir)]),
        auth.wrapper_skip_dirs({"HOME": str(home)}),
    )
    assert found == str(real)


def test_token_command_prints_only_the_token(
    auth, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(auth, "get_installation_token", lambda **_kwargs: "ghs_only")
    assert auth.main(["token"]) == 0
    captured = capsys.readouterr()
    assert captured.out == "ghs_only"
    assert captured.err == ""


def test_git_credential_command_skips_non_github_hosts(
    auth, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(**_kwargs):
        raise AssertionError("non-github hosts must not mint")

    monkeypatch.setattr(auth, "get_installation_token", fail)
    monkeypatch.setattr(sys, "stdin", io.StringIO("protocol=https\nhost=gitlab.com\n"))
    assert auth.main(["git-credential", "get"]) == 0
    assert capsys.readouterr().out == ""
