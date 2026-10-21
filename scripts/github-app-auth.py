#!/usr/bin/env python3
"""Mint short-lived GitHub App installation tokens for coding-box git and gh.

Fleet policy: bot identities are PR-write-only. CIP owns merges. This helper
requests contents:write, pull_requests:write, and metadata:read. It does not
request administration or ruleset bypass. Branch protection stays the merge
control; this process cannot grant it.

The private key stays in AWS Secrets Manager at
plx/github/apps/<app>/private-key. This file caches only the installation
token, refreshes it 60 seconds before expiry, and never writes the PEM.

Subcommands:
  token                         print a token to stdout (no trailing newline)
  git-credential {get|store|erase}
  gh [args...]                  exec the real gh with GH_TOKEN set
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

import boto3

GH_API = "https://api.github.com"
DEFAULT_GITHUB_APP_SLUG = "plx-agents-writer"
JWT_SKEW_S = 60
JWT_TTL_S = 9 * 60
REFRESH_SKEW_S = 60
PERSONAL_PAT_ENV_NAMES = (
    "PETRALABX_GITHUB_TOKEN",
    "PETRALABX_GITHUB",
    "PLX_GITHUB_PAT",
    "GITHUB_TOKEN",
    "GH_TOKEN",
)
# PR-write only. metadata is read-only on every GitHub App. administration is
# intentionally absent so this identity cannot edit rulesets.
PR_WRITE_PERMISSIONS = {
    "contents": "write",
    "metadata": "read",
    "pull_requests": "write",
}
GITHUB_HOSTS = {"github.com", "gist.github.com"}


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def installation_token_body() -> dict:
    return {"permissions": dict(PR_WRITE_PERMISSIONS)}


def validate_slug(slug: str) -> str:
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
        raise SystemExit(f"invalid github app slug: {slug}")
    return slug


def validate_private_key_secret_id(secret_id: str) -> str:
    prefix = "plx/github/apps/"
    suffix = "/private-key"
    if not secret_id.startswith(prefix) or not secret_id.endswith(suffix):
        raise SystemExit(
            "refusing private key secret id outside plx/github/apps/<app>/private-key"
        )
    slug = secret_id[len(prefix) : -len(suffix)]
    validate_slug(slug)
    return secret_id


def private_key_secret_id(slug: str) -> str:
    return f"plx/github/apps/{validate_slug(slug)}/private-key"


def load_app_env(env: dict[str, str] | None = None) -> dict[str, str]:
    source = os.environ if env is None else env
    slug = validate_slug(
        (source.get("PLX_GITHUB_APP_SLUG") or DEFAULT_GITHUB_APP_SLUG).strip()
    )
    app_id = (source.get("PLX_GITHUB_APP_ID") or "").strip()
    installation_id = (source.get("PLX_GITHUB_APP_INSTALLATION_ID") or "").strip()
    secret_id = validate_private_key_secret_id(
        (source.get("PLX_GITHUB_APP_PRIVATE_KEY_SECRET_ID") or "").strip()
    )
    if not app_id.isdigit() or not installation_id.isdigit():
        raise SystemExit(
            "PLX_GITHUB_APP_ID and PLX_GITHUB_APP_INSTALLATION_ID must be numeric"
        )
    expected = private_key_secret_id(slug)
    if secret_id != expected:
        raise SystemExit("private key secret id does not match PLX_GITHUB_APP_SLUG")
    return {
        "slug": slug,
        "app_id": app_id,
        "installation_id": installation_id,
        "secret_id": secret_id,
    }


def openssl_rs256_sign(signing_input: bytes, private_key_pem: str) -> bytes:
    pem = private_key_pem.replace("\\n", "\n")
    if "PRIVATE KEY" not in pem:
        raise SystemExit("github app private key is not a PEM")
    fd, path = tempfile.mkstemp(prefix="plx-gh-app-", suffix=".pem")
    try:
        os.write(fd, pem.encode())
        os.close(fd)
        os.chmod(path, 0o600)
        proc = subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", path],
            input=signing_input,
            capture_output=True,
            check=False,
        )
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    if proc.returncode != 0:
        raise SystemExit("openssl failed to sign the GitHub App JWT")
    return proc.stdout


def mint_app_jwt(app_id: str, private_key_pem: str, now_s: int | None = None) -> str:
    if not str(app_id).isdigit():
        raise SystemExit("github app id must be numeric")
    now = int(time.time()) if now_s is None else int(now_s)
    iat = now - JWT_SKEW_S
    exp = iat + JWT_SKEW_S + JWT_TTL_S
    header = b64url(
        json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode()
    )
    payload = b64url(
        json.dumps(
            {"iat": iat, "exp": exp, "iss": str(app_id)}, separators=(",", ":")
        ).encode()
    )
    signing_input = f"{header}.{payload}".encode()
    signature = openssl_rs256_sign(signing_input, private_key_pem)
    return f"{header}.{payload}.{b64url(signature)}"


def parse_expires_at(value: str) -> int:
    text = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise SystemExit("installation token expiry was not a timestamp") from None
    if parsed.tzinfo is None:
        raise SystemExit("installation token expiry must be timezone-aware")
    return int(parsed.timestamp())


def urllib_post_json(url: str, headers: dict[str, str], body: dict) -> tuple[int, dict]:
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            parsed = json.loads(res.read().decode())
            return res.status, parsed if isinstance(parsed, dict) else {}
    except urllib.error.HTTPError as err:
        raw = err.read().decode(errors="replace")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}
        return err.code, parsed


def request_installation_token(
    app_jwt: str,
    installation_id: str,
    *,
    post_json=urllib_post_json,
) -> tuple[str, int]:
    if not str(installation_id).isdigit():
        raise SystemExit("github app installation id must be numeric")
    url = f"{GH_API}/app/installations/{installation_id}/access_tokens"
    status, body = post_json(
        url,
        {
            "Authorization": f"Bearer {app_jwt}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
        installation_token_body(),
    )
    if status < 200 or status >= 300:
        message = str(body.get("message") or "") if isinstance(body, dict) else ""
        detail = f": {message}" if message else ""
        raise SystemExit(
            f"GitHub App installation token request failed (HTTP {status}){detail}"
        )
    token = str(body.get("token") or "")
    expires_at = body.get("expires_at")
    if not token or not expires_at:
        raise SystemExit("GitHub App installation token response was incomplete")
    return token, parse_expires_at(str(expires_at))


def cache_path_for(slug: str, home: Path | None = None) -> Path:
    root = Path.home() if home is None else home
    return root / ".cache" / "plx-github-app" / f"{validate_slug(slug)}.json"


def read_cached_token(path: Path, now_s: int) -> str | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    token = data.get("token")
    expires = data.get("expiresAt")
    if not isinstance(token, str) or not isinstance(expires, int):
        return None
    if expires - REFRESH_SKEW_S <= now_s:
        return None
    return token


def write_cached_token(path: Path, token: str, expires_at: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.parent.chmod(0o700)
    except OSError:
        pass
    path.write_text(
        json.dumps({"token": token, "expiresAt": expires_at}), encoding="utf-8"
    )
    try:
        path.chmod(0o600)
    except OSError:
        pass


def erase_cached_token(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        return


def secrets_manager_private_key(secret_id: str) -> str:
    validate_private_key_secret_id(secret_id)
    client = boto3.client("secretsmanager", region_name="us-east-1")
    raw = client.get_secret_value(SecretId=secret_id)["SecretString"]
    if not isinstance(raw, str) or "PRIVATE KEY" not in raw:
        raise SystemExit(f"{secret_id}: expected a PEM private key")
    return raw


def get_installation_token(
    *,
    env: dict[str, str] | None = None,
    now_s: int | None = None,
    home: Path | None = None,
    fetch_private_key=secrets_manager_private_key,
    post_json=urllib_post_json,
) -> str:
    cfg = load_app_env(env)
    now = int(time.time()) if now_s is None else int(now_s)
    path = cache_path_for(cfg["slug"], home)
    cached = read_cached_token(path, now)
    if cached:
        return cached
    pem = fetch_private_key(cfg["secret_id"])
    app_jwt = mint_app_jwt(cfg["app_id"], pem, now)
    token, expires_at = request_installation_token(
        app_jwt, cfg["installation_id"], post_json=post_json
    )
    write_cached_token(path, token, expires_at)
    return token


def parse_credential_input(text: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in text.splitlines():
        if not line or "=" not in line:
            continue
        key, value = line.split("=", 1)
        fields[key.strip()] = value
    return fields


def render_git_credential(
    action: str,
    stdin_text: str,
    token: str | None,
    *,
    on_erase,
) -> str:
    if action == "store":
        return ""
    if action == "erase":
        on_erase()
        return ""
    if action != "get":
        raise SystemExit(f"unsupported git credential action: {action}")
    fields = parse_credential_input(stdin_text)
    host = fields.get("host", "")
    if host not in GITHUB_HOSTS:
        return ""
    if not token:
        raise SystemExit("github app token unavailable")
    lines = [f"{key}={value}" for key, value in fields.items()]
    lines.append("username=x-access-token")
    lines.append(f"password={token}")
    return "\n".join(lines) + "\n"


MINT_FAILED_EXIT = 126
AMBIENT_TOKEN_ENV_NAMES = (
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GH_ENTERPRISE_TOKEN",
)


def legacy_personal_pat_opt_in(env: dict[str, str] | None = None) -> bool:
    source = os.environ if env is None else env
    raw = (source.get("PLX_BOOTSTRAP_LEGACY_GITHUB_PAT") or "").strip().lower()
    return raw in {"1", "true", "yes"}


def gh_config_dir(env: dict[str, str]) -> str:
    home = env.get("HOME") or str(Path.home())
    return os.path.join(home, ".config", "plx-github-app", "gh")


def gh_child_env(base: dict[str, str], token: str) -> dict[str, str]:
    env = dict(base)
    for name in PERSONAL_PAT_ENV_NAMES:
        env.pop(name, None)
    for name in AMBIENT_TOKEN_ENV_NAMES:
        env.pop(name, None)
    env["GH_TOKEN"] = token
    env["GH_CONFIG_DIR"] = gh_config_dir(env)
    return env


def refuse_ambient_credentials(detail: str = "") -> int:
    print(
        "GitHub App token mint failed. Refusing to run gh or git with ambient credentials.",
        file=sys.stderr,
    )
    if detail and "ghs_" not in detail and "github_pat_" not in detail:
        print(detail, file=sys.stderr)
    return MINT_FAILED_EXIT


def wrapper_skip_dirs(env: dict[str, str]) -> set[str]:
    home = env.get("HOME") or str(Path.home())
    return {os.path.normcase(os.path.abspath(os.path.join(home, ".local", "bin")))}


def find_real_gh(path_value: str, skip_dirs: set[str]) -> str:
    for directory in path_value.split(os.pathsep):
        if not directory:
            continue
        normalized = os.path.normcase(os.path.abspath(directory))
        if normalized in skip_dirs:
            continue
        for name in ("gh", "gh.exe"):
            candidate = os.path.join(directory, name)
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate
    raise SystemExit("gh executable not found on PATH")


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in {"-h", "--help"}:
        print(__doc__)
        return 0 if args and args[0] in {"-h", "--help"} else 2
    command = args[0]
    if command == "token":
        sys.stdout.write(get_installation_token())
        return 0
    if command == "git-credential":
        action = args[1] if len(args) > 1 else "get"
        stdin_text = sys.stdin.read()
        fields = parse_credential_input(stdin_text)

        def erase() -> None:
            cfg = load_app_env()
            erase_cached_token(cache_path_for(cfg["slug"]))

        token = None
        if action == "get" and fields.get("host", "") in GITHUB_HOSTS:
            try:
                token = get_installation_token()
            except SystemExit as err:
                return refuse_ambient_credentials(str(err))
            if not str(token or "").strip():
                return refuse_ambient_credentials()
        sys.stdout.write(
            render_git_credential(action, stdin_text, token, on_erase=erase)
        )
        return 0
    if command == "gh":
        token = ""
        mint_error = ""
        try:
            token = get_installation_token().strip()
        except SystemExit as err:
            mint_error = str(err)
            token = ""
        if token:
            env = gh_child_env(dict(os.environ), token)
            os.makedirs(env["GH_CONFIG_DIR"], mode=0o700, exist_ok=True)
        elif legacy_personal_pat_opt_in():
            env = dict(os.environ)
        else:
            return refuse_ambient_credentials(mint_error)
        real = find_real_gh(env.get("PATH", ""), wrapper_skip_dirs(env))
        os.execvpe(real, [real, *args[1:]], env)
    raise SystemExit(f"unknown command: {command}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        raise SystemExit(0) from None
