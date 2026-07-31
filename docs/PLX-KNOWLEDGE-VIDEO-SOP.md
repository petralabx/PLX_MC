# PLX Knowledge Video — Contributor SOP

**Audience:** PLX contributors producing Knowledge Hub how-to, onboarding, or
workflow videos for PLX Portal or Mission Control.

**Owner:** Vince · **Status:** active · **Effective:** 2026-07-31

> **TL;DR** — `plx-knowledge-video` is the PLX package-and-editorial wrapper
> around demo-studio. Install the company-approved skill pinned to immutable tag
> `v1.6.2`, start a **new Cursor session**, scaffold demo-studio once per
> project, and record only a seeded non-production flow. Catalog approval makes
> a skill eligible for company installation; it does **not** install it locally.

---

## 1. What the skill is

`plx-knowledge-video` orchestrates demo-studio's `demo-setup`, `film-demo`,
`narrate`, `sync-narration`, and `produce-video` skills. demo-studio owns
recording, camera movement, narration, alignment, captions, and verification.
`plx-knowledge-video` owns the PLX Knowledge Hub package contract, Executive /
Finance tone, control-point annotations, and accuracy rules.

Use it when asked to record, publish, or refresh a PLX workflow video. It must
film the running application as it exists; it must not fabricate UI, business
rules, integrations, or unimplemented steps.

---

## 2. Company catalog and the “global allowlist”

