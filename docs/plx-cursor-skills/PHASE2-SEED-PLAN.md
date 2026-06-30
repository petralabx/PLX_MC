# Phase 2 — Seed `plx-cursor-skills` from allowlist

## Goal

Create private repo `taylorvalton/plx-cursor-skills` with the **29 company skills** currently listed in `config/company-skills-allowlist.json`. After seed, Phase 1 bootstrap can be repointed from agentic-swarm clone → this repo (optional flag `--skills-repo`).

## Seed script (operator-run once)

```bash
# From a machine with agentic-swarm checked out at main
ALLOWLIST=/path/to/PLX_MC/config/company-skills-allowlist.json
SWARM=/path/to/agentic-swarm
OUT=/path/to/plx-cursor-skills

mkdir -p "$OUT/skills"
python3 - "$ALLOWLIST" "$SWARM" "$OUT" <<'PY'
import json, shutil, sys
from pathlib import Path

allowlist, swarm, out = map(Path, sys.argv[1:4])
data = json.loads(allowlist.read_text())
for sid in data["skills"]:
    src = swarm / ".cursor" / "skills" / sid
    dst = out / "skills" / sid
    if not (src / "SKILL.md").is_file():
        raise SystemExit(f"missing: {src}")
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
print(f"Copied {len(data['skills'])} skills to {out / 'skills'}")
PY

# Generate full manifest entries (operator fills gitRef, emails, tags)
# Commit, tag v1.0.0, register repo in PLX_MC Skills Directory
```

## Post-seed checklist

- [ ] All 29 `skills/<id>/SKILL.md` present
- [ ] `manifest.json` validates against `manifest.schema.json`
- [ ] No operator-only skills (loop, vmc-autopilot, trading-lab, etc.)
- [ ] PLX_MC `bootstrap-company-skills.sh` supports `--skills-repo` URL (Phase 2 PR)
- [ ] MC catalog row pins `manifest.version` + `gitRef`

## Skill ids in v1.0.0 bundle

See `config/company-skills-allowlist.json` — identical to `packages[].skillIds` in `manifest.example.json`.
