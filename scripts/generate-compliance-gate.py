#!/usr/bin/env python3
"""Generate the PLX MC compliance gate workflow from a single source.

The gate logic (the verify-API step) lives here, once. Two variants are emitted
from the same body so the three repos that run the gate can never drift:

  - canonical  -> this repo's .github/workflows/compliance-gate.yml. Self-triggers
                  on PRs (PLX_MC dogfoods the gate) AND is reusable via
                  workflow_call.
  - downstream -> the copy other repos commit as
                  .github/workflows/plx-mc-compliance.yml. PR-triggered only; a
                  private repo calling a public-repo reusable with
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
    types: [opened, synchronize, reopened]
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
          PR_BASE_REF: ${{ github.base_ref }}
          REPO_NAME: ${{ github.event.repository.name }}
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
          git fetch --no-tags --depth=1 origin "$PR_BASE_REF" || true
          # Capture the diff separately from jq. Piping `git diff | jq ... || echo '[]'`
          # double-emits ([] from jq AND [] from the ||) when git diff prints nothing
          # AND fails (a shallow fetch of a busy base has no merge base) — that invalid
          # JSON crashes the --argjson below and hard-fails this otherwise-soft gate.
          diff_out=$(git diff --name-only "origin/${PR_BASE_REF}...HEAD" 2>/dev/null || true)
          changed=$(printf '%s' "$diff_out" | jq -R -s 'split("\n") | map(select(length>0))')
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
          body=$(jq -n \
            --arg repo "$REPO_NAME" \
            --argjson prNumber "$PR_NUMBER" \
            --arg headSha "$PR_HEAD_SHA" \
            --argjson changedPaths "$changed" \
            --argjson labels "${PR_LABELS:-[]}" \
            --argjson checkoutIds "${checkoutIds:-[]}" \
            --arg checkoutId "${checkout:-}" \
            '{repo:$repo, prNumber:$prNumber, headSha:$headSha, changedPaths:$changedPaths, labels:$labels, checkoutIds:$checkoutIds}
             + (if $checkoutId != "" then {checkoutId:$checkoutId} else {} end)')
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
