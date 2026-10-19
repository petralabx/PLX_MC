#!/usr/bin/env bash
# Assemble per-beat clips (composed page beats or still-image beats) + per-beat
# narration into one synced, captioned video. Each beat is extended to its
# narration length by freezing its final (clean, fully-rendered) frame, so audio
# and video stay in sync with no white load screens and no global time-stretch.
# Output (TASK-3167): demos/out/demo.mp4 (H.264 + AAC, captions burned in,
# -16 LUFS), demos/out/demo.srt (the same cues) and demos/out/narration.json.
set -euo pipefail
cd "$(dirname "$0")/.."          # project root
D=demos/clips
OUT=demos/out
mkdir -p "$OUT"

# plan.tsv: slug, seconds (narration + pad), narration file. demo.srt: one cue per sentence.
node demos/lib.mjs plan demos "$OUT"

buildseg() {
  local s="$1" T="$2" audio="$3"
  local clip="$D/$s/final.mp4"
  local C
  C=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$clip")
  # freeze last frame to reach T (clip is shorter than narration);
  # -nostdin: ffmpeg must not read the plan this loop reads
  ffmpeg -nostdin -y -loglevel error -i "$clip" -vf "tpad=stop_mode=clone:stop_duration=30,fps=30,scale=1600:-2,setsar=1,format=yuv420p" -t "$T" -an "$OUT/v_$s.mp4"
  # narration padded with trailing silence to exactly T
  ffmpeg -nostdin -y -loglevel error -i "$D/audio/$audio" -af "apad" -t "$T" -ar 44100 -ac 1 "$OUT/a_$s.wav"
  echo "seg $s -> ${T}s (clip ${C}s)"
}

: > "$OUT/vlist.txt"; : > "$OUT/alist.txt"
while IFS=$'\t' read -r s T audio; do
  buildseg "$s" "$T" "$audio"
  echo "file 'v_$s.mp4'" >> "$OUT/vlist.txt"; echo "file 'a_$s.wav'" >> "$OUT/alist.txt"
done < "$OUT/plan.tsv"
( cd "$OUT" && ffmpeg -y -loglevel error -f concat -safe 0 -i vlist.txt -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p video.mp4 )
( cd "$OUT" && ffmpeg -y -loglevel error -f concat -safe 0 -i alist.txt -c:a pcm_s16le audio.wav )

# Mux: burn the captions, normalise the voice to -16 LUFS, AAC audio, fast start.
( cd "$OUT" && ffmpeg -y -loglevel error -i video.mp4 -i audio.wav \
    -vf "subtitles=demo.srt:force_style='FontSize=18,MarginV=28'" \
    -af "loudnorm=I=-16:TP=-1.5:LRA=11" \
    -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k -ar 44100 \
    -shortest -movflags +faststart demo.mp4 )
cp "$D/audio/narration.json" "$OUT/narration.json"
echo "demo.mp4: $(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$OUT/demo.mp4")s, voice $(node -e "console.log(require('./$OUT/narration.json').voice)")"
