#!/usr/bin/env bash
#
# bootstrap-company-skills.sh — install the company-approved skill subset onto this machine.
#
# Reads config/company-skills-allowlist.json, clones/updates agentic-swarm, copies
# only allowlisted skills into ~/.cursor/skills and ~/.claude/skills, merges any
# project-native skills from the current repo, mirrors into the project, and writes
# ~/.agentic/skills.registry.json.
#
# PLX-MC access alone does NOT install skills — run this once per machine (or after
# allowlist updates). Restart Cursor after completion.
#
# Usage:
#   ./scripts/bootstrap-company-skills.sh [--dry-run] [--project-root DIR]
#                                       [--swarm-repo DIR] [--allowlist FILE]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-${REPO_ROOT}}"
SWARM_REPO="${SWARM_REPO:-${HOME}/agentic-swarm}"
ALLOWLIST="${ALLOWLIST:-${REPO_ROOT}/config/company-skills-allowlist.json}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --project-root) PROJECT_ROOT="$2"; shift 2 ;;
    --swarm-repo) SWARM_REPO="$2"; shift 2 ;;
    --allowlist) ALLOWLIST="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "error: unknown argument: $1" >&2; exit 64 ;;
  esac
done

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN: $*"
  else
    "$@"
  fi
}

if [[ ! -f "$ALLOWLIST" ]]; then
  echo "error: allowlist not found: $ALLOWLIST" >&2
  exit 2
fi

PYTHON=()
if py -3 -c "import sys" >/dev/null 2>&1; then
  PYTHON=(py -3)
elif command -v python3 >/dev/null 2>&1 && python3 -c "import sys" >/dev/null 2>&1; then
  PYTHON=(python3)
elif command -v python >/dev/null 2>&1 && python -c "import sys" >/dev/null 2>&1; then
  PYTHON=(python)
else
  echo "error: python3/python required to read $ALLOWLIST" >&2
  exit 2
fi

{
  read -r SOURCE_REPO
  read -r SOURCE_BRANCH
  read -r PIN_SHA
  read -r SKILLS_CSV
} < <("${PYTHON[@]}" - "$ALLOWLIST" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
skills = data.get("skills") or []
if not skills:
    raise SystemExit("allowlist contains no skills")
print(data.get("sourceRepo", "taylorvalton/agentic-swarm"))
print(data.get("sourceBranch", "main"))
print(data.get("pinSha") or "")
print(",".join(skills))
PY
)

if [[ -z "$SOURCE_REPO" || -z "$SKILLS_CSV" ]]; then
  echo "error: failed to parse allowlist (is Python installed?)" >&2
  exit 2
fi

IFS=',' read -r -a ALLOWED <<< "$SKILLS_CSV"

echo "=== Company skills bootstrap ==="
echo "Allowlist: $ALLOWLIST (${#ALLOWED[@]} skills)"
echo "Swarm repo: $SWARM_REPO"
echo "Project:    $PROJECT_ROOT"

swarm_repo_ready() {
  git -C "$SWARM_REPO" rev-parse --git-dir >/dev/null 2>&1
}

if ! swarm_repo_ready; then
  echo "=== Cloning $SOURCE_REPO ==="
  run git clone "https://github.com/${SOURCE_REPO}.git" "$SWARM_REPO"
elif [[ "$DRY_RUN" -eq 1 ]]; then
  echo "=== Would update $SWARM_REPO ($SOURCE_BRANCH) ==="
else
  echo "=== Updating $SWARM_REPO ==="
  run git -C "$SWARM_REPO" fetch origin "$SOURCE_BRANCH"
  if [[ -n "$PIN_SHA" ]]; then
    run git -C "$SWARM_REPO" checkout "$PIN_SHA"
  else
    run git -C "$SWARM_REPO" switch "$SOURCE_BRANCH" 2>/dev/null || run git -C "$SWARM_REPO" checkout "$SOURCE_BRANCH"
    run git -C "$SWARM_REPO" merge --ff-only "origin/${SOURCE_BRANCH}"
  fi
fi

CURSOR_DEST="${HOME}/.cursor/skills"
CLAUDE_DEST="${HOME}/.claude/skills"
REGISTRY_PATH="${HOME}/.agentic/skills.registry.json"

run mkdir -p "$CURSOR_DEST" "$CLAUDE_DEST" "$(dirname "$REGISTRY_PATH")"

install_skill() {
  local src_root="$1"
  local label="$2"
  local dest="$3"
  local id="$4"
  local src="${src_root}/${id}"
  if [[ ! -d "$src" || ! -f "${src}/SKILL.md" ]]; then
    echo "WARN: skip missing ${label} skill: ${id}" >&2
    return 0
  fi
  echo "  + ${id} (${label})"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN: copy ${src} -> ${dest}/${id}"
  else
    rm -rf "${dest}/${id}"
    cp -R "$src" "${dest}/${id}"
  fi
}

