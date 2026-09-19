# PlantVision

Takes a photo of a potted plant, finds the leaves, looks at their color,
gives them a greenness score, and predicts the plant species.

## How it works

```
1. You give PlantVision a photo
2. A computer-vision model finds the leaf area in the photo
3. It measures the leaves' color (red, green, blue balance)
4. It turns that into a greenness score
5. It predicts the plant species from the photo
6. It saves the score + species + a few images you can look at
```

That score is a plain greenness number — the average "excess green"
(`2G - R - B`) across the leaf pixels. **Right now it's a color measurement,
not a real NDVI.** Eventually a model trained on real sensor data will replace
it with true NDVI — the code is already built so that swap is easy.

## Quick start

```bash
cd /path/to/DrHorticulture-Ver6    # from the repo root
source .venv/bin/activate          # you only need this once per terminal
pip install -e ".[ml,dev]"         # first time only: installs the heavy ML tools

plantvision path/to/a/plant.jpg                    # prints greenness + species
plantvision path/to/a/plant.jpg --debug            # + image path, coverage, saved files
plantvision path/to/a/plant.jpg --save-mask --save-overlay --json   # + pictures & full JSON
```

Tip: use a clear photo of a **whole potted plant** (pot + leaves). The built-in
model only knows how to spot potted plants — it doesn't recognize a loose leaf.

The first run downloads the species classifier (~390 MB) from Hugging Face and
caches it; later runs are offline. The segmentation model ships with the repo.

## What you get

`outputs/prediction.json` is the main result. It says: how much of the photo
is leaf, the average leaf colors, the **greenness** score
(`greenness.value` = average excess green `2G - R - B` across leaf pixels),
and the predicted **species** (`species.label`, with a confidence and the
next-best candidates under `species.top_k`).

`ndvi` and `fertilization` are present as placeholders with
`"status": "unavailable"` until real sensor NDVI and the fertilizer logic
exist.

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