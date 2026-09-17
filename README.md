# PlantVision

Takes a photo of a potted plant, finds the leaves, looks at their color, and
gives you an NDVI-style "is this plant healthy" score.

## How it works

```
1. You give PlantVision a photo
2. A computer-vision model finds the leaf area in the photo
3. It measures the leaves' color (red, green, blue balance)
4. It turns that into a greenness score
5. It saves the score + a few images you can look at
```

That score is called an NDVI estimate. **Right now it's just a greenness
proxy, not a real measurement.** Eventually it will be replaced by a model
trained on real sensor data — the code is already built so that swap is easy.

## Quick start

```bash
cd ~/Desktop/plantvision
source .venv/bin/activate          # you only need this once per terminal
pip install -e ".[ml,dev]"         # first time only: installs the heavy ML tools

plantvision path/to/a/plant.jpg                    # basic run
plantvision path/to/a/plant.jpg --save-mask --save-overlay --json   # + pictures & detail
```

Tip: use a clear photo of a **whole potted plant** (pot + leaves). The built-in
model only knows how to spot potted plants — it doesn't recognize a loose leaf.

## What you get

`outputs/prediction.json` is the main result. In plain English it says: how much
of the photo is leaf, what the average leaf colors are, and the NDVI estimate
(`type: "rgb_proxy"` = greenness score, not measured NDVI).

## Folder tour

- `configs/` — settings (which model, which plant type to look for, score mode). No need to touch unless you want to.
- `outputs/` — results: `prediction.json`, `features.json`, `mask.png`, `overlay.png`
- `src/plantvision/` — the actual code, split into: load photo → find leaves → measure color → score → save results
- `training/` — tools for later, when real sensor data arrives
- `tests/` — automated checks that the math and pipeline work

## Tests

```bash
pytest
```

## Not built yet (by design)

- Real NDVI from sensor hardware
- A trained model instead of the greenness placeholder
- Fine-tuned leaf detection (so any individual leaf works)

For the detailed technical design, see `ARCHITECTURE.md`.