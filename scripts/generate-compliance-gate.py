#!/usr/bin/env python3
"""Generate the PLX MC compliance gate workflow from a single source.

The gate logic (the verify-API step) lives here, once. Two variants are emitted
from the same body so the three repos that run the gate can never drift:

  - canonical  -> this repo's .github/workflows/compliance-gate.yml. Self-triggers
                  on PRs (PLX_MC dogfoods the gate) AND is reusable via
                  workflow_call.
  - downstream -> the copy other repos commit as
                  .github/workflows/plx-mc-compliance.yml. Triggered by PRs
                  and the merge queue only; a private repo calling a
                  public-repo reusable with
                  `secrets: inherit` startup-fails, so each repo keeps a
                  self-contained copy generated from this one source.

The variants share one body and differ in exactly three places: the header
comment, the workflow_call trigger, and the MODE expression. Keeping the body in
one place kills the 3-copy drift that crept in when each repo got a
hand-authored copy.

Usage:
    python scripts/generate-compliance-gate.py            # write this repo's canonical file
    python scripts/generate-compliance-gate.py --check    # drift gate (canonical file), exit 1 on drift
    python scripts/generate-compliance-gate.py --emit canonical    # print canonical variant to stdout
    python scripts/generate-compliance-gate.py --emit downstream   # print downstream variant to stdout

Run the write mode after editing the body below. Run --check in preflight/CI so
this repo's gate can never silently drift from the source. The --emit downstream
output is the exact bytes other repos must commit; the cross-repo sync uses it.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANONICAL_PATH = ROOT / ".github" / "workflows" / "compliance-gate.yml"

HEADER_CANONICAL = """# PLX MC Compliance Gate (EN-007) — the required PR status check.
#
# Calls the PLX MC verify API and blocks (hard) or warns (soft) on the verdict.
# Safe + default-off: if PLX_MC_BASE_URL is not configured the gate SKIPS (exit 0),
# so adding this workflow to a repo never blocks it before rollout. Reusable via
# workflow_call (other repos add a 3-line caller); also self-triggers on PRs so
# PLX_MC dogfoods it first. Untrusted PR fields are passed via env (never
# interpolated into the shell) to avoid script injection.

"""

HEADER_DOWNSTREAM = """# PLX MC Compliance Gate (EN-007 Step 6) — copied into this repo (self-contained)
# rather than calling the reusable workflow cross-repo: a private repo calling a
# public-repo reusable with `secrets: inherit` startup-fails. Same logic as the
# PLX_MC gate. Soft by default (vars.COMPLIANCE_MODE); skips if PLX_MC_BASE_URL is
# unset. Untrusted PR fields are passed via env (never interpolated into shell).
"""

NAME_AND_PR_TRIGGER = """name: PLX MC Compliance Gate

on:
  pull_request:
    types: [opened, synchronize, reopened, edited]
  merge_group:
    types: [checks_requested]
"""

WORKFLOW_CALL_TRIGGER = """  workflow_call:
    inputs:
      mode:
        description: "soft (warn) or hard (block)"
        type: string
        default: "soft"
"""

# Shared body — everything from `permissions:` to the end. The MODE expression is
# the only per-variant token inside it. Raw string: the embedded shell keeps its
# literal backslashes (line continuations, jq `\\n`).
BODY = r"""
permissions:
  contents: read
  pull-requests: read
  id-token: write

