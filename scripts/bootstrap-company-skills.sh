#!/usr/bin/env bash
#
# bootstrap-company-skills.sh — install company-approved skills onto this machine.
#
# Clones/updates taylorvalton/plx-cursor-skills, installs published skills from
# manifest.json, merges project-native skills, mirrors into the project, and writes
# ~/.agentic/skills.registry.json.
#
# PLX-MC access alone does NOT install skills — run this once per machine (or after
# catalog updates). Restart Cursor after completion.
#
# Usage:
#   ./scripts/bootstrap-company-skills.sh [--dry-run] [--project-root DIR]
#                                       [--skills-repo DIR] [--allowlist FILE]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-${REPO_ROOT}}"
SKILLS_REPO="${SKILLS_REPO:-${HOME}/plx-cursor-skills}"
ALLOWLIST="${ALLOWLIST:-${REPO_ROOT}/config/company-skills-allowlist.json}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --project-root) PROJECT_ROOT="$2"; shift 2 ;;
    --skills-repo|--swarm-repo) SKILLS_REPO="$2"; shift 2 ;;
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
  read -r PIN_TAG
  read -r MANIFEST_PATH
  read -r PACKAGE_ID
  read -r SKILLS_CSV
} < <("${PYTHON[@]}" - "$ALLOWLIST" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
skills = data.get("skills") or []
if not skills:
    raise SystemExit("allowlist contains no skills")
print(data.get("sourceRepo", "taylorvalton/plx-cursor-skills"))
print(data.get("sourceBranch", "main"))
print(data.get("pinSha") or "")
print(data.get("pinTag") or "")
print(data.get("manifestPath", "manifest.json"))
print(data.get("packageId") or "")
print(",".join(skills))
PY
)

trim_var() { printf '%s' "$1" | tr -d '\r\n'; }
SOURCE_REPO="$(trim_var "$SOURCE_REPO")"
SOURCE_BRANCH="$(trim_var "$SOURCE_BRANCH")"
PIN_SHA="$(trim_var "$PIN_SHA")"
PIN_TAG="$(trim_var "$PIN_TAG")"
MANIFEST_PATH="$(trim_var "$MANIFEST_PATH")"
PACKAGE_ID="$(trim_var "$PACKAGE_ID")"
SKILLS_CSV="$(trim_var "$SKILLS_CSV")"

if [[ -z "$SOURCE_REPO" || -z "$SKILLS_CSV" ]]; then
  echo "error: failed to parse allowlist (is Python installed?)" >&2
  exit 2
fi

IFS=',' read -r -a ALLOWLIST_IDS <<< "$SKILLS_CSV"

echo "=== Company skills bootstrap ==="
echo "Catalog:    $SOURCE_REPO ($SOURCE_BRANCH${PIN_TAG:+, tag $PIN_TAG})"
echo "Skills repo: $SKILLS_REPO"
echo "Project:     $PROJECT_ROOT"

skills_repo_ready() {
  git -C "$SKILLS_REPO" rev-parse --git-dir >/dev/null 2>&1
}

if ! skills_repo_ready; then
  echo "=== Cloning $SOURCE_REPO ==="
  run git clone "https://github.com/${SOURCE_REPO}.git" "$SKILLS_REPO"
elif [[ "$DRY_RUN" -eq 1 ]]; then
  echo "=== Would update $SKILLS_REPO ($SOURCE_BRANCH) ==="
else
  echo "=== Updating $SKILLS_REPO ==="
  run git -C "$SKILLS_REPO" fetch origin --tags "$SOURCE_BRANCH"
  if [[ -n "$PIN_SHA" ]]; then
    run git -C "$SKILLS_REPO" checkout "$PIN_SHA"
  elif [[ -n "$PIN_TAG" ]]; then
    run git -C "$SKILLS_REPO" checkout "$PIN_TAG"
  else
    run git -C "$SKILLS_REPO" switch "$SOURCE_BRANCH" 2>/dev/null || run git -C "$SKILLS_REPO" checkout "$SOURCE_BRANCH"
    run git -C "$SKILLS_REPO" merge --ff-only "origin/${SOURCE_BRANCH}"
  fi