echo "=== Installing allowlisted skills from agentic-swarm ==="
for id in "${ALLOWED[@]}"; do
  [[ -z "$id" ]] && continue
  install_skill "${SWARM_REPO}/.cursor/skills" "cursor" "$CURSOR_DEST" "$id"
  if [[ -d "${SWARM_REPO}/.claude/skills/${id}" ]]; then
    install_skill "${SWARM_REPO}/.claude/skills" "claude" "$CLAUDE_DEST" "$id"
  fi
done

echo "=== Merging project-native skills from ${PROJECT_ROOT}/.cursor/skills ==="
if [[ -d "${PROJECT_ROOT}/.cursor/skills" ]]; then
  for skill_dir in "${PROJECT_ROOT}/.cursor/skills"/*; do
    [[ -d "$skill_dir" ]] || continue
    [[ -f "${skill_dir}/SKILL.md" ]] || continue
    id="$(basename "$skill_dir")"
    echo "  + ${id} (project-native)"
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "DRY-RUN: copy ${skill_dir} -> ${CURSOR_DEST}/${id}"
    else
      rm -rf "${CURSOR_DEST}/${id}"
      cp -R "$skill_dir" "${CURSOR_DEST}/${id}"
      cp -R "$skill_dir" "${CLAUDE_DEST}/${id}" 2>/dev/null || true
    fi
  done
fi

mirror_project() {
  local target="$1"
  run mkdir -p "$target"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN: mirror ${CURSOR_DEST}/* -> ${target}/"
    return 0
  fi
  for skill_dir in "${CURSOR_DEST}"/*; do
    [[ -d "$skill_dir" ]] || continue
    id="$(basename "$skill_dir")"
    rm -rf "${target}/${id}"
    cp -R "$skill_dir" "${target}/${id}"
  done
}

echo "=== Mirroring into project ==="
mirror_project "${PROJECT_ROOT}/.cursor/skills"
mirror_project "${PROJECT_ROOT}/.agents/skills"

echo "=== Writing skills registry ==="
if [[ "$DRY_RUN" -eq 0 ]]; then
  "${PYTHON[@]}" - "$SWARM_REPO" "$CURSOR_DEST" "$CLAUDE_DEST" "$REGISTRY_PATH" <<'PY'
import json, re, sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

repo_root, cursor_dest, claude_dest, registry_path = map(Path, sys.argv[1:5])

def parse_frontmatter(path: Path) -> dict[str, str]:
    raw = path.read_text(encoding="utf-8")
    if not raw.startswith("---"):
        return {}
    end = raw.find("\n---", 3)
    if end == -1:
        return {}
    block = raw[4:end]
    out: dict[str, str] = {}
    for line in block.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        out[key.strip()] = value.strip().strip('"')
    return out

def collect(source: str, src_dir: Path, dest_dir: Path) -> list[dict[str, str]]:
    if not dest_dir.is_dir():
        return []
    skills = []
    for skill_dir in sorted(p for p in dest_dir.iterdir() if p.is_dir()):
        skill_file = skill_dir / "SKILL.md"
        if not skill_file.is_file():
            continue
        fm = parse_frontmatter(skill_file)
        skill_id = fm.get("name") or skill_dir.name
        repo_path = ""
        candidate = src_dir / skill_dir.name / "SKILL.md"
        if candidate.is_file():
            repo_path = str(candidate.relative_to(repo_root))
        skills.append(
            {
                "id": skill_id,
                "name": fm.get("name") or skill_id,
                "description": fm.get("description") or "",
                "source": source,
                "repo_path": repo_path,
                "global_path": str(skill_file),
            }
        )
    return skills

payload = {
    "schema_version": "agentic-skills-registry.v1",
    "catalog": "plx-company-skills-allowlist/v1",
    "generated_at_et": datetime.now(ZoneInfo("America/New_York")).isoformat(timespec="seconds"),
    "source_repo": str(repo_root),
    "install_targets": {"cursor": str(cursor_dest), "claude": str(claude_dest)},
    "skills": collect("cursor", repo_root / ".cursor" / "skills", cursor_dest)
    + collect("claude", repo_root / ".claude" / "skills", claude_dest),
}
registry_path.parent.mkdir(parents=True, exist_ok=True)
registry_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
print(f"Registry: {registry_path} ({len(payload['skills'])} skills)")
PY
fi

CURSOR_COUNT=0
REGISTRY_COUNT=0
if [[ "$DRY_RUN" -eq 0 ]]; then
  CURSOR_COUNT="$(find "$CURSOR_DEST" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
  if [[ -f "$REGISTRY_PATH" ]]; then
    REGISTRY_COUNT="$("${PYTHON[@]}" -c "import json; print(len(json.load(open('$REGISTRY_PATH'))['skills']))")"
  fi
fi

echo ""
echo "=== Bootstrap complete ==="
echo "Global Cursor skills: ${CURSOR_COUNT:-dry-run}"
echo "Registry skills:      ${REGISTRY_COUNT:-dry-run}"
echo "Restart Cursor to load new skills (session start only)."
echo ""
echo "PLX-MC MCP (task checkout) is separate — see docs/COLLABORATOR-SOP.md §9."