The governed company catalog is
[`petralabx/skills`](https://github.com/petralabx/skills). Its published
manifest package is the effective **global allowlist**: only reviewed,
published skill IDs in the pinned package may be distributed to contributor
machines. PLX_MC currently pins that catalog to immutable release tag
**`v1.6.2`**, which resolves to one commit.

These states are different:

1. **Approved/published in the catalog** — eligible for company use.
2. **Pinned by PLX_MC** — the approved release contributors must resolve.
3. **Installed locally** — copied to `~/.cursor/skills/` on this machine.
4. **Loaded in Cursor** — discovered when a new Agent session starts.

Approval or pinning does not perform local installation. PLX-MC MCP
registration also does not install skills. The deprecated
`config/company-skills-allowlist.json` is not the source of truth; use
`config/skills-catalog.json` and the pinned catalog manifest.

---

## 3. Install globally

Prerequisites for the company bootstrap are Git, Python 3, a current PLX_MC
checkout, and Git Bash on Windows. The bootstrap installs the complete approved
package globally and mirrors it into the current project.

### Windows — PLX_MC bootstrap

```powershell
cd C:\path\to\PLX_MC
git pull --ff-only origin main
.\scripts\bootstrap-company-skills.ps1
```

Dry run:

```powershell
.\scripts\bootstrap-company-skills.ps1 -DryRun
```

### macOS / Linux — PLX_MC bootstrap

```bash
cd /path/to/PLX_MC
git pull --ff-only origin main
./scripts/bootstrap-company-skills.sh
```

Dry run:

```bash
./scripts/bootstrap-company-skills.sh --dry-run
```

Confirm the bootstrap reports `petralabx/skills` and tag `v1.6.2`. Do not
install from `agentic-swarm` or the historical
`taylorvalton/plx-cursor-skills` repository.

### Single-skill install through PLX-MC MCP

With PLX-MC MCP registered, call `mc_install_skills` with:

```json
{
  "ids": ["plx-knowledge-video"],
  "mode": "install",
  "runtimes": ["cursor"]
}
```

Omit `projectRoot`; that makes the generated destination global
(`~/.cursor/skills/plx-knowledge-video`). Confirm the response says
`sourceRepo: petralabx/skills`, `gitRef: v1.6.2`, has no unknown skill IDs, and
then run the returned PowerShell script on Windows or bash script on
macOS/Linux. The MCP call returns an install script; it does not silently write
to the workstation.

---

## 4. Verify, load, and invoke

Verify the files before restarting Cursor.

Windows:

```powershell
Test-Path "$HOME\.cursor\skills\plx-knowledge-video\SKILL.md"
Select-String -Path "$HOME\.agentic\skills.registry.json" -Pattern '"plx-knowledge-video"'
```

macOS / Linux:

```bash
test -f ~/.cursor/skills/plx-knowledge-video/SKILL.md
grep -q '"plx-knowledge-video"' ~/.agentic/skills.registry.json
```

Both commands must succeed. Then start a **fresh Cursor Agent session**.
Skills load at session start and **do not hot-reload** into an existing chat.

Invoke explicitly, for example:

> Use `plx-knowledge-video` to produce a Knowledge Hub package for the
> `<flow-name>` flow against `https://staging.plxcustomer.io`.

Cursor may also select it from requests to record, film, publish, or refresh a
PLX Knowledge Hub how-to video. Confirm the agent reads the skill before it
starts work.

---

## 5. Provision demo-studio and machine dependencies

Install the demo-studio family globally:

```bash
npx skills add AlexAnsart/demo-studio --skill '*' -a cursor --copy -g -y
```

The installer places these shared Cursor skills under `~/.agents/skills/`:
`demo-setup`, `film-demo`, `narrate`, `produce-video`, and
`sync-narration`.

Required on the machine:

- Node.js 18 or newer and npm
- `ffmpeg` and `ffprobe` on `PATH`
- Python 3 and `faster-whisper`
- Playwright Chromium
- bash for `demos/assemble.sh` (Git Bash on Windows)

Provision the runtime dependencies after the project scaffold exists:

```bash
cd <project>/demos/_engine
npm install
npx playwright install chromium
pip install faster-whisper
```

For narration, provision `ELEVENLABS_API_KEY`. If it is unavailable, stop and
obtain explicit approval before using local Piper (`pip install piper-tts`).
Record any approved fallback in `metadata.yml` and `how-to.md`; never silently
substitute a voice or ship a silent video when narration was requested.

Required environment variable names:

- `ELEVENLABS_API_KEY`
- `DEMO_USER_EMAIL`
- `DEMO_USER_PASSWORD`

Never put values in committed config, scripts, narration, screenshots, or
video. Store demo credentials in the project's gitignored `.env` or the
approved local secret store.

---

## 6. Environment and authentication rules

- Film only a seeded, non-production build. Prefer
  `https://staging.plxcustomer.io` in `demo.config.json`.
- Use a dedicated, least-privilege demo account and environment-specific
  credentials. Never use production credentials.
- Never film real customer or vendor PII. Use synthetic records that are safe
  to publish internally.
- Configure login selectors and `credentialsEnv`; authenticate and seed state
  off-camera. Do not record the login flow unless it is itself the approved
  subject.
- Confirm the exact flow is reachable and clickable end-to-end before
  narration. If an integration or step is unavailable, stop, mark it
  `NOT IMPLEMENTED` in the process outline, and exclude it from the video.
- Record the filmed branch or commit SHA and staging base URL in
  `metadata.yml`.

Example auth shape, with names only:

```json
{
  "app": {
    "baseUrl": "https://staging.plxcustomer.io",
    "viewport": { "width": 1600, "height": 900 }
  },
  "auth": {
    "loginRequired": true,
    "loginPath": "/login",
    "emailSelector": "#email",
    "passwordSelector": "#password",
    "submitSelector": "button[type=submit]",
    "credentialsEnv": {
      "email": "DEMO_USER_EMAIL",
      "password": "DEMO_USER_PASSWORD"
    }
  }
}
```

---

## 7. One-time project scaffold

Run the installed `demo-setup` skill once per project, or reproduce its
documented scaffold:

```text
<project>/
├── demo.config.json
└── demos/
    ├── _engine/          # installed film-demo scripts/*.mjs
    ├── _lib/             # demo-setup templates paths.mjs + auth.mjs
    ├── capture-beat.mjs
    ├── narrate-beats.mjs
    ├── assemble.sh
    └── beats.json
```

Copy `capture-beat.mjs`, `narrate-beats.mjs`, `assemble.sh`, and the example
configs from the installed `plx-knowledge-video/pipeline/`. Copy the entire
installed `film-demo/scripts/` directory to `demos/_engine/`, and copy
`paths.mjs` plus `auth.mjs` from `demo-setup/templates/` to `demos/_lib/`.
Keep secrets out of `demo.config.json`.

Verify the scaffold before authoring:

```bash
node <demo-setup-skill-dir>/scripts/check-setup.mjs
node demos/_engine/test-engine.mjs
```

Both commands must exit zero.

---

## 8. Author the process, beats, and config

First write `knowledge/<flow-slug>/process-outline.md` from the running app.
List each user action, system-of-record effect, control or approval, annotation
opportunity, and implementation status. It is the ordered source of truth for
the video; do not idealize missing behavior.

In `demos/beats.json`, author one entry per narration beat:

- `slug` — stable, ordered identifier
- `url` — path under the configured staging base URL
- `narration` — concise Executive / Finance narration
- `clickText` — optional action after off-camera load
- `scrollTo` — optional content to bring into view
- `focusText` — optional tight control-point target for smart zoom

Keep narration professional and control-oriented: explain approvals,
segregation of duties, auditability, status transitions, matching,
reconciliation, and system-of-record effects—not mouse movements. Mention an
integration only when the running build performs it.

In `demo.config.json`, set the staging `app.baseUrl`, viewport, login selectors,
`credentialsEnv`, camera/frame settings, captions, and narration provider.
Choose **2–5** meaningful focus moments across the finished video. Use a small,
specific target; return wide after a submit so the result remains visible.

---

## 9. Narration-first run

Run from the project root after the required environment variables are present.

```bash
node demos/narrate-beats.mjs

node demos/capture-beat.mjs --slug <slug> --url <path> \
  [--clickText <text>] [--focusText <text>] [--scrollTo <text>] \
  --endOnFocus --hold <narration-seconds-plus-1.3>

node demos/_engine/compose.mjs demos/clips/<slug> \
  --preset studio-dark --no-speedup

bash demos/assemble.sh
```

Repeat capture and compose for every beat. Narration must come first because
`demos/clips/audio/durations.json` sizes each on-screen hold. `--no-speedup` is
required; the default idle speed-up collapses narration holds. The pipeline
preloads pages off-camera, uses `activeHold` to keep static captures above the
FPS gate, freezes each final beat frame to narration length, concatenates the
beats, aligns captions with faster-whisper, burns captions, and normalizes
audio. Do not globally time-stretch the finished recording.

---

## 10. Required Knowledge Hub package

Deliver one reviewable directory:

```text
knowledge/<flow-slug>/
├── demo.mp4
├── demo.srt
├── how-to.md
├── metadata.yml
└── process-outline.md
```

- `demo.mp4`: narrated final video with burned-in captions
- `demo.srt`: sidecar captions from the same alignment plan
- `how-to.md`: required frontmatter, Executive summary, and steps matching the
  video 1:1
- `metadata.yml`: stable asset metadata, measured duration, actual narration
  provider/voice, source app, staging URL, filmed git ref, status, and date
- `process-outline.md`: implemented and not-implemented truth from the running
  build

The final target is **3–5 minutes**, 2–5 control-point smart zooms, and visual
emphasis only on controls that actually appear.

PLX_MC currently has **no canonical Knowledge Hub upload API**. Do not invent
one. Final package handoff and publish remain operator-reviewed until a
canonical ingestion path exists; keep status `draft` until that review occurs.

---

## 11. Quality gate and executable checklist

For every captured beat:

```bash
node demos/_engine/guardrails.mjs demos/clips/<slug>
node demos/_engine/inspect.mjs demos/clips/<slug> --alerts
node demos/_engine/verify.mjs demos/clips/<slug>
```

Require zero unjustified guardrail alerts and `pass:true`. Inspect the generated
frames; commands alone do not prove that crops, cursor position, text, and
rendered state are visually correct. Capture must meet the demo-studio FPS gate
(`capturedFps >= 25`, frame-interval p90 `<= 80ms`), captions must align with
the narration, and no opening load screen, error, repeated click, or stale
state may appear.

Run this package check from Git Bash/macOS/Linux:

```bash
FLOW=knowledge/<flow-slug>
test -s "$FLOW/demo.mp4"
test -s "$FLOW/demo.srt"
test -s "$FLOW/how-to.md"
test -s "$FLOW/metadata.yml"
test -s "$FLOW/process-outline.md"
ffprobe -v error -show_entries format=duration \
  -of default=nw=1:nk=1 "$FLOW/demo.mp4"
grep -q '^video: ./demo.mp4$' "$FLOW/how-to.md"
grep -q '^captions: ./demo.srt$' "$FLOW/how-to.md"
grep -q '^status: draft$' "$FLOW/metadata.yml"
```

Before handoff, also confirm:

- narration is Executive / Finance, control- and visibility-oriented;
- every filmed step exists in the running staging build;
- the process outline and video match 1:1;
- the SRT and burned captions come from the same alignment;
- `metadata.yml` records the actual provider, staging source, and git ref;
- no secrets, PII, production credentials, or unapproved environment details
  appear in any asset.

---

## 12. Troubleshooting

| Symptom | Resolution |
|---|---|
| Skill is approved but missing locally | Approval is not installation. Run the bootstrap or global `mc_install_skills` flow. |
| Skill installed during this chat but unavailable | Start a new Cursor session; skills do not hot-reload. |
| MCP script installs into a project | Re-run without `projectRoot` for the global `~/.cursor/skills` destination. |
| Bootstrap resolves the wrong source/ref | Stop. It must report `petralabx/skills` at immutable tag `v1.6.2`. |
| `ffmpeg` or `ffprobe` is missing | Install it and restore both commands to `PATH`; downstream stages cannot run. |
| Playwright cannot launch Chromium | Run `npm install` and `npx playwright install chromium` in `demos/_engine`. |
| Narration key is absent | Stop for the key or explicit Piper approval; never silently change the deliverable. |
| Login or a workflow step fails | Fix staging/auth or document the gap; do not fake, stitch, or film production. |
| White load screen appears | Use the per-beat pipeline; it loads and settles each page off-camera. |
| Compose fails FPS/p90 | Reduce machine load, use a fast pre-built staging environment, and retain `activeHold`. |
| Holds collapse | Compose with `--no-speedup` and size `--hold` from narration duration. |
| Zoom is ineffective | Target a small status, amount, approval, or match indicator rather than a full-width container. |
| Captions drift | Regenerate burned captions and SRT from the same faster-whisper alignment plan. |

---

## 13. Rollback and uninstall

Local uninstall does not change catalog approval.

Windows:

```powershell
Remove-Item -Recurse -Force "$HOME\.cursor\skills\plx-knowledge-video"
```

macOS / Linux:

```bash
rm -rf ~/.cursor/skills/plx-knowledge-video
```

Start a new Cursor session after removal. The local registry may report the
skill as stale until the next governed sync; do not delete other skills or the
whole registry. Running the company bootstrap again will reinstall the skill
because it remains in the approved pinned package.

Removing the global skill does not remove a project's vendored `demos/`
engine, configs, recordings, or `knowledge/` package. Remove project artifacts
only through normal source-control review after confirming they are no longer
needed.

---

## 14. Canonical sources

- Immutable skill:
  https://github.com/petralabx/skills/tree/v1.6.2/skills/plx-knowledge-video
- Skill contract:
  https://github.com/petralabx/skills/blob/v1.6.2/skills/plx-knowledge-video/SKILL.md
- Package schemas:
  https://github.com/petralabx/skills/blob/v1.6.2/skills/plx-knowledge-video/reference.md
- Repeatable pipeline:
  https://github.com/petralabx/skills/blob/v1.6.2/skills/plx-knowledge-video/pipeline/README.md
- Company catalog:
  https://github.com/petralabx/skills
- demo-studio:
  https://github.com/AlexAnsart/demo-studio
- PLX company skills SOP: `docs/SKILLS-SOP.md`
- PLX catalog pin: `config/skills-catalog.json`

**Questions or false blocks:** Vince (accountable owner), TASK-879.
