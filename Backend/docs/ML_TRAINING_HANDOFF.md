# NDVI model training handoff

Status: **wiring complete; the real model needs the lab data.** This document is written for a
teammate (or an agent acting for one) who has the labeled potted-plant photos and needs to finish
the NDVI model without re-deriving the architecture.

The repo already runs end to end with a stub. Your job is to turn labeled photos into the JSON
bundle the inference service loads (`ML_WEIGHTS_PATH`), verify it, and report the held-out metrics.
You do not need to touch the api or the HTTP contract.

## What the model is

At the current dataset size (hundreds of images) the representation is the CV stage's **color
features** (ExG, green_ratio, channel stats, leaf fraction, …) plus the pretrained **species
probability distribution**. An ensemble of bootstrap ridge heads predicts NDVI; their spread
becomes `confidence`. An optional greenness adjustment is fitted on held-out residuals:

```
ndvi_final = clip(ndvi_raw + alpha * greenness + beta, -1, 1)
```

The frozen-backbone embedding is deliberately deferred. Do not add torch to the serving path to
do this task.

## Inputs

`--images`: a directory of JPEG/PNG potted-plant photos.

`--labels`: a CSV with at least these columns (extra columns are preserved and ignored):

| Column | Type | Rules |
| --- | --- | --- |
| `image` | string | file name under `--images`; extension optional (`p1` finds `p1.jpg`) |
| `plant_id` | string | group key. The same plant must never appear in both train and test |
| `species` | string | labeled species, for provenance/analysis |
| `greenseeker_ndvi` | number | target, in `[-1, 1]`; GreenSeeker ground truth is `0.00–0.99` |

Example:

```csv
image,plant_id,species,greenseeker_ndvi,distance_cm,lighting
p001.jpg,geranium-a,geranium,0.42,30,indirect
p002.jpg,geranium-a,geranium,0.39,30,indirect
p003.jpg,tomato-b,tomato,0.61,25,indirect
```

Put photos in `Backend/plantvision/data/raw/` and the CSV in
`Backend/plantvision/data/labels/labels.csv` (both gitignored).

## Commands

```bash
cd Backend/plantvision
python -m venv .venv
.venv/bin/python -m pip install -e ".[ml,dev]"      # ml: ultralytics/torch/transformers/sklearn
                                                    # dev: pytest (+ scikit-learn for the roundtrip)

# 1. Validate the data only. No models load, no torch. This is the fast first check.
python -m training.ndvi.pipeline --images data/raw --labels data/labels/labels.csv --dry-run

# 2. Full run: extract features with the serving CV path, train, evaluate, write the bundle.
python -m training.ndvi.pipeline \
  --images data/raw --labels data/labels/labels.csv \
  --out ../inference/weights --model-version ridge-feat-0.1

# 3. Drop-in check that training -> bundle -> prediction still works (synthetic data, no CV).
pytest tests/integration/test_training_roundtrip.py -v
```

Windows note: use `.venv\Scripts\python` instead of `.venv/bin/python`.

The first extraction run downloads the species classifier (~390 MB) and uses the YOLO weights
already in the repo. Later runs are offline.

### Useful flags

| Flag | Default | Use |
| --- | --- | --- |
| `--limit N` | all | quick iteration on the first N rows |
| `--n-heads N` | 9 | ensemble size; must be ≥ 2 |
| `--test-size` | 0.2 | outer grouped holdout |
| `--calib-fraction` | 0.25 | held-out slice (of train) used to fit the greenness adjustment |
| `--greenness-key` | `exg` | which CV feature drives the adjustment |
| `--greenness-normalizer` | 255 | divide the greenness feature before fitting (ExG spans −510…510) |
| `--species-source labels` | `classifier` | offline/ablation fallback; does **not** match serving |

## Outputs

`--out` (default `Backend/inference/weights/`) gets:

- `model.json` — the bundle. Format and validation live in `Backend/inference/ml/bundle.py`.
- `metrics.json` — held-out MAE/RMSE/R²/Pearson for raw and calibrated predictions, the
  greenness-only baseline, and `calibration_helps`.
- `manifest.json` — git SHA, row counts, column orders, metrics, `model_version`.

`--features-out` (default `data/features/features.csv`) also gets `feature_names.json` and
`species_labels.json`. Keep these with the CSV; `train.py`/`evaluate.py` need them.

Bundle keys (all required unless marked):

```
schema_version, model_version, representation ("color_features+species_probs"),
feature_names[], species_labels[], ensemble_size,
heads[{coef[], intercept}], reference_spread, saturate_at,
scaler_mean[]|null, scaler_std[]|null,
greenness {key, normalizer, alpha, beta, clip[]}|null,
metrics {}
```

## Serve the bundle

In `Backend/inference/.env` (or the deployment env):

