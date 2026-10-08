#!/usr/bin/env bash
# Offline-testable Action driver. Each npm invocation guards its own connection
# before ledger writes, then uses the canonical numbered migration runner.
set -uo pipefail
mode="${MODE:-deploy}"
case "$mode" in deploy|status-only) ;; *) echo 'Invalid migration mode' >&2; exit 1 ;; esac
summary="${RUNNER_TEMP:?RUNNER_TEMP required}/db-migrate-summary.md"
: > "$summary"
failed=0
for target in UAT STAGING; do
  url_var="MC_${target}_DATABASE_URL"
  approved_var="MC_${target}_APPROVED_DB"
  log_file=$(mktemp)
  result=failed
  if [ -z "${!url_var:-}" ] || [ -z "${!approved_var:-}" ]; then
    echo "::error::$target requires $url_var and $approved_var"
    failed=1
  elif PLX_MC_DATABASE_URL="${!url_var}" npm run migrate -- \
    --non-prod --approved-db "${!approved_var}" --mode "$mode" | tee "$log_file"; then
    result="$mode succeeded"
  else
    echo "::error::$target migration or identity guard failed"
    failed=1
  fi
  {
    printf '### %s: %s\n\n' "$target" "$result"
    printf '```text\n'
    # Only filenames/state go into the summary, never URLs or error details.
    grep -E '^(apply |pending |skip )' "$log_file" || printf 'No files reported (not attempted or guard failed).\n'
    printf '```\n\n'
  } >> "$summary"
  rm -f "$log_file"
done
exit "$failed"
