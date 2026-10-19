// TASK-3167: the plx-knowledge-video pipeline helpers. The narration voice is
// ElevenLabs, or the approved Piper fallback, and is recorded. A still image
// becomes a beat clip with ffmpeg alone. Captions are timed per sentence inside
// each beat, so the burned captions and the SRT match. Pure: no ffmpeg runs here.
import { describe, expect, it } from "vitest";

import {
  BEAT_PAD,
  beatPlan,
  captionCues,
  chooseNarrator,
  srtTime,
  stillBeatArgs,
  toSrt,
} from "../.cursor/skills/plx-knowledge-video/pipeline/lib.mjs";

const cfg = { voice: "EXAVITQu4vr4xnSDxMaL" };
const beats = [
  { slug: "01-flow", image: "slides/flow.png", narration: "One two three. Four five six seven eight nine." },
  { slug: "02-panel", url: "/tasks/TASK-1", narration: "The task page lists every file." },
];
const narration = { files: { "01-flow": "01-flow.wav", "02-panel": "02-panel.wav" }, durations: { "01-flow": 9, "02-panel": 4 } };

describe("chooseNarrator", () => {
  it("uses ElevenLabs when its key is set, and records the voice", () => {
    expect(chooseNarrator({ ELEVENLABS_API_KEY: "k", PIPER_MODEL: "/v/a.onnx" }, cfg)).toMatchObject({
      provider: "elevenlabs",
      voice: "elevenlabs:EXAVITQu4vr4xnSDxMaL",
      ext: "mp3",
    });
  });

  it("falls back to Piper only when a voice model is named", () => {
    expect(chooseNarrator({ PIPER_MODEL: "/voices/en_US-lessac-medium.onnx" }, cfg)).toMatchObject({
      provider: "piper",
      voice: "piper:en_US-lessac-medium",
      ext: "wav",
      bin: "piper",
    });
    expect(chooseNarrator({ PIPER_MODEL: "/v/a.onnx", PIPER_BIN: "/opt/piper" }, cfg)).toMatchObject({ bin: "/opt/piper" });
  });

  it("refuses to narrate silently with neither voice", () => {
    expect(chooseNarrator({}, cfg)).toEqual({ error: expect.stringMatching(/^No narration voice\. Set ELEVENLABS_API_KEY, or set PIPER_MODEL/) });
  });
});

describe("still-image beats", () => {
  it("holds the image for the beat at 1600x900 and 30 fps, letterboxed on white", () => {
    const args = stillBeatArgs({ image: "demos/slides/flow.png", seconds: 9.8, out: "demos/clips/01-flow/final.mp4" });
    expect(args.slice(args.indexOf("-i"), args.indexOf("-i") + 2)).toEqual(["-i", "demos/slides/flow.png"]);
    expect(args[args.indexOf("-t") + 1]).toBe("9.8");
    expect(args[args.indexOf("-vf") + 1]).toMatch(/^scale=1600:900:force_original_aspect_ratio=decrease,pad=1600:900:.*color=white/);
    expect(args.at(-1)).toBe("demos/clips/01-flow/final.mp4");
  });
});

describe("beat plan and captions", () => {
  it("holds each beat for its narration plus the pad", () => {
    expect(beatPlan(beats, narration)).toEqual([
      { slug: "01-flow", seconds: 9 + BEAT_PAD, audio: "01-flow.wav" },
      { slug: "02-panel", seconds: 4 + BEAT_PAD, audio: "02-panel.wav" },
    ]);
    expect(() => beatPlan(beats, { files: {}, durations: { "01-flow": 1 } })).toThrow("No narration for beat 02-panel");
  });

  it("times one cue per sentence by word count, inside its beat", () => {
    const cues = captionCues(beats, narration);
    expect(cues).toEqual([
      { start: 0, end: 3, text: "One two three." },
      { start: 3, end: 9, text: "Four five six seven eight nine." },
      { start: 9 + BEAT_PAD, end: 13 + BEAT_PAD, text: "The task page lists every file." },
    ]);
  });

  it("writes SRT cues", () => {
    expect(srtTime(3725.5)).toBe("01:02:05,500");
    expect(toSrt([{ start: 0, end: 1.25, text: "Hello." }, { start: 1.25, end: 2, text: "Bye." }])).toBe(
      "1\n00:00:00,000 --> 00:00:01,250\nHello.\n\n2\n00:00:01,250 --> 00:00:02,000\nBye.\n"
    );
  });
});
