# DrHorticulture Ver6

A plant photo goes in; a **fertilize / do not fertilize / abstain** recommendation with a
confidence score comes out.

The app is a SwiftUI iOS client backed by a Node API and a Python inference service. The API owns
every product rule (quality gate, thresholds, decision). The inference service turns an image into
raw numbers and never decides, writes, or sees Supabase keys.

> The inference Docker image defaults to LeafSegmenter v1.3.0 with the corrected-review mask model, refitted NDVI estimator, and matching provisional confidence models.
> The model file ships in `Backend/inference/weights/`. See the
> [training handoff](Backend/docs/ML_TRAINING_HANDOFF.md) for retraining and evaluation.

## How a scan flows

```
iOS photo
  → api intake (JPEG/PNG, EXIF allowlist, no GPS)
  → Tier A quality gate (resolution, exposure, blur)
  → Supabase Storage (private bucket, signed URLs)
  → POST {INFERENCE_URL}/v1/analyze
       LeafSegmenter      target foliage mask + color features
       NDVI estimator     color features → NDVI
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

### Open the website

From the repository root, run `npm run test-page` and keep the terminal open.
The preview requires Node and npm. You can open any of these pages:

- [Analyze Photo](http://localhost:3000/)
- [Scan Details](http://localhost:3000/ImageData.html)
- [Leaf Mask Creator](http://localhost:3000/leaf-mask.html)

The team website lives in `Backend/api/public`. If you have an older standalone
Leaf Lab checkout in `Web/`, its `dist` folder serves a separate site. Stop that
server before starting the team website on port 3000. To use another port, run
`npm run test-page -- --port 3001`.

The scan pages use the deployed API by default. The Leaf Mask Creator processes
photos and exports masks in your browser.

### Prerequisites

- Node 24 and npm
- Python 3.12
- For local model development: the `plantvision[ml]` extras (OpenCV, scikit-learn, and the optional species stack)
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
.venv/bin/pip install -r requirements-dev.txt opencv-python-headless==5.0.0.93 -e ../plantvision
export INFERENCE_API_KEY='replace-with-the-same-shared-key-used-by-the-api'
export LEAF_SEGMENTER_ENABLED=true
.venv/bin/python -m flask --app app run --host 127.0.0.1 --port 8000
```

For local LeafSegmenter inference, install `opencv-python-headless`, set
`LEAF_SEGMENTER_ENABLED=true` and `INFERENCE_API_KEY` in the process environment,
then run `python -m flask --app app run --host 127.0.0.1 --port 8000` (including
on Windows). `app.py` does not load `.env` automatically. The Docker image enables
LeafSegmenter by default and uses Gunicorn. Leave `LEAF_SEGMENTER_MODEL_PATH`
unset to load the bundled v1.3.0 file. `CV_ENGINE` and `ML_WEIGHTS_PATH` apply to
the separate legacy path when LeafSegmenter is disabled.

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

For a test build, set `DRHORTICULTURE_API_BASE_URL` in the app target's Xcode build settings
to the test server's HTTPS origin, or pass `DRHORTICULTURE_API_BASE_URL=https://your-test-server`
to `xcodebuild`. A blank setting uses production. A malformed override stops the scan before upload.

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

## Models and current evaluation

The selected bundled release is **LeafSegmenter v1.3.0**: corrected-review
segmentation, a ridge NDVI estimator, and refitted provisional confidence models.
The NDVI split is 118 training, 17 calibration and 22 test plants. On the existing
22-plant development test set, MAE is **0.0729 NDVI units**, with **17/22** within
±0.10 and nominal 90% intervals covering **20/22** readings. Mean mask IoU on 11
reserved reviewed masks is **0.671**, compared with 0.542 for the older segmenter.
Mask quality improved while NDVI MAE increased from v1.2.0's 0.0644. These are
previously inspected development collections, not fresh blind validation or
fertilizer-effectiveness results. Species auto-detection is not active.

See [training and data provenance](Backend/docs/ML_TRAINING_HANDOFF.md) for counts,
training exclusions, confidence limitations and retraining. The legacy ensemble
pipeline remains development code; it is not the default LeafSegmenter serving path.

## Demo rehearsal

Start the preview with `npm run test-page`. It forwards scans to the deployed
Railway API by default, even when the browser URL is localhost. To use a test
backend, run `npm run test-page -- --api http://localhost:4000 --port 3001`.
The model label after analysis comes from the actual server response, not from
the local weights file. Old saved scans retain their original model version.

The last live smoke test on 25 November 2026 used a held-out plant measured at
0.830 and returned 0.792 from **v1.1.0**, with no recommendation because that
version lacks calibrated NDVI confidence. That live result does not verify a
v1.3.0 deployment. Follow [the deployment guide](Backend/docs/RAILWAY_DEPLOYMENT.md)
and [the final Showcase checklist](Backend/docs/SHOWCASE_CLEARANCE.md).

## Configuration

- Product thresholds (`ndvi_threshold`, `confidence_min`, `mask_min`, Tier A gate) come from the
  active `decision_config` row, never from code or env vars.
- API environment: [`Backend/api/.env.example`](Backend/api/.env.example).
- Inference environment: [`Backend/inference/.env.example`](Backend/inference/.env.example);
  LeafSegmenter loads its bundled JSON by default in Docker. `ML_WEIGHTS_PATH` and
  non-stub `MODEL_VERSION` apply only to the legacy path when LeafSegmenter is disabled.
- Weights over ~50 MB go in the `model-weights` bucket per the spec; inference never gets the
  Supabase service-role key.

## Deployment

Follow the [Railway deployment runbook](Backend/docs/RAILWAY_DEPLOYMENT.md) to
deploy the services and verify a scan.

- `api` deploys from `main` to Railway (root directory `/Backend/api`).
- `inference` deploys as a separate Railway service using `Backend/inference/railway.json` and a
  Dockerfile built from the repo root. It defaults to LeafSegmenter, whose model file ships in the image.
- The iOS app is built and uploaded to TestFlight by `.github/workflows/ios.yml` on `main`.

## AI assistance disclosure

We used **OpenAI Codex / ChatGPT** and **Anthropic Claude / Claude Code** during development
for coding, debugging, interface improvements, research summaries, model-training experiments,
data analysis, and documentation.

The team remains responsible for the submitted code, research claims, and reported results.
We review AI-assisted work through code inspection, automated tests, source checks, and visual
comparisons of predicted masks with photos and human-reviewed annotations. Model estimates are
also evaluated against measured GreenSeeker readings. We corrected misleading descriptions of
model updates and documented cases where better segmentation increased NDVI prediction error.
Software tests and confidence scores alone do not establish model accuracy or fertilizer validity.

## Credits and public display

See [component credits and data permissions](THIRD_PARTY_NOTICES.md) for the
software, services and source data used. Public photo permissions, app-icon
origin, written Product Owner approval, final slide credits, and a full demo
accessibility rehearsal remain tracked in [Showcase clearance](Backend/docs/SHOWCASE_CLEARANCE.md).

## Further reading

- [`Backend/docs/BACKEND_SPEC.md`](Backend/docs/BACKEND_SPEC.md) — architecture, data model, API,
  inference contract, pipeline rules, action plan, and change log.
- [`Backend/docs/ML_TRAINING_HANDOFF.md`](Backend/docs/ML_TRAINING_HANDOFF.md) — the NDVI training
  runbook, failure → action table, and definition of done.
- [`Backend/plantvision/README.md`](Backend/plantvision/README.md) and
  [`ARCHITECTURE.md`](Backend/plantvision/ARCHITECTURE.md) — the CV prototype and its design
  rationale.
