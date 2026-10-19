// Pure helpers for the capture pipeline (TASK-3167), plus `node demos/lib.mjs plan`,
// which assemble.sh runs. Tested in tests/knowledge-video-pipeline.test.ts.
import { readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { pathToFileURL } from 'url'

/** Silence after each beat's narration, in seconds. */
export const BEAT_PAD = 0.8

/**
 * The narration voice. ElevenLabs when its key is set. Otherwise Piper, the
 * fallback Vince approved on 2026-10-17, when PIPER_MODEL names a voice (.onnx).
 * The voice string goes into narration.json, metadata.yml and the MC artifact.
 */
export function chooseNarrator(env, cfg) {
  if (env.ELEVENLABS_API_KEY) {
    return { provider: 'elevenlabs', voice: `elevenlabs:${cfg.voice}`, ext: 'mp3', apiKey: env.ELEVENLABS_API_KEY }
  }
  if (env.PIPER_MODEL) {
    const model = basename(env.PIPER_MODEL).replace(/\.onnx$/, '')
    return { provider: 'piper', voice: `piper:${model}`, ext: 'wav', model: env.PIPER_MODEL, bin: env.PIPER_BIN || 'piper' }
  }
  return {
    error:
      'No narration voice. Set ELEVENLABS_API_KEY, or set PIPER_MODEL to a Piper voice (.onnx) for the approved fallback.',
  }
}

/** ffmpeg arguments that turn one still image into a beat clip: 1600x900, 30 fps, white letterbox. */
export function stillBeatArgs({ image, seconds, out }) {
  return [
    '-y', '-loglevel', 'error',
    '-loop', '1', '-framerate', '30', '-i', image,
    '-t', String(seconds),
    '-vf', 'scale=1600:900:force_original_aspect_ratio=decrease,pad=1600:900:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', '30',
    out,
  ]
}

/** Each beat's on-screen length (narration + pad) and its narration file. */
export function beatPlan(beats, narration, pad = BEAT_PAD) {
  return beats.map((beat) => {
    const seconds = narration.durations[beat.slug]
    if (typeof seconds !== 'number') throw new Error(`No narration for beat ${beat.slug}. Run narrate-beats.mjs first.`)
    return { slug: beat.slug, seconds: Math.round((seconds + pad) * 1000) / 1000, audio: narration.files[beat.slug] }
  })
}

/** 75.5 -> "00:01:15,500" */
export function srtTime(seconds) {
  const ms = Math.round(seconds * 1000)
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
}

/**
 * Caption cues: one per sentence, timed inside its beat's narration in
 * proportion to its word count. Deterministic, so the burned captions and the
 * side-car SRT never drift apart.
 */
export function captionCues(beats, narration, pad = BEAT_PAD) {
  const cues = []
  let offset = 0
  for (const beat of beats) {
    const spoken = narration.durations[beat.slug]
    const sentences = beat.narration.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
    const words = sentences.map((s) => s.split(/\s+/).length)
    const total = words.reduce((a, b) => a + b, 0)
    let at = offset
    sentences.forEach((text, i) => {
      const length = (spoken * words[i]) / total
      cues.push({ start: at, end: at + length, text })
      at += length
    })
    offset += spoken + pad
  }
  return cues
}

export function toSrt(cues) {
  return cues.map((cue, i) => `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join('\n')
}

/** `node demos/lib.mjs plan <demos dir> <out dir>`: writes plan.tsv (slug, seconds, audio file) and demo.srt. */
function writePlan(demosDir, outDir) {
  const { beats } = JSON.parse(readFileSync(join(demosDir, 'beats.json'), 'utf8'))
  const narration = JSON.parse(readFileSync(join(demosDir, 'clips', 'audio', 'narration.json'), 'utf8'))
  const plan = beatPlan(beats, narration)
  writeFileSync(join(outDir, 'plan.tsv'), plan.map((p) => `${p.slug}\t${p.seconds}\t${p.audio}\n`).join(''))
  writeFileSync(join(outDir, 'demo.srt'), toSrt(captionCues(beats, narration)))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, demosDir, outDir] = process.argv.slice(2)
  if (command !== 'plan' || !demosDir || !outDir) {
    console.error('usage: node demos/lib.mjs plan <demos dir> <out dir>')
    process.exit(2)
  }
  writePlan(demosDir, outDir)
}
