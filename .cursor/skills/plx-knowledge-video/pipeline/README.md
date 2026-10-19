# plx-knowledge-video — repeatable capture pipeline

A **narration-first, per-beat** pipeline that produces clean, captioned, smart-zoom
Knowledge Hub videos of a live web app — reliably and repeatably. It wraps the
`AlexAnsart/demo-studio` `film-demo` engine and solves the two problems that make
naive screen-recording of a real app fail:

1. **No white load screens.** Each beat's page is navigated + fully loaded
   **off-camera**; recording starts only once the page is rendered. Load spinners
   are never captured.
2. **Passes the compose FPS gate on static pages.** During each on-screen hold the
   engine's change-driven screencast would emit no frames (choppy, gate-failing).
   `capture-beat.mjs` runs an **`activeHold`** — an imperceptible cursor drift — so
   frames keep flowing at ~60fps and compose's `fps>=25 / p90<=80ms` gate passes.

Each beat is recorded at its own narration length and stitched, so audio and video
stay in sync with **no global time-stretch** (stretching is what magnifies any
residual load flashes — we don't do it).

## One-time setup (per machine)

```bash
# 1. install demo-studio (film-demo engine + narrate/sync skills)
npx skills add AlexAnsart/demo-studio --skill '*' -a cursor --copy -g -y

# 2. scaffold a project dir with the engine vendored in:
#    demos/_engine/  = copy of the installed film-demo/scripts/*.mjs
#    demos/_lib/     = paths.mjs + auth.mjs from the demo-setup templates/
#    demos/          = the files in THIS folder (capture-beat.mjs, narrate-beats.mjs,
#                      still-beat.mjs, lib.mjs, beats.json, assemble.sh)
#    demo.config.json at the project root (see demo.config.example.json)
cd <project>/demos/_engine && npm install && npx playwright install chromium

# 3. narration
# ElevenLabs: export ELEVENLABS_API_KEY
# or the approved Piper fallback: pip install piper-tts, download a voice (.onnx + .onnx.json),
#   export PIPER_MODEL=/path/to/en_US-lessac-medium.onnx   (PIPER_BIN if piper is not on PATH)
# ffmpeg needs libass for the burned captions (most builds have it).
```

## Author a video

1. Edit `beats.json` — one entry per beat: `slug`, `url`, optional `clickText`
   (click after load), `scrollTo`, `focusText` (the **small** element to zoom into —
   pick something tight, e.g. a status pill or a "Remaining 0.00" cell, so the zoom is
   real; full-width targets barely zoom), and the `narration` sentence(s).
   A **still beat** has `image` (a PNG, JPEG or WebP path under `demos/`) instead of
   `url`: a diagram or annotated screenshot held for its narration. Stills need no
   browser or login, so non-UI work (a migration, a flow across systems) gets a video.
2. Set `demo.config.json` → `app.baseUrl` (the running app) and `auth` (login
   selectors + `credentialsEnv`). Export the login + `ELEVENLABS_API_KEY` env vars.

## Run

```bash
export DEMO_USER_EMAIL=... DEMO_USER_PASSWORD=... ELEVENLABS_API_KEY=...
node demos/narrate-beats.mjs                       # 1 audio file per beat + narration.json
# per page beat: capture (hold = narration + pad) then compose --no-speedup
node demos/capture-beat.mjs --slug <s> --url <path> [--clickText ..] [--focusText ..] \
     [--scrollTo ..] --endOnFocus --hold <narrationSec+1.3>
node demos/_engine/compose.mjs demos/clips/<s> --preset studio-dark --no-speedup
node demos/still-beat.mjs                          # every still beat
bash demos/assemble.sh                             # freeze-to-length + concat + captions + mux
```

`assemble.sh` extends each beat clip to its narration length (freezing the final
frame), concatenates the clips and per-beat audio, writes `demo.srt` (one cue per
sentence, timed inside its beat by word count), burns those captions, `loudnorm`s the
voice to −16 LUFS and muxes H.264 + AAC. Output: `demos/out/demo.mp4`, `demo.srt` and
`narration.json` (the voice: `elevenlabs:<voice id>` or `piper:<model>`).

## Notes / gotchas

- **`--endOnFocus`** keeps the camera on the zoomed key content for the hold, so the
  freeze in `assemble.sh` rests on the payoff instead of a wide shot.
- **`--no-speedup`** on compose is required — the default idle-speedup collapses holds.
- Recording against a **fast pre-built/deployed environment** keeps captures smooth; a
  heavy local dev server can still trip the FPS gate even with `activeHold`.
- No ElevenLabs key? Set `PIPER_MODEL` for the approved **Piper** fallback;
  `narration.json` records it, and you copy it into `metadata.yml` (see `reference.md`).
- Explainer for a Mission Control task (TASK-3167): upload `demos/out/demo.mp4` with
  `mc_upload_evidence` (`kind: "video"`, `filePath`, `narrationVoice` from `narration.json`).
- `beats.example.json` / `demo.config.example.json` are the working P2P pilot config.
