"""Measure beat charts for Madih Light.

Reads every top-level .mp3 in the song folder (sub-folders are ignored on purpose),
and writes:
  songs.json   - level order: id, title (the file name), audio file, duration
  charts.json  - per id: bpm, duration, first_hit, start_offset, charts {easy, normal, hard}
  tools/charts-review.csv - one line per song for a quick human check

Charts are measured from the audio itself (librosa beat tracking + onset detection);
nothing is invented by hand.
  normal = every tracked beat
  easy   = every other beat (the half that lands on the stronger onsets)
  hard   = every beat plus strong off-beat onsets, never closer than HARD_MIN_GAP

Usage:
  tools/.venv/Scripts/python.exe tools/make_charts.py "<song folder>" [--only N]
"""
import argparse
import csv
import json
import sys
from pathlib import Path

import librosa
import numpy as np

SR = 22050
LEAD_IN = 2.0          # start playback this many seconds before the first hit
NORMAL_MIN_GAP = 0.30  # seconds
HARD_MIN_GAP = 0.22    # seconds
HARD_ONSET_PCTL = 75   # off-beat onsets must be at least this strong (percentile)

ROOT = Path(__file__).resolve().parent.parent


def thin(times, min_gap):
    out = []
    for t in times:
        if not out or t - out[-1] >= min_gap:
            out.append(t)
    return out


def strength_at(times, env, sr):
    frames = librosa.time_to_frames(times, sr=sr)
    frames = np.clip(frames, 0, len(env) - 1)
    return env[frames]


def measure(path):
    y, sr = librosa.load(str(path), sr=SR, mono=True)
    duration = len(y) / sr
    env = librosa.onset.onset_strength(y=y, sr=sr)
    tempo, beats = librosa.beat.beat_track(onset_envelope=env, sr=sr, units="time")
    bpm = float(np.atleast_1d(tempo)[0])
    onsets = librosa.onset.onset_detect(onset_envelope=env, sr=sr, units="time")

    normal = thin(sorted(float(b) for b in beats), NORMAL_MIN_GAP)

    # easy: pick the every-other-beat phase with the stronger onsets
    a, b = normal[0::2], normal[1::2]
    sa = strength_at(a, env, sr).sum() if a else 0
    sb = strength_at(b, env, sr).sum() if b else 0
    easy = a if sa >= sb else b

    # hard: beats + strong onsets that sit between beats
    thr = np.percentile(env, HARD_ONSET_PCTL) if len(env) else 0
    strong = [float(t) for t, s in zip(onsets, strength_at(onsets, env, sr)) if s >= thr]
    beat_arr = np.array(normal)
    extra = [t for t in strong if beat_arr.size == 0 or np.min(np.abs(beat_arr - t)) >= HARD_MIN_GAP]
    hard = []
    for t in sorted(normal + extra):  # beats are kept first when two collide
        if not hard or t - hard[-1] >= HARD_MIN_GAP:
            hard.append(t)

    charts = {k: [round(t, 3) for t in v] for k, v in (("easy", easy), ("normal", normal), ("hard", hard))}
    first_hit = min(v[0] for v in charts.values() if v) if any(charts.values()) else 0.0
    return {
        "bpm": round(bpm, 1),
        "duration": round(duration, 3),
        "first_hit": round(first_hit, 3),
        "start_offset": round(max(0.0, first_hit - LEAD_IN), 3),
        "charts": charts,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--only", type=int, default=0, help="measure only the first N songs")
    args = ap.parse_args()

    files = sorted(p for p in Path(args.folder).iterdir() if p.is_file() and p.suffix.lower() == ".mp3")
    if args.only:
        files = files[: args.only]

    songs, charts, rows = [], {}, []
    for i, path in enumerate(files, 1):
        sid = f"song-{i:02d}"
        print(f"[{i}/{len(files)}] {sid}", flush=True)
        c = measure(path)
        charts[sid] = c
        songs.append({"id": sid, "title": path.stem, "file": f"songs/{sid}.mp3",
                      "source": path.name, "duration": c["duration"]})
        rows.append([sid, path.stem, c["duration"], c["bpm"], c["first_hit"],
                     len(c["charts"]["easy"]), len(c["charts"]["normal"]), len(c["charts"]["hard"])])

    (ROOT / "songs.json").write_text(json.dumps(songs, ensure_ascii=False, indent=1), encoding="utf-8")
    (ROOT / "charts.json").write_text(json.dumps(charts, separators=(",", ":")), encoding="utf-8")
    with open(ROOT / "tools" / "charts-review.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["id", "title", "duration_s", "bpm", "first_hit_s", "easy_hits", "normal_hits", "hard_hits"])
        w.writerows(rows)
    print(f"done: {len(files)} songs", flush=True)


if __name__ == "__main__":
    sys.exit(main())
