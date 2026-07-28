#!/usr/bin/env python3
"""Every tracked script starting with a shebang must be checked out with LF.

A shebang implies the file is executed or imported as a program, and CRLF
breaks that in ways that are invisible on Linux CI and confusing on Windows:

  - a .sh with CRLF fails as `set: pipefail: invalid option name`
  - a .mjs with CRLF cannot be collected by vitest, which reports
    `SyntaxError: Invalid or unexpected token` before running a single test,
    even though plain node imports the same file without complaint

Both have already happened here and in petralabx/skills, and each cost a round
of misdiagnosis because the symptom names neither the file nor line endings.
.gitattributes fixes it per extension; this check is what stops the next
extension from being forgotten.

Usage:
    python scripts/check-shebang-eol.py [--repo-root PATH]

Exits non-zero listing every shebang file that is not pinned to eol=lf.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys


def git(
    repo_root: str,
    *args: str,
    stdin: str | None = None,
    git_dir: str | None = None,
) -> subprocess.CompletedProcess:
    env = None
    if git_dir:
        env = {**os.environ, "GIT_DIR": git_dir, "GIT_WORK_TREE": repo_root}
    return subprocess.run(
        ["git", "-C", repo_root, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        input=stdin,
        env=env,
    )


def wsl_gitdir(repo_root: str) -> str | None:
    """Translate a Windows worktree's gitdir so WSL git can follow it.

    `git worktree add` on Windows writes an absolute `gitdir: C:/...` into the
    worktree's .git file. WSL git cannot resolve a drive-letter path, so it
    appends it to the cwd and reports `not a git repository` for a checkout that
    is perfectly valid — which is how preflight came to abort inside every
    worktree while passing in the main clone. Returns None when the layout is
    anything else, so normal checkouts take the untouched path above.
    """
    marker = os.path.join(repo_root, ".git")
    if not os.path.isfile(marker):
        return None
    try:
        with open(marker, encoding="utf-8") as handle:
            entry = handle.read().strip()
    except OSError:
        return None
    if not entry.startswith("gitdir:"):
        return None
    match = re.match(r"^([A-Za-z]):[\\/](.*)$", entry.split(":", 1)[1].strip())
    if not match:
        return None
    drive, rest = match.groups()
    return f"/mnt/{drive.lower()}/{rest.replace(chr(92), '/')}"


def has_shebang(path: str) -> bool:
    try:
        with open(path, "rb") as handle:
            return handle.read(2) == b"#!"
    except OSError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=os.getcwd())
    args = parser.parse_args()
    repo_root = os.path.abspath(args.repo_root)

    git_dir = None
    listing = git(repo_root, "ls-files", "-z")
    if listing.returncode != 0:
        git_dir = wsl_gitdir(repo_root)
        if git_dir:
            listing = git(repo_root, "ls-files", "-z", git_dir=git_dir)
    if listing.returncode != 0:
        # Report what git said rather than guessing. "not a git checkout" was
        # wrong in the case that actually came up, and a check that misnames its
        # own failure costs the same hour the CRLF symptom did.
        print(f"FATAL: git could not read {repo_root}", file=sys.stderr)
        detail = listing.stderr.strip()
        if detail:
            print(f"  {detail}", file=sys.stderr)
        return 2

    shebang_files = [
        name
        for name in listing.stdout.split("\0")
        if name and has_shebang(os.path.join(repo_root, name))
    ]
    if not shebang_files:
        print("no shebang files found")
        return 0

    # git check-attr reports the effective attribute, so this follows whatever
    # .gitattributes actually resolves to rather than re-implementing matching.
    query = git(
        repo_root,
        "check-attr",
        "--stdin",
        "-z",
        "eol",
        stdin="\0".join(shebang_files),
        git_dir=git_dir,
    )
    fields = query.stdout.split("\0")
    unpinned = [
        fields[i] for i in range(0, len(fields) - 2, 3) if fields[i + 2] != "lf"
    ]

    if unpinned:
        print(
            f"shebang EOL check FAILED — {len(unpinned)} file(s) not pinned to eol=lf:\n"
        )
        for name in sorted(unpinned):
            print(f"  - {name}")
        exts = sorted({os.path.splitext(n)[1] or "(no extension)" for n in unpinned})
        print(
            f"\nAdd a '<pattern> text eol=lf' rule to .gitattributes for: {', '.join(exts)}"
        )
        print("Then run: git add --renormalize . && git checkout-index -f -a")
        return 1

    print(f"shebang EOL check passed: {len(shebang_files)} file(s) pinned to eol=lf")
    return 0


if __name__ == "__main__":
    sys.exit(main())
