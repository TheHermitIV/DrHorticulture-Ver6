# DrHorticulture Ver6

A plant photo goes in; a **fertilize / do not fertilize / abstain** recommendation with a
confidence score comes out.

The app is a SwiftUI iOS client backed by a Node API and a Python inference service. The API owns
every product rule (quality gate, thresholds, decision). The inference service turns an image into
raw numbers and never decides, writes, or sees Supabase keys.

> **Status:** the full scan path runs end to end today. The CV stage can run PlantVision's real
> segmentation/features/species models, while the NDVI model is a stub until the lab data exists.
> This branch adds the wiring for that model: a shared model-bundle format, an offline training
> pipeline, and the agent-facing handoff in
> [`Backend/docs/ML_TRAINING_HANDOFF.md`](Backend/docs/ML_TRAINING_HANDOFF.md).

## How a scan flows

```
iOS photo
  → api intake (JPEG/PNG, EXIF allowlist, no GPS)
  → Tier A quality gate (resolution, exposure, blur)
  → Supabase Storage (private bucket, signed URLs)
  → POST {INFERENCE_URL}/v1/analyze
       cv.analyze(image)   segmentation + species + color features (PlantVision when CV_ENGINE=plantvision)
       ml.predict(...)     trained bundle → ndvi, confidence, ensemble spread
  → api decide()          fertilize / do_not_fertilize / abstain
  → scans, scan_images, analyses rows
```

The api ↔ inference boundary is fixed in
[`Backend/contracts/`](Backend/contracts) and validated on every response. The api makes every
decision; the inference service only returns numbers.

## Repository layout

| Folder | What it is |
| --- | --- |
| `Front-End/` | iOS app (SwiftUI, Xcode project); built and uploaded to TestFlight by `.github/workflows/ios.yml` |
| `Backend/` | Everything server-side (below) |
| `Assets/` | Shared images, such as the app icon master |

Inside `Backend/`:

| Folder | What it is |
| --- | --- |
| `api/` | Node 24 + Express 5 API on Railway: upload, Tier A gate, decision policy, storage, scan reads/retakes |
| `inference/` | Python 3.12 + Flask inference service: CV and ML seams, contract response, model loading |
| `contracts/` | The api ↔ inference contract (`inference.v1.schema.json` + canonical example) |
| `supabase/` | Postgres migrations (scans, images, analyses, decision config, ground truth) |
| `plantvision/` | CV pipeline and NDVI training: segmentation, color features, species, training scripts |
| `docs/` | [`BACKEND_SPEC.md`](Backend/docs/BACKEND_SPEC.md), [`ML_TRAINING_HANDOFF.md`](Backend/docs/ML_TRAINING_HANDOFF.md) |

## Quick start

### Prerequisites

- Node 24 and npm
- Python 3.12
- For real CV only: the `plantvision[ml]` extras (torch, ultralytics, transformers)
- Xcode 15+ for the iOS app
- A Supabase project for the api (migrations in `Backend/supabase/migrations/`)

### 1. API

```bash
cd Backend/api
cp .env.example .env          # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm ci
npm run dev                   # http://localhost:3000, upload page at /test.html
```

`INFERENCE_MODE=mock` is the default, so the api runs end to end without the inference service.
Set `INFERENCE_MODE=remote` plus `INFERENCE_URL` and `INFERENCE_API_KEY` to use the real service.

### 2. Inference service

```bash
cd Backend/inference
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt -e ../plantvision
cp .env.example .env          # set INFERENCE_API_KEY (16+ chars), MODEL_VERSION, CV_ENGINE
.venv/bin/gunicorn -b 127.0.0.1:8000 --workers 1 --threads 4 app:app
```

Use `CV_ENGINE=stub` (default) for hardcoded, torch-free responses. Use `CV_ENGINE=plantvision`
for the real CV stack; install `requirements-cv.txt` and set `MODEL_VERSION`/`ML_WEIGHTS_PATH` to
serve a trained NDVI bundle.

### 3. PlantVision (CV prototype)

```bash
cd Backend/plantvision
python -m venv .venv
.venv/bin/pip install -e ".[ml,dev]"
.venv/bin/plantvision path/to/plant.jpg --debug
```

### 4. iOS app

Open `Front-End/DrHorticulture.xcodeproj` in Xcode and run the `DrHorticulture` scheme. CI builds
and uploads to TestFlight from `main`; local builds do not require the backend to be running when
the mock analysis service is selected.

## Tests

```bash
# API (from Backend/api)
npm run lint && npm run format:check && npm test

# Inference (from Backend/inference, venv active)
python -m pytest

# PlantVision (from Backend/plantvision, venv active)
python -m pytest
```