fi

MANIFEST_FILE="${SKILLS_REPO}/${MANIFEST_PATH}"
if [[ ! -f "$MANIFEST_FILE" && "$DRY_RUN" -eq 0 ]]; then
  echo "error: manifest not found: $MANIFEST_FILE" >&2
  exit 2
fi

INSTALL_CSV="$("${PYTHON[@]}" - "$MANIFEST_FILE" "$PACKAGE_ID" "$SKILLS_CSV" <<'PY'
import json, sys
from pathlib import Path

manifest_path, package_id, allow_csv = sys.argv[1:4]
allow = {s.strip() for s in allow_csv.split(",") if s.strip()}
path = Path(manifest_path)
if not path.is_file():
    print(",".join(sorted(allow)))
    raise SystemExit(0)
data = json.loads(path.read_text(encoding="utf-8"))
ids = []
if package_id:
    pkg = next((p for p in data.get("packages") or [] if p.get("id") == package_id), None)
    if pkg:
        ids = [s for s in pkg.get("skillIds") or [] if s in allow]
if not ids:
    ids = [
        s["id"]
        for s in data.get("skills") or []
        if s.get("status") == "published" and s.get("id") in allow
    ]
if not ids:
    ids = sorted(allow)
print(",".join(ids))
PY
)"
IFS=',' read -r -a INSTALL_IDS <<< "$INSTALL_CSV"

CURSOR_DEST="${HOME}/.cursor/skills"
CLAUDE_DEST="${HOME}/.claude/skills"
REGISTRY_PATH="${HOME}/.agentic/skills.registry.json"
SKILLS_SRC="${SKILLS_REPO}/skills"

run mkdir -p "$CURSOR_DEST" "$CLAUDE_DEST" "$(dirname "$REGISTRY_PATH")"

install_skill() {
  local id="$1"
  local src="${SKILLS_SRC}/${id}"
  if [[ ! -d "$src" || ! -f "${src}/SKILL.md" ]]; then
    echo "WARN: skip missing skill: ${id}" >&2
    return 0
  fi
  echo "  + ${id}"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN: copy ${src} -> ${CURSOR_DEST}/${id} (+ claude)"
  else
    rm -rf "${CURSOR_DEST}/${id}" "${CLAUDE_DEST}/${id}"
    cp -R "$src" "${CURSOR_DEST}/${id}"
    cp -R "$src" "${CLAUDE_DEST}/${id}"
  fi
}

echo "=== Installing ${#INSTALL_IDS[@]} published skills from plx-cursor-skills ==="
for id in "${INSTALL_IDS[@]}"; do
  [[ -z "$id" ]] && continue
  install_skill "$id"
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
      rm -rf "${CURSOR_DEST}/${id}" "${CLAUDE_DEST}/${id}"
      cp -R "$skill_dir" "${CURSOR_DEST}/${id}"
      cp -R "$skill_dir" "${CLAUDE_DEST}/${id}"
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
  "${PYTHON[@]}" - "$SKILLS_REPO" "$MANIFEST_FILE" "$CURSOR_DEST" "$CLAUDE_DEST" "$REGISTRY_PATH" <<'PY'
import json, sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

repo_root, manifest_path, cursor_dest, claude_dest, registry_path = map(Path, sys.argv[1:6])

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

manifest = {}
if manifest_path.is_file():
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

payload = {
    "schema_version": "agentic-skills-registry.v1",
    "catalog": manifest.get("schemaVersion", "plx-cursor-skills-manifest/v1"),
    "catalog_version": manifest.get("version"),
    "generated_at_et": datetime.now(ZoneInfo("America/New_York")).isoformat(timespec="seconds"),
    "source_repo": str(repo_root),
    "install_targets": {"cursor": str(cursor_dest), "claude": str(claude_dest)},
    "skills": collect("plx-cursor-skills", repo_root / "skills", cursor_dest),
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