jobs:
  compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Verify against PLX MC
        env:
          MC_BASE_URL: ${{ secrets.PLX_MC_BASE_URL }}
          MC_CI_TOKEN: ${{ secrets.COMPLIANCE_CI_TOKEN }}
          MODE: ${{ __MODE_EXPR__ }}
          PR_BODY: ${{ github.event.pull_request.body }}
          PR_LABELS: ${{ toJson(github.event.pull_request.labels.*.name) }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}
          PR_AUTHOR: ${{ github.event.pull_request.user.login }}
          PR_BASE_REF: ${{ github.base_ref }}
          REPO_NAME: ${{ github.event.repository.name }}
          REPO_FULL_NAME: ${{ github.repository }}
          GH_TOKEN: ${{ github.token }}
          MERGE_GROUP_HEAD_REF: ${{ github.event.merge_group.head_ref }}
        run: |
          set -euo pipefail
          if [ -z "${MC_BASE_URL:-}" ]; then
            echo "PLX_MC_BASE_URL not configured — compliance gate skipped (pre-rollout)."
            exit 0
          fi
          OIDC_TOKEN=""
          if [ -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] && [ -n "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]; then
            OIDC_TOKEN=$(curl -sS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
              "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=plx-mc-compliance-verify" \
              | jq -r '.value // ""' || true)
          fi
          # merge_group: the queue ref is gh-readonly-queue/<base>/pr-<N>-<sha>. The
          # queue builds one PR per group, so read PR N (body, head, labels, files)
          # with gh api and verify its stamps on its own head. PR_HEAD_SHA stays
          # empty when PR N cannot be read; the block path below handles that.
          if [ "${GITHUB_EVENT_NAME:-}" = "merge_group" ]; then
            PR_NUMBER=""
            PR_HEAD_SHA=""
            PR_BODY=""
            PR_LABELS="[]"
            changed="[]"
            N=$(printf '%s' "${MERGE_GROUP_HEAD_REF:-}" \
              | sed -nE 's#^(refs/heads/)?gh-readonly-queue/[^/]+/pr-([0-9]+)-[0-9a-f]+$#\2#p')
            if [ -n "$N" ] \
              && pr=$(gh api "repos/${REPO_FULL_NAME}/pulls/${N}") \
              && files=$(gh api --paginate "repos/${REPO_FULL_NAME}/pulls/${N}/files" --jq '.[] | .filename, (.previous_filename // empty)'); then
              PR_NUMBER="$N"
              PR_HEAD_SHA=$(printf '%s' "$pr" | jq -r '.head.sha // ""')
              PR_BODY=$(printf '%s' "$pr" | jq -r '.body // ""')
              PR_LABELS=$(printf '%s' "$pr" | jq -c '[(.labels // [])[].name]')
              PR_AUTHOR=$(printf '%s' "$pr" | jq -r '.user.login // ""')
              changed=$(printf '%s' "$files" | jq -R -s 'split("\n") | map(select(length>0))')
            fi
          else
            git fetch --no-tags --depth=1 origin "$PR_BASE_REF" || true
            # Capture the diff separately from jq. Piping `git diff | jq ... || echo '[]'`
            # double-emits ([] from jq AND [] from the ||) when git diff prints nothing
            # AND fails (a shallow fetch of a busy base has no merge base) — that invalid
            # JSON crashes the --argjson below and hard-fails this otherwise-soft gate.
            diff_out=$(git diff --name-only --no-renames "origin/${PR_BASE_REF}...HEAD" 2>/dev/null || true)
            changed=$(printf '%s' "$diff_out" | jq -R -s 'split("\n") | map(select(length>0))')
          fi
          # PR-drain (6): docs-only and Dependabot lockfile-only PRs post a passing
          # `compliance` with a clear "skipped" verdict. The skip is inside the job, not
          # a paths-ignore, so the required check always reports. Never skips when the
          # file list is empty/unknown, or for any non-Markdown file (docs/** code and
          # build inputs included). Agent/runtime instructions never count as docs:
          # AGENTS*/CLAUDE*/CODEX*/GROK*/HERMES*/GEMINI*/COPILOT*.md (e.g. AGENTS.override.md),
          # SKILL/SYSTEM/TOOLS/SOUL/IDENTITY/USER/HEARTBEAT/MEMORY/LESSONS.md, and anything
          # under .github/, .claude/, .cursor/, .codex/, .grok/, .agents/, .windsurf/,
          # skills/, prompts/ or docs/training/ — at any depth, case-insensitive. Only
          # *.md can skip, so *.mdc rules and .cursorrules never do. Renames are
          # classified on BOTH paths (--no-renames; previous_filename in merge_group).
          n_changed=$(printf '%s' "$changed" | jq 'length')
          if [ "$n_changed" -gt 0 ] && [ "$n_changed" -lt 3000 ]; then
            non_docs=$(printf '%s' "$changed" | jq '[.[] | select(
                (test("\\.md$"; "i") and
                 (test("(^|/)(\\.github|\\.claude|\\.cursor|\\.codex|\\.grok|\\.agents?|\\.windsurf|skills|prompts)/"; "i")
                  or test("(^|/)docs/training/"; "i")
                  or test("(^|/)(AGENTS|CLAUDE|CODEX|GROK|HERMES|GEMINI|COPILOT)[^/]*\\.md$"; "i")
                  or test("(^|/)(SKILL|SYSTEM|TOOLS|SOUL|IDENTITY|USER|HEARTBEAT|MEMORY|LESSONS|copilot-instructions)\\.md$"; "i") | not)) | not
              )] | length')
            non_lock=$(printf '%s' "$changed" | jq '[.[] | select(
                test("(^|/)(package-lock\\.json|pnpm-lock\\.yaml|yarn\\.lock|poetry\\.lock|uv\\.lock|Cargo\\.lock|go\\.sum|Gemfile\\.lock|composer\\.lock|bun\\.lockb?)$") | not
              )] | length')
            if [ "$non_docs" -eq 0 ]; then
              echo "verdict=pass (skipped: docs-only, ${n_changed} file(s))"
              echo "Compliance gate: PASS — skipped: docs-only"
              exit 0
            fi
            if [ "$non_lock" -eq 0 ] && [ "${PR_AUTHOR:-}" = "dependabot[bot]" ]; then
              echo "verdict=pass (skipped: dependabot lockfile-only, ${n_changed} file(s))"
              echo "Compliance gate: PASS — skipped: dependabot lockfile-only"
              exit 0
            fi
          fi
          if [ "${GITHUB_EVENT_NAME:-}" = "merge_group" ] && [ -z "$PR_HEAD_SHA" ]; then
            echo "merge_group: could not resolve the pull request"
            verdict="block"
            reasons="merge_group: could not resolve the pull request"
          else
            # Read EVERY MC-Checkout stamp (one per task) — a PR may complete N
            # related tasks; verify checks all of them and blocks if any is incomplete.
            # `grep || true` swallows the no-match exit (operator PR) under pipefail;
            # jq then emits a valid empty array for the no-stamp case.
            checkoutIds=$(printf '%s' "$PR_BODY" \
              | { grep -oE 'MC-Checkout: dsp_[A-Za-z0-9]+' || true; } \
              | sed 's/.* //' | sort -u \
              | jq -R -s 'split("\n") | map(select(length>0))')
            # Also send checkoutId (first stamp) so a not-yet-deployed single-task
            # verify still gates the PR during the deploy window (back-compat); the
            # multi-task verify prefers checkoutIds and ignores it.
            checkout=$(printf '%s' "$checkoutIds" | jq -r '.[0] // ""')
            # repo is the display/event key; repoFullName is the binding identity.
            # Bare names alone cannot bind a checkout.
            body=$(jq -n \
              --arg repo "$REPO_NAME" \
              --arg repoFullName "$REPO_FULL_NAME" \
              --argjson prNumber "$PR_NUMBER" \
              --arg headSha "$PR_HEAD_SHA" \
              --argjson changedPaths "$changed" \
              --argjson labels "${PR_LABELS:-[]}" \
              --argjson checkoutIds "${checkoutIds:-[]}" \
              --arg checkoutId "${checkout:-}" \
              --arg event "${GITHUB_EVENT_NAME:-}" \
              '{repo:$repo, repoFullName:$repoFullName, prNumber:$prNumber, headSha:$headSha, changedPaths:$changedPaths, labels:$labels, checkoutIds:$checkoutIds}
               + (if $checkoutId != "" then {checkoutId:$checkoutId} else {} end)
               + (if $event == "merge_group" then {event:$event} else {} end)')
            # Prefer OIDC; on unauthorized/verify_disabled (pre-deploy cutover when MC
            # is still bearer-only) retry once with COMPLIANCE_CI_TOKEN.
            AUTH_PATH=""
            resp=""
            if [ -n "${OIDC_TOKEN:-}" ]; then
              resp=$(curl -sS --max-time 20 -X POST "${MC_BASE_URL%/}/api/compliance/verify" \
                -H 'content-type: application/json' \
                -H "authorization: Bearer ${OIDC_TOKEN}" \
                -d "$body" || true)
              err=$(printf '%s' "$resp" | jq -r '.error.code // empty' 2>/dev/null || true)
              if [ -n "$resp" ] && [ "$err" != "unauthorized" ] && [ "$err" != "verify_disabled" ]; then
                AUTH_PATH="oidc"
                echo "auth=oidc"
              fi
            fi
            if [ -z "$AUTH_PATH" ] && [ -n "${MC_CI_TOKEN:-}" ]; then
              resp=$(curl -sS --max-time 20 -X POST "${MC_BASE_URL%/}/api/compliance/verify" \
                -H 'content-type: application/json' \
                -H "authorization: Bearer ${MC_CI_TOKEN}" \
                -d "$body" || true)
              if [ -n "${OIDC_TOKEN:-}" ]; then
                AUTH_PATH="bearer-fallback"
                echo "auth=bearer-fallback"
              else
                AUTH_PATH="bearer"
                echo "auth=bearer"
              fi
            fi
            echo "verify response: $resp"
            if [ -z "$resp" ]; then
              echo "Compliance gate: MC unreachable (network/timeout)."
              if [ "$MODE" = "hard" ]; then exit 1; fi
              echo "soft mode — not failing the check"; exit 0
            fi
            verdict=$(printf '%s' "$resp" | jq -r '.data.verdict // "block"')
            reasons=$(printf '%s' "$resp" | jq -r '(.data.reasons // []) | join("; ")')
          fi
          echo "verdict=$verdict mode=$MODE"
          if [ "$verdict" = "pass" ]; then
            echo "Compliance gate: PASS"
            exit 0
          fi
          echo "Compliance gate: BLOCK — $reasons"
          if [ "$MODE" = "hard" ]; then
            exit 1
          fi
          echo "soft mode — recording only, not failing the check"
          exit 0
"""

MODE_EXPR = {
    "canonical": "inputs.mode || vars.COMPLIANCE_MODE || 'soft'",
    "downstream": "vars.COMPLIANCE_MODE || 'soft'",
}


def render(variant: str) -> str:
    """Render the full gate workflow YAML for `canonical` or `downstream`."""
    if variant not in MODE_EXPR:
        raise ValueError(
            f"unknown variant: {variant!r} (expected canonical|downstream)"
        )
    header = HEADER_CANONICAL if variant == "canonical" else HEADER_DOWNSTREAM
    trigger = NAME_AND_PR_TRIGGER
    if variant == "canonical":
        trigger += WORKFLOW_CALL_TRIGGER
    body = BODY.replace("__MODE_EXPR__", MODE_EXPR[variant])
    return header + trigger + body


def main() -> int:
    args = sys.argv[1:]

    if "--emit" in args:
        i = args.index("--emit")
        try:
            variant = args[i + 1]
        except IndexError:
            print(
                "ERROR: --emit requires a variant (canonical|downstream)",
                file=sys.stderr,
            )
            return 2
        sys.stdout.write(render(variant))
        return 0

    expected = render("canonical")

    if "--check" in args:
        current = (
            CANONICAL_PATH.read_text(encoding="utf-8")
            if CANONICAL_PATH.exists()
            else ""
        )
        if current != expected:
            print(
                "COMPLIANCE GATE DRIFT — .github/workflows/compliance-gate.yml does not "
                "match the generator source.",
                file=sys.stderr,
            )
            print("Fix: python scripts/generate-compliance-gate.py", file=sys.stderr)
            return 1
        print("compliance gate aligned with generator source")
        return 0

    CANONICAL_PATH.write_text(expected, encoding="utf-8", newline="\n")
    print(f"wrote {CANONICAL_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