CI runs the same suites on every push to `Backend`/`main` and every PR to `main`.

## NDVI model handoff (what this branch adds)

The NDVI model is the only piece still waiting on data. This branch makes the handoff mechanical:
a teammate supplies labeled photos, and an agent (or a person) runs one pipeline to produce the
bundle the service loads.

### What an agent will do

1. Read [`Backend/docs/ML_TRAINING_HANDOFF.md`](Backend/docs/ML_TRAINING_HANDOFF.md).
2. Put photos in `Backend/plantvision/data/raw/` and a labels CSV in
   `Backend/plantvision/data/labels/labels.csv`.
3. Run `python -m training.ndvi.pipeline --images … --labels … --dry-run` and fix any data
   problems the report names.
4. Run the full pipeline to extract features through the serving CV path, fit the ensemble, fit
   the optional greenness adjustment on held-out residuals, and write `model.json`,
   `metrics.json`, and `manifest.json` into `Backend/inference/weights/`.
5. Confirm `pytest tests/integration/test_training_roundtrip.py -v` passes, then report held-out
   MAE/RMSE and whether the adjustment improved them.
6. Set `MODEL_VERSION` and `ML_WEIGHTS_PATH` in the inference environment and deploy.

The agent must **not** change the HTTP contract, `api/src/services/decision.js`, or the response
shape in `inference/app.py`. If a contract or seam must change, update
`Backend/docs/BACKEND_SPEC.md` and add a change-log row in the same commit.

### Train and export

```bash
cd Backend/plantvision
pip install -e ".[ml,dev]"

# 1. Validate the labels and images only (no models load)
python -m training.ndvi.pipeline --images data/raw --labels data/labels/labels.csv --dry-run

# 2. Extract + train + evaluate + write the bundle
python -m training.ndvi.pipeline \
  --images data/raw --labels data/labels/labels.csv \
  --out ../inference/weights --model-version ridge-feat-0.1

# 3. Optional: evaluate a bundle against a features.csv
python -m training.ndvi.evaluate \
  --features data/features/features.csv --model ../inference/weights/model.json
```

### Labels schema

| Column | Rules |
| --- | --- |
| `image` | File name under `--images` (extension optional) |
| `plant_id` | Group key; the same plant must not span train and test |
| `species` | Labeled species (provenance/analysis) |
| `greenseeker_ndvi` | Target in `[-1, 1]`; GreenSeeker ground truth is `0.00–0.99` |

### What the model is

At hundreds of labeled images, the representation is the CV **color features** (ExG,
green_ratio, channel stats, leaf fraction, …) plus the pretrained **species probability
distribution**. Bootstrap ridge heads predict NDVI; their spread becomes `confidence`. An
optional greenness adjustment is fitted on held-out residuals and ships only if it improves MAE.
A frozen-backbone embedding is deliberately deferred.

The bundle format lives in [`Backend/inference/ml/bundle.py`](Backend/inference/ml/bundle.py);
training writes it, inference loads it. One format, no drift.

## Configuration

- Product thresholds (`ndvi_threshold`, `confidence_min`, `mask_min`, Tier A gate) come from the
  active `decision_config` row, never from code or env vars.
- API environment: [`Backend/api/.env.example`](Backend/api/.env.example).
- Inference environment: [`Backend/inference/.env.example`](Backend/inference/.env.example);
  `ML_WEIGHTS_PATH` unset means stub values, and a non-stub `MODEL_VERSION` without weights fails
  fast at startup.
- Weights over ~50 MB go in the `model-weights` bucket per the spec; inference never gets the
  Supabase service-role key.

## Deployment

- `api` deploys from `main` to Railway (root directory `/Backend/api`).
- `inference` deploys as a separate Railway service using `Backend/inference/railway.json` and a
  Dockerfile built from the repo root (`CV_ENGINE=plantvision`).
- The iOS app is built and uploaded to TestFlight by `.github/workflows/ios.yml` on `main`.

## Further reading

- [`Backend/docs/BACKEND_SPEC.md`](Backend/docs/BACKEND_SPEC.md) — architecture, data model, API,
  inference contract, pipeline rules, action plan, and change log.
- [`Backend/docs/ML_TRAINING_HANDOFF.md`](Backend/docs/ML_TRAINING_HANDOFF.md) — the NDVI training
  runbook, failure → action table, and definition of done.
- [`Backend/plantvision/README.md`](Backend/plantvision/README.md) and
  [`ARCHITECTURE.md`](Backend/plantvision/ARCHITECTURE.md) — the CV prototype and its design
  rationale.
