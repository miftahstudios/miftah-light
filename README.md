# Madih Light

A touch-first rhythm game for the browser. Swipe the glowing orb one cell at a time and move into the dark shadows on the beat to clear them. Keep your Light above zero to finish the song.

Play it on GitHub Pages: https://miftahstudios.github.io/miftah-light/

## Run locally

```bash
python tools/devserver.py 8765
```

Then open http://localhost:8765.

## Files

- `index.html`, `css/`, `js/`: the game (no build step, ES modules)
- `vendor/three.module.min.js`: Three.js r160 (MIT, see `vendor/three-LICENSE.txt`)
- `songs.json`, `charts.json`, `songs/`: song list, measured beat charts, audio
- `tools/make_charts.py`: measures the charts with librosa; `tools/charts-review.csv` lists them for review
