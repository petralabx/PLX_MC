// Narration-first: render one audio file per beat and record its duration.
// The per-beat duration then sizes each beat's on-screen hold, so audio and
// video stay in sync with no time-stretching.
// Voice: ElevenLabs when ELEVENLABS_API_KEY is set; otherwise Piper when
// PIPER_MODEL names a voice (.onnx), the fallback approved on 2026-10-17.
// narration.json records the voice for metadata.yml and the MC video artifact.
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { chooseNarrator } from './lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cfg = JSON.parse(readFileSync(join(__dirname, 'beats.json'), 'utf8'))
const narrator = chooseNarrator(process.env, cfg)
if (narrator.error) { console.error(narrator.error); process.exit(1) }
const audioDir = join(__dirname, 'clips', 'audio')
mkdirSync(audioDir, { recursive: true })

function ffprobeDur(p) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', p], { encoding: 'utf8' })
  return parseFloat(out.trim())
}

async function elevenlabs(text, out) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${cfg.voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': narrator.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: cfg.model, voice_settings: { stability: 0.5, similarity_boost: 0.8, use_speaker_boost: true } }),
  })
  if (!res.ok) throw new Error(`TTS failed: ${res.status} ${await res.text()}`)
  writeFileSync(out, Buffer.from(await res.arrayBuffer()))
}

function piper(text, out) {
  execFileSync(narrator.bin, ['--model', narrator.model, '--output_file', out], { input: text, stdio: ['pipe', 'ignore', 'inherit'] })
}

const durations = {}
const files = {}
for (const b of cfg.beats) {
  const file = `${b.slug}.${narrator.ext}`
  const out = join(audioDir, file)
  try {
    if (narrator.provider === 'elevenlabs') await elevenlabs(b.narration, out)
    else piper(b.narration, out)
  } catch (err) {
    console.error(`narration failed for ${b.slug}: ${err.message}`)
    process.exit(1)
  }
  files[b.slug] = file
  durations[b.slug] = ffprobeDur(out)
  console.log(`narrated ${b.slug}: ${durations[b.slug].toFixed(2)}s -> ${out}`)
}
writeFileSync(join(audioDir, 'durations.json'), JSON.stringify(durations, null, 2))
writeFileSync(
  join(audioDir, 'narration.json'),
  JSON.stringify({ provider: narrator.provider, voice: narrator.voice, fallback: narrator.provider === 'piper', files, durations }, null, 2)
)
console.log(`wrote narration.json (${narrator.voice})`)
