// Still-image beats (TASK-3167): a beat with `image` instead of `url` becomes a
// clip of that diagram or screenshot, held for its narration. No browser or app
// login is needed, so non-UI work (migrations, multi-system flows) gets a video.
// Run after narrate-beats.mjs: node demos/still-beat.mjs
// Writes demos/clips/<slug>/final.mp4, the same file compose writes for page beats.
import { mkdirSync, readFileSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { beatPlan, stillBeatArgs } from './lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { beats } = JSON.parse(readFileSync(join(__dirname, 'beats.json'), 'utf8'))
const narration = JSON.parse(readFileSync(join(__dirname, 'clips', 'audio', 'narration.json'), 'utf8'))
const plan = new Map(beatPlan(beats, narration).map((p) => [p.slug, p.seconds]))

for (const beat of beats.filter((b) => b.image)) {
  const out = join(__dirname, 'clips', beat.slug, 'final.mp4')
  mkdirSync(dirname(out), { recursive: true })
  // An image path is relative to the demos folder, like beats.json, and must stay inside it:
  // an agent writes the script, and this runs on an operator's machine.
  const image = resolve(__dirname, beat.image)
  const inside = relative(__dirname, image)
  if (inside.startsWith('..') || isAbsolute(inside)) {
    console.error(`beat ${beat.slug}: image ${beat.image} is outside the demos folder`)
    process.exit(1)
  }
  execFileSync('ffmpeg', stillBeatArgs({ image, seconds: plan.get(beat.slug), out }), { stdio: 'inherit' })
  console.log(`still ${beat.slug}: ${plan.get(beat.slug)}s -> ${out}`)
}