```
MODEL_VERSION=ridge-feat-0.1
ML_WEIGHTS_PATH=/app/inference/weights/model.json
CV_ENGINE=plantvision
```

`ml/regressor.py` loads the bundle once at import. A non-stub `MODEL_VERSION` with no weights
fails fast at startup rather than serving stub numbers. The api's `decide()` and the HTTP v1
response are unchanged.

## Failure → action

| Error | Meaning | Do this |
| --- | --- | --- |
| `Labels CSV ... missing required column(s)` | CSV header is wrong | add/fix the columns in the table above |
| `greenseeker_ndvi must be a number` / `outside [-1, 1]` | bad target cell | fix the CSV; blank/NA rows must be removed |
| `image not found under ...` | label does not resolve | fix `image` or move the file into `--images` |
| `duplicate image row` | same image labeled twice | keep one row; duplicates leak across the split |
| `only N distinct plant_id` | fewer than 2 groups | add plants or fix `plant_id` (do not random-split) |
| `No usable rows were extracted` | CV rejected everything | check logs: is the plant a real potted-plant photo? `CV_ENGINE=plantvision`? |
| `CV_ENGINE='stub'; extracting stub features` | wrong backend | unset `CV_ENGINE` or set it to `plantvision` |
| `No module named sklearn` | `.[ml]` not installed | `pip install -e ".[ml,dev]"` |
| `classifier returned N probabilities ...` | stale CV labels | rebuild/redeploy the CV stage before extracting |
| `reference_spread=0` | heads all agree | more data/noise or more heads; don't fake a baseline |
| `greenness feature 'exg' not in the CV features` | stub/other feature set | use `--greenness-key` matching a real feature, or accept no adjustment |
| `calibration_helps: false` | adjustment hurt MAE | drop the `greenness` block from the bundle; ship raw |
| `MODEL_VERSION=... but ML_WEIGHTS_PATH is unset` | deploy config | set the path or use `stub-0.1` |

## Files you may edit, and files you must not

May edit:

- `Backend/plantvision/training/ndvi/*` — data, extraction, model, metrics.
- `Backend/inference/ml/bundle.py` and `ml/regressor.py` — only if the artifact or seam genuinely
  changes; keep `bundle.py` the single source of truth.
- `Backend/inference/cv/embedder.py` — only if you add the deferred backbone.
- This document.

Must not edit:

- `Backend/contracts/inference.v1.*`, `Backend/api/src/inference/schema.js` — the HTTP contract.
- `Backend/api/src/services/decision.js` — every product decision belongs to the api.
- `app.py`'s response shape (the seam call is fine).
- Applied migrations in `Backend/supabase/migrations/`.

If a contract or seam must change, update `Backend/docs/BACKEND_SPEC.md` and add a change-log row
in the same commit.

## Definition of done

- [ ] `--dry-run` validates the real labels with zero errors.
- [ ] The full pipeline writes `model.json`, `metrics.json`, `manifest.json`.
- [ ] `pytest tests/integration/test_training_roundtrip.py -v` passes.
- [ ] `pytest` (plantvision) and `pytest` (inference) are green.
- [ ] `metrics.json` reports held-out MAE/RMSE and whether the adjustment helped.
- [ ] The bundle loads with `ML_WEIGHTS_PATH` and `MODEL_VERSION`, and a `/v1/analyze` response
      still validates against `contracts/inference.v1.schema.json` (stub contract test still green).

## What still needs a human

- **Greenness scalar/definition.** Pick one bounded definition and keep it identical in training,
  serving, and the adjustment. ExG is exposure/white-balance sensitive; document the choice.
- **Species coverage.** The pretrained classifier is unverified on this project's species at
  phone framing. Check it before trusting `--species-source classifier`.
- **Ship threshold.** There is no accuracy gate in code. A human decides whether the held-out
  MAE is good enough before `MODEL_VERSION` is promoted.
- **Confidence calibration.** The spread mapping is relative, not a probability of correctness.
  Calibrating it needs held-out residuals, i.e. the lab data.
- **Weights storage.** Small JSON bundles can be deployed with the image; anything over ~50 MB
  belongs in the `model-weights` bucket per `BACKEND_SPEC` (inference never gets Supabase keys).
- **Low-NDVI / imbalanced data.** Group splits by plant help, but check the target distribution;
  a model that predicts the mean will look deceptively good on MAE.

## Known limitations (documented, not hidden)

- `reference_spread` is measured in-sample, so confidence reads systematically high.
- Bootstrap spread is not a reliable out-of-distribution detector for a linear head; the NDVI
  clamp is the more trustworthy out-of-range signal.
- Same plant photographed twice appears as independent rows unless group resampling is added.
- The greenness adjustment is a fitted residual correction, not a physical model; it ships only
  if held-out MAE improves.
