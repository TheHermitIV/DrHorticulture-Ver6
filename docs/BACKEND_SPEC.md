# DrHorticulture Ver6 — Backend Scope & Action Plan

Sep 30, 2026 (revised Oct 1, 2026) · @Ernesto

## Purpose and how to use this doc

This is the build spec for the DrHorticulture Ver6 backend. The backend is an Express API on Railway that accepts a plant photo, checks its quality, stores it in Supabase, and calls a placeholder CV + ML inference service. It returns fertilize, do not fertilize, or abstain, with a confidence score.

The CV and ML models are not built yet. The backend must run end to end today with a mock or stub, then take the real models later with no API or schema change. The backend's job is the structure: clear slots where the team inserts its CV model and ML model later.

Rules for the coding agent:

1. Work through the Action plan in order, one task per commit or PR, and do not start a phase until the previous phase's "Done when" passes.
2. Treat the Data model, API specification, Inference contract, and Pipeline behavior sections as contracts. If one of them must change, update this doc in the same PR and say why (see Change log).
3. Anything this doc does not specify: pick the simplest option, leave a `TODO(decision):` comment, and list it in the PR description. Do not invent product rules.
4. Commit a Markdown copy of this doc to the repo as `docs/BACKEND_SPEC.md` so every agent session can read it.
5. All work happens on the `Backend` branch of the fork (`erne2003/DrHorticulture-Ver6`). @Ernesto integrates `Backend` into the fork's `main`, tests, and then merges the fork into the team repo. Railway deploys from `main`. Do not push to `main` or the team repo directly.

## System overview

The system has two services and one Supabase project. `api` (Node/Express) runs on Railway, is public, and owns every rule and write. `inference` (Python) only turns an image into numbers and never decides anything; it can run wherever the team hosts it (see Hosting and budget) and rejects requests without its shared-secret header. Supabase holds the Postgres tables and the image files.

Request lifecycle for `POST /api/v1/scans`:

1. **Intake:** validate the upload (type, size, optional species), auto-orient it, and extract EXIF.
2. **Store:** upload the original to Supabase Storage, then insert `scans` and `scan_images` rows.
3. **Quality gate, Tier A:** run the resolution, exposure, and blur checks in Node. On failure, set status `rejected` and return 422 with retake reasons.
4. **Inference:** create a short-lived signed URL and call `inference` (or the mock) with the URL, the image id, and the species hint, sending the `x-inference-key` header. The service runs the CV stage, then the ML stage, and returns raw numbers: segmentation, predicted species, color features, NDVI, confidence, and ensemble spread.
5. **Quality gate, Tier B:** if the CV output says no plant was detected or the angle is bad, set status `rejected` and return 422. These are the first two rules of the decision policy.
6. **Decision policy:** apply the thresholds from the active `decision_config` row. The result is fertilize, do not fertilize, or abstain.
7. **Persist and respond:** write an `analyses` row with model and config versions, set the final status, and return the result.

```text
  iOS app / test.html
          |
          v
  +----------------+   POST /v1/analyze + x-inference-key       +----------------------+
  |  api (public)  | -----------------------------------------> | inference (any host) |
  |  Node/Express  | <----------------------------------------- | Python/Flask         |
  |  on Railway    |          raw numbers only                  | CV stage -> ML stage |
  +----------------+                                            +----------------------+
          | service-role key: every read and write                      |
          v                                                             | GET image via
  +------------------------------------------+                          | signed URL
  | Supabase: Postgres tables + Storage      | <------------------------+
  | (private bucket scan-images)             |
  +------------------------------------------+
```

Only `api` writes data and only `api` decides. `inference` fetches the image through a signed URL and returns numbers.

## Tech stack

The backend is Node.js 24 LTS + Express 5 on Railway, with Supabase for Postgres and file storage. Pin exact versions in `package.json` and `requirements.txt` at install time. Add no other dependencies without asking.

| Layer | Choice | Where it runs | Notes |
| --- | --- | --- | --- |
| Runtime | Node.js 24 LTS, JavaScript (ES modules) | Railway `api` | Native `fetch` + `AbortSignal.timeout` for HTTP calls |
| Web framework | Express 5 | Railway `api` | Async errors flow to one central error handler |
| Uploads | `multer` (memory storage) | `api` | One field, `image`; size and type limits enforced |
| Image processing | `sharp` | `api` | Auto-orient, metadata, quality-gate metrics |
| EXIF parsing | `exifr` | `api` | Device, ISO, exposure; GPS dropped |
| Validation | `zod` | `api` | Env vars at boot, request bodies, inference responses |
| Database + storage client | `@supabase/supabase-js` v2 | `api` | Service-role key, server side only |
| Logging | `pino` + `pino-http` | `api` | JSON logs with request id and scan id |
| Security middleware | `helmet`, `cors`, `express-rate-limit` | `api` | CORS allowlist from env |
| Tests | `vitest` + `supertest`; `pytest` for Python | Local + CI | Unit and HTTP integration tests; pytest for `inference/` and `plantvision/` |
| Job queue (only if needed) | `pg-boss` | Railway `worker` | Only if p95 latency exceeds 15 s (see Action plan) |
| Inference service | Python 3.12 + Flask + gunicorn, with stub CV and ML stages | Any host (see Hosting and budget) | The ML team may switch to FastAPI; the contract stays the same |
| Database | Supabase Postgres | Supabase | Schema managed with Supabase CLI migrations |
| File storage | Supabase Storage, private bucket `scan-images` | Supabase | Access only via signed URLs |
| Auth (optional) | Supabase Auth (JWT) | Supabase | Off by default; see Open decisions |
| Hosting | Railway Hobby ($5/month): `api` always on; `inference` optional there | Railway | Auto-deploy from `main` |
| CI | GitHub Actions | GitHub | Lint + tests on pushes to `Backend` and `main`, and on PRs to `main` |
| Client (consumer only) | Swift/SwiftUI iOS app; `test.html` for local testing | Device / `api` static files | The iOS app is out of backend scope |
| IDE | VS Code | Local | ESLint + Prettier |

## Scope

The backend owns everything between the photo arriving and the recommendation leaving, except the model math itself.

**In scope**

- Express API with every endpoint in the API specification
- Upload handling, EXIF extraction, and storage in Supabase
- Quality gate Tier A (Node) and wiring for Tier B (CV output)
- An inference adapter with `mock` and `remote` modes
- A deployable Python inference service with **stub** CV and ML stages that return contract-valid fake data, structured so the real models drop in later
- The decision policy (thresholds to recommendation) and config versioning
- The Supabase schema, migrations, bucket setup, and seed config
- Ground-truth ingestion (API + bulk CSV import) for lab measurements
- An evaluation export (predictions joined to ground truth, as CSV)
- Railway deployment, GitHub Actions CI, tests, logging, and security middleware
- A local test page (`test.html`) and backend docs (README, OpenAPI, runbook)

**Out of scope**

- Training, fine-tuning, or implementing the real CV or ML models (ML team)
- Changing PlantVision (`plantvision/`) beyond keeping it working inside the monorepo (ML team)
- Choosing the NDVI, confidence, or mask thresholds (Product Owner); the backend only stores and applies them
- The iOS app UI and camera flow (frontend teammate)
- Advanced recommendations: fertilizer type, dosage, or schedule
- Aggregating results across several images in one scan: store them all, and the scan shows the latest image's result
- GPU hosting, on-device inference, and external NIR hardware
- Team B's aerial or drone imagery pipeline

## Repository structure

The repo is a monorepo with one folder per Railway service. Each service's Railway root directory is its folder. `contracts/` is shared by both services and is the single source of truth for the inference contract. `plantvision/` is the ML team's existing CV pipeline prototype, kept self-contained; it is a candidate implementation for the inference service's CV stage.

```
DrHorticulture-Ver6/
├─ api/                          # Railway service "api" (root dir: /api)
│  ├─ src/
│  │  ├─ app.js                  # express app + middleware wiring
│  │  ├─ server.js               # listens on '::' and PORT
│  │  ├─ config/env.js           # zod-validated env vars; exit on invalid
│  │  ├─ routes/                 # scans.js, config.js, groundTruth.js, health.js, export.js
│  │  ├─ middleware/             # upload.js, adminKey.js, auth.js, errorHandler.js, requestId.js
│  │  ├─ services/
│  │  │  ├─ pipeline.js          # orchestrates intake → gate → inference → decision
│  │  │  ├─ intake.js            # validation, orientation, EXIF
│  │  │  ├─ qualityGate.js       # Tier A metrics + Tier B checks
│  │  │  ├─ storage.js           # Supabase Storage upload + signed URLs
│  │  │  ├─ decision.js          # pure function: result + config → recommendation
│  │  │  └─ configService.js     # loads the active decision_config (cached 60 s)
│  │  ├─ inference/
│  │  │  ├─ index.js             # picks adapter by INFERENCE_MODE
│  │  │  ├─ mock.js              # returns contracts/inference.v1.example.json
│  │  │  ├─ remote.js            # fetch + timeout + 1 retry + zod validation
│  │  │  └─ schema.js            # zod schema mirroring the contract
│  │  ├─ db/                     # supabase client + query helpers per table
│  │  └─ errors.js               # AppError class + error codes
│  ├─ public/test.html           # one-button upload page (dev only)
│  ├─ scripts/                   # gate-calibrate.js, import-ground-truth.js, export-eval.js
│  ├─ test/                      # unit + integration tests, fixtures/ images
│  ├─ package.json
│  └─ .env.example
├─ inference/                    # inference service (Railway root dir /inference if hosted there)
│  ├─ app.py                     # Flask: POST /v1/analyze, GET /health; key check, download, assembles response
│  ├─ cv/                        # CV stage; seam: cv.analyze(image) -> dict
│  │  ├─ __init__.py             # analyze(): runs detector, embedder, features
│  │  ├─ detector.py             # YOLO-seg → mask, mask_confidence, leaf_fraction, plant_detected, angle_ok
│  │  ├─ embedder.py             # backbone → embedding; species classifier → species_probs
│  │  └─ features.py             # VARI, ExG, GLI, NGRDI on masked pixels
│  ├─ ml/                        # ML stage; seam: ml.predict(embedding, species_probs) -> dict
│  │  ├─ __init__.py             # predict()
│  │  └─ regressor.py            # ensemble heads → ndvi (mean), ensemble_std, confidence
│  ├─ weights/                   # model weights under 50 MB; larger ones download at startup
│  ├─ tests/                     # pytest: response shape, key check, health, error paths
│  ├─ requirements.txt
│  └─ Procfile                   # gunicorn -b [::]:$PORT --workers 1 --threads 4 --timeout 120 app:app
├─ plantvision/                  # ML team's CV pipeline prototype (Python package, own README/tests)
├─ contracts/
│  ├─ inference.v1.schema.json   # JSON Schema for request + response
│  └─ inference.v1.example.json  # canonical fake response (used by mock + stub)
├─ supabase/migrations/          # SQL migrations (Supabase CLI)
├─ docs/BACKEND_SPEC.md          # this doc
└─ .github/workflows/ci.yml
```

## Data model

There are five tables. A scan holds one or more images, each image can have analyses and lab ground truth, and every analysis records which model version and config version produced it. The SQL below is the current target schema. `supabase/migrations/0001_init.sql` created the original version, and later numbered migrations apply each change (`0003_species_optional_drop_spad.sql` for the 2026-10-01 changes). A migration that has been applied is never edited; a change goes in a new file.

```sql
create type scan_status as enum ('uploaded','rejected','processing','completed','abstained','failed');
create type recommendation as enum ('fertilize','do_not_fertilize','abstain');

create table scans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,  -- nullable until auth is decided
  species     text,                                               -- optional; sent to inference as species_hint
  source      text not null default 'app' check (source in ('app','lab')),
  status      scan_status not null default 'uploaded',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table scan_images (
  id                 uuid primary key default gen_random_uuid(),
  scan_id            uuid not null references scans(id) on delete cascade,
  storage_path       text not null unique,          -- scans/{scan_id}/{image_id}.jpg
  mime_type          text not null,
  width              int,
  height             int,
  exif               jsonb not null default '{}',   -- device, iso, exposure; never GPS
  quality_passed     boolean,
  quality_metrics    jsonb not null default '{}',
  rejection_reasons  text[] not null default '{}',
  created_at         timestamptz not null default now()
);

create table decision_config (
  version         int primary key,
  ndvi_threshold  numeric not null,   -- ndvi below this → fertilize
  confidence_min  numeric not null,   -- model confidence below this → abstain
  mask_min        numeric not null,   -- mask confidence below this → abstain
  quality         jsonb not null,     -- Tier A gate thresholds
  active          boolean not null default false,
  notes           text,
  created_at      timestamptz not null default now()
);
create unique index decision_config_one_active on decision_config (active) where active;

create table analyses (
  id               uuid primary key default gen_random_uuid(),
  scan_id          uuid not null references scans(id) on delete cascade,
  image_id         uuid not null references scan_images(id) on delete cascade,
  model_version    text,
  config_version   int not null references decision_config(version),
  mask_confidence  numeric,
  leaf_fraction    numeric,
  features         jsonb not null default '{}',
  ndvi             numeric,
  confidence       numeric,
  recommendation   recommendation,    -- null when the run failed
  abstain_reason   text,
  raw_response     jsonb,             -- full inference response, for audits
  error            text,              -- set only when status = failed
  latency_ms       int,
  created_at       timestamptz not null default now()
);

create table ground_truth (
  id                uuid primary key default gen_random_uuid(),
  image_id          uuid not null references scan_images(id) on delete cascade,
  greenseeker_ndvi  numeric,          -- whole canopy, 0.00-0.99; the only ground truth
  distance_cm       numeric,
  lighting          text,
  measured_at       timestamptz,
  measured_by       text,
  notes             text,
  created_at        timestamptz not null default now()
);

create index on scans (user_id, created_at desc);
create index on scan_images (scan_id);
create index on analyses (scan_id, created_at desc);
create index on ground_truth (image_id);

-- RLS on with no policies: only the service-role key (the api) can read or write
alter table scans enable row level security;
alter table scan_images enable row level security;
alter table decision_config enable row level security;
alter table analyses enable row level security;
alter table ground_truth enable row level security;

-- PLACEHOLDER thresholds until the Product Owner decides
insert into decision_config (version, ndvi_threshold, confidence_min, mask_min, quality, active, notes)
values (1, 0.50, 0.70, 0.80,
  '{"min_short_side_px":1024,"luminance_min":60,"luminance_max":200,"clipped_max_pct":5,"blur_min":100}',
  true, 'PLACEHOLDER values - recalibrate with lab photos and PO input');
```

The storage bucket `scan-images` is private. The object path is `scans/{scan_id}/{image_id}.{ext}`. The original file is stored untouched, and nothing is ever overwritten.

`updated_at` on `scans` is set by the api on every status change; no trigger is needed.

## API specification

All endpoints live under `/api/v1` except `/health`, return JSON, and share one error shape. Admin endpoints require the header `x-admin-key: <ADMIN_API_KEY>` until real auth exists.

| Method | Path | Access | Request | Success |
| --- | --- | --- | --- | --- |
| GET | `/health` | Public | — | 200 `{ status, db, inference_mode }` |
| POST | `/api/v1/scans` | App | multipart: `image` (JPEG/PNG, ≤ 10 MB), `species` (optional text) | 201 with the scan object (below) |
| POST | `/api/v1/scans/:id/images` | App | multipart: `image` | 201 with the scan object; allowed when status is `rejected`, `abstained`, or `failed` |
| GET | `/api/v1/scans/:id` | App | — | 200 scan object with its latest analysis |
| GET | `/api/v1/scans` | App | query: `limit` (≤ 50), `cursor` | 200 `{ items, next_cursor }`, newest first |
| GET | `/api/v1/config/decision` | Admin | — | 200 active config row |
| POST | `/api/v1/config/decision` | Admin | body: thresholds + `notes` | 201 new version, set active (old rows are never edited) |
| POST | `/api/v1/ground-truth` | Admin | body: `image_id`, `greenseeker_ndvi` (0.00–0.99), `distance_cm`, `lighting`, `measured_at`, `measured_by` | 201 row |
| GET | `/api/v1/export/evaluation.csv` | Admin | query: `from`, `to` (optional) | 200 CSV of analyses joined to ground truth |

The scan object is returned by every scan endpoint:

```json
{
  "scan_id": "uuid",
  "species": "geranium",
  "status": "completed",
  "image": { "id": "uuid", "url": "<signed URL, 1 h>", "quality": { "passed": true, "metrics": {} } },
  "result": {
    "recommendation": "fertilize",
    "ndvi": 0.41,
    "confidence": 0.82,
    "abstain_reason": null,
    "model_version": "stub-0.1",
    "config_version": 1
  },
  "created_at": "2026-10-01T15:04:05Z"
}
```

`species` is what the client sent, or `null`. `result` is `null` while the status is `processing`, `rejected`, or `failed`.

The error shape is shared by every endpoint:

```json
{
  "error": {
    "code": "IMAGE_REJECTED",
    "message": "Photo is too dark.",
    "details": { "reasons": ["too_dark"], "hints": ["Move to bright, indirect light."] },
    "scan_id": "uuid",
    "request_id": "uuid"
  }
}
```

| HTTP | code | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Missing or invalid field (for example, a `species` over 64 characters) |
| 401 | `UNAUTHORIZED` | Bad or missing admin key or JWT |
| 404 | `NOT_FOUND` | Unknown scan or image id |
| 409 | `INVALID_STATE` | Adding an image to a scan that is `processing` or `completed` |
| 413 | `PAYLOAD_TOO_LARGE` | File over `MAX_UPLOAD_MB` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Not JPEG or PNG; the HEIC message tells the client to send JPEG |
| 422 | `IMAGE_REJECTED` | Tier A or Tier B quality gate failed; `details` holds the reasons and hints |
| 429 | `RATE_LIMITED` | Over the rate limit |
| 503 | `INFERENCE_UNAVAILABLE` | Inference timed out, was unreachable, or returned a non-200 or schema-invalid response (after 1 retry where retries apply); scan status is `failed`, never `abstained` |
| 500 | `INTERNAL_ERROR` | Anything else; logged with `request_id` |

## Inference contract (v1)

The api and the ML team meet at one HTTP endpoint, `POST {INFERENCE_URL}/v1/analyze`. The CV and ML models run inside it in sequence, and the response exposes both stages as raw numbers. The service never decides fertilize, do not fertilize, or abstain; the api does (see Decision policy). The backend builds against this contract now, using a mock; the ML team later replaces the stub function bodies without changing the shape.

v1 was revised in place on 2026-10-01, because no inference service was live yet (see Change log). Once one is live, v1 is frozen: a breaking change means `/v2/analyze` plus `contracts/inference.v2.*`.

**What the models do** (owned by the ML team; the backend treats them as a black box):

1. YOLO-seg, LoRA fine-tuned, segments the canopy and masks out petals, pot, and soil.
2. A frozen pretrained CNN backbone turns the image into an embedding.
3. A pretrained species classifier (external, not trained by the team) reads the embedding and outputs a probability distribution over species.
4. Shallow regression heads (ridge, GBM, or a small MLP) take the embedding plus the species probabilities and estimate NDVI.
5. The spread of that ensemble of heads gives the confidence.

Request (`api` → `inference`), sent with the header `x-inference-key: <INFERENCE_API_KEY>`:

```json
{
  "image_url": "<Supabase signed URL, valid 5 min>",
  "image_id": "uuid",
  "species_hint": "geranium"
}
```

`species_hint` is the species the client sent (trimmed, lowercased), or `null` when it sent none. It is a hint only.

Response 200 (canonical example, saved as `contracts/inference.v1.example.json`):

```json
{
  "model_version": "stub-0.1",
  "segmentation": { "plant_detected": true, "mask_confidence": 0.91, "leaf_fraction": 0.42 },
  "species": { "top_label": "geranium", "top_prob": 0.83 },
  "features": { "vari": 0.12, "exg": 0.31, "gli": 0.18, "ngrdi": 0.09 },
  "estimate": { "ndvi": 0.62, "confidence": 0.78, "ensemble_std": 0.04, "ensemble_size": 5 },
  "checks": { "angle_ok": true }
}
```

Field rules (enforced by `api/src/inference/schema.js` on every response):

| Field | Type | Range | Required |
| --- | --- | --- | --- |
| `model_version` | string | non-empty | Yes |
| `segmentation.plant_detected` | boolean | — | Yes |
| `segmentation.mask_confidence` | number | 0 to 1 | Yes |
| `segmentation.leaf_fraction` | number | 0 to 1 | Yes |
| `species.top_label` | string | non-empty | Yes |
| `species.top_prob` | number | 0 to 1 | Yes |
| `features` | object of numbers | any keys, no range | Yes (may be empty) |
| `estimate.ndvi` | number | -1 to 1 | Yes |
| `estimate.confidence` | number | 0 to 1 | Yes |
| `estimate.ensemble_std` | number | ≥ 0 | Yes |
| `estimate.ensemble_size` | integer | ≥ 1 | Yes |
| `checks.angle_ok` | boolean | — | Yes |
| `checks.calibration_card` | boolean | — | No (recorded only, not enforced) |

- Every score and probability is 0 to 1, and the api never recomputes `confidence`.
- `estimate.ndvi` keeps the physical NDVI range, -1 to 1, so a regression head that overshoots slightly does not fail the scan. GreenSeeker ground truth is 0.00–0.99. `TODO(decision):` narrow it to 0–1 if the team prefers.
- `features` are color indices such as VARI, ExG, GLI, and NGRDI, computed on the masked canopy pixels. Some of them are negative by definition, so they have no range. They are the Sprint 2 baseline and stay in the response.
- `calibration_card` is optional because no CV function produces it yet; the example and the stubs leave it out.
- The api stores the full response body in `analyses.raw_response`, so fields it does not use (species, ensemble spread) survive for evaluation.
- When no plant is found, the service still returns 200 with `plant_detected: false` and every required field filled in (placeholder numbers are fine), so the scan is `rejected` rather than `failed`.

Service rules:

- `POST /v1/analyze` returns 401 unless `x-inference-key` equals `INFERENCE_API_KEY`. `GET /health` needs no key and returns 200 `{ "status": "ok", "model_version": "…" }`.
- Errors return 4xx/5xx with `{ "error": { "code", "message" } }`. The api treats any non-200 response, timeout, or schema-invalid body as a failure: the scan becomes `failed` with HTTP 503 `INFERENCE_UNAVAILABLE`, never `abstained`.
- The service downloads the image itself from `image_url`. It needs no Supabase keys.
- Models load once, at import time, never per request. gunicorn binds `[::]:$PORT` and runs `--workers 1 --threads 4 --timeout 120`.

Service structure (how the real models plug in):

The service has two seams with fixed signatures. The stubs return hardcoded values through exactly these signatures, and teammates replace only the function bodies.

```python
# inference/cv/__init__.py: the CV stage, built from cv/detector.py, cv/embedder.py, cv/features.py
def analyze(image: np.ndarray) -> dict:   # RGB uint8, H x W x 3
    # keys: mask, mask_confidence, leaf_fraction, plant_detected, angle_ok,
    #       embedding (float32[D]), species_probs (float32[K]), features (dict of floats)

# inference/ml/__init__.py: the ML stage, built from ml/regressor.py
def predict(embedding, species_probs) -> dict:
    # keys: ndvi (mean of the ensemble heads), ensemble_std, confidence
```

- `cv/detector.py`: YOLO-seg → `mask`, `mask_confidence`, `leaf_fraction`, `plant_detected`, `angle_ok`.
- `cv/embedder.py`: backbone → `embedding`; species classifier → `species_probs`. It also defines `SPECIES_LABELS` (length K), which `app.py` uses to turn `species_probs` into `species.top_label` and `species.top_prob`.
- `cv/features.py`: VARI, ExG, GLI, NGRDI on the masked pixels.
- `ml/regressor.py`: the ensemble heads → `ndvi`, `ensemble_std`, `confidence`. It also defines `ENSEMBLE_SIZE`, reported as `estimate.ensemble_size`.
- `app.py` handles HTTP, the key check, request validation, and the image download; calls `cv.analyze`, then `ml.predict`; and assembles the v1 response. `mask` and `embedding` never leave the service.
- `SPECIES_LABELS` and `ENSEMBLE_SIZE` are `TODO(decision):` additions. The seams return neither the label names nor the head count, and the response needs both.
- A host builds the service from its own folder, so the stubs keep their own copy of the example values. A test checks the stub service's full response against `contracts/inference.v1.example.json`, so they cannot drift.

The `api` mock adapter returns the example file above, with `model_version` set to `mock-0.1`. For tests it can be forced to return low confidence, no plant, or an error through the `x-mock-scenario` header, which is honored only when `NODE_ENV` is not `production`.

## Pipeline behavior

Every threshold below is read from the active `decision_config` row, never hardcoded. The numbers shown are the v1 placeholders.

**Intake rules**

- Accept one file in field `image`, JPEG or PNG, at most `MAX_UPLOAD_MB` (10). Check the type by the file's magic bytes, not by its extension.
- Reject HEIC/HEIF with 415 and the message "Send the photo as JPEG". The iOS client converts before upload.
- `species` is optional. When present it is trimmed and lowercased and must be 1–64 characters; it is stored on `scans.species` and sent to inference as `species_hint`. When it is absent, empty, or only whitespace, both are `null`.
- Auto-orient with `sharp().rotate()` for metrics only. The stored file is the untouched original.
- Keep only these EXIF fields: `Make`, `Model`, `ISO`, `ExposureTime`, `FNumber`, `FocalLength`, `DateTimeOriginal`, `WhiteBalance`. Never store GPS data.

**Quality gate, Tier A (Node, before inference)**

Compute every metric on a grayscale copy downscaled to 1024 px wide, so values are comparable across phones. Return all failing reasons at once, not just the first.

| Check | Metric | Fails when | Reason code | Hint shown to user |
| --- | --- | --- | --- | --- |
| Resolution | Short side of the original, px | < `min_short_side_px` (1024) | `resolution_too_low` | Use the main camera and don't crop |
| Too dark | Mean luminance, 0–255 | < `luminance_min` (60) | `too_dark` | Move to bright, indirect light |
| Too bright | Mean luminance, 0–255 | > `luminance_max` (200) | `too_bright` | Avoid direct sun or flash glare |
| Clipping | % of pixels ≥ 250 | > `clipped_max_pct` (5) | `overexposed` | Avoid direct sun on the leaves |
| Blur | Laplacian variance (3×3 kernel, `sharp` convolve with offset 128) | < `blur_min` (100) | `blurry` | Hold still and tap to focus on the leaves |

The metrics are stored in `scan_images.quality_metrics` and returned as `image.quality.metrics`, rounded to 2 decimals, with the keys `short_side_px`, `mean_luminance`, `clipped_pct`, and `laplacian_var`. They do not depend on the thresholds, so stored photos can be re-judged when the thresholds change. A metric exactly at its threshold passes. The gate runs before the photo is stored. A photo that fails is still stored, on a scan with status `rejected`, so a retake can be added to it, and the request returns 422 `IMAGE_REJECTED` with that `scan_id`.

**Quality gate, Tier B (from the inference response)**

- `segmentation.plant_detected = false` → reject with `no_plant_detected` ("Center the plant and fill the frame").
- Otherwise, `checks.angle_ok = false` → reject with `bad_angle` ("Shoot from above at the angle in the guide").
- Tier B stops at the first failure, unlike Tier A: with no plant, the angle means nothing. Both checks are the first two rules of `decide()` below.
- A Tier B rejection still saves the `analyses` row, with `recommendation` null, for later study.

**Decision policy** (`api/src/services/decision.js`, a pure function). The inference service only returns numbers; this function makes every decision. The rules apply in order and the first match wins:

1. `plant_detected = false` → `rejected`, `no_plant_detected` (Tier B)
2. `angle_ok = false` → `rejected`, `bad_angle` (Tier B)
3. `mask_confidence < mask_min` → `abstained`, `low_mask_confidence`
4. `confidence < confidence_min` → `abstained`, `low_confidence`
5. Otherwise `ndvi < ndvi_threshold` → `fertilize`, else `do_not_fertilize` (`completed`)

```js
const reject = (reason) => ({ status: 'rejected', recommendation: null, reason });
const abstain = (reason) => ({ status: 'abstained', recommendation: 'abstain', reason });

export function decide({ segmentation: s, estimate: e, checks: c }, cfg) {
  if (!s.plant_detected) return reject('no_plant_detected');
  if (!c.angle_ok) return reject('bad_angle');
  if (s.mask_confidence < cfg.mask_min) return abstain('low_mask_confidence');
  if (e.confidence < cfg.confidence_min) return abstain('low_confidence');
  return {
    status: 'completed',
    recommendation: e.ndvi < cfg.ndvi_threshold ? 'fertilize' : 'do_not_fertilize',
    reason: null,
  };
}
```

`reason` becomes `analyses.abstain_reason` for an abstention, and `scan_images.rejection_reasons` plus the 422 `details` for a rejection. Every `analyses` row stores `model_version` and `config_version`.

**Scan statuses**

| Status | Meaning | Final? |
| --- | --- | --- |
| `uploaded` | File stored, gate not yet run | No |
| `rejected` | Tier A or Tier B failed; the user should retake | No (a retake can be added) |
| `processing` | Inference in progress | No |
| `completed` | Recommendation is fertilize or do not fertilize | Yes |
| `abstained` | The model was not confident enough; no recommendation | No (a retake can be added) |
| `failed` | System error: timeout, invalid response, or crash | No (a retake can be added) |

`abstained` is the model's decision and `failed` is a system problem. They must never be mixed, because abstention rate is an evaluation metric.

**Retakes and multiple images**

`POST /scans/:id/images` runs the same pipeline on a new image in the same scan. The scan's status and result always reflect the most recent image. Earlier images and their analyses are kept for the robustness study.

**Timeouts and retries**

The api calls inference with `INFERENCE_TIMEOUT_MS` (60 000) per attempt, which covers a 10–30 s cold start, and retries once after 1 s on a network error, a timeout, or a 5xx. It does not retry on a 4xx or a schema-invalid body. After that it marks the scan `failed` (never `abstained`) and returns 503 `INFERENCE_UNAVAILABLE`. The worst case is just over 2 minutes, so clients must wait at least 150 s for a scan request (see Assumptions).

## Configuration and environment variables

Infrastructure settings live in env vars; product thresholds live in the `decision_config` table. The api validates every env var with `zod` at boot and exits with a clear message if one is missing or invalid. Every variable goes in `api/.env.example` (or `inference/.env.example`) with a safe placeholder value.

| Variable | Service | Example | Notes |
| --- | --- | --- | --- |
| `PORT` | api, inference | `3000` / `8000` | Railway sets it in production |
| `NODE_ENV` | api | `development` | `production` on Railway |
| `LOG_LEVEL` | api | `info` | pino level |
| `SUPABASE_URL` | api | `https://xxxx.supabase.co` | — |
| `SUPABASE_SERVICE_ROLE_KEY` | api | (secret) | Server only; never logged or sent to clients |
| `SUPABASE_BUCKET` | api | `scan-images` | — |
| `INFERENCE_MODE` | api | `mock` | `mock` or `remote` |
| `INFERENCE_URL` | api | `https://inference.example.com` | Wherever `inference` runs (see Hosting and budget); `https://` whenever it is reachable from the internet |
| `INFERENCE_API_KEY` | api, inference | (secret) | Shared secret sent as `x-inference-key`; at least 16 characters; required on the api when `INFERENCE_MODE=remote` |
| `INFERENCE_TIMEOUT_MS` | api | `60000` | Per attempt; covers a 10–30 s cold start |
| `MAX_UPLOAD_MB` | api | `10` | — |
| `CORS_ORIGINS` | api | `http://localhost:3000` | Comma-separated allowlist |
| `RATE_LIMIT_PER_MIN` | api | `30` | Per IP, on `POST` scan routes |
| `ADMIN_API_KEY` | api | (secret) | Guards the config, ground-truth, and export routes |
| `AUTH_REQUIRED` | api | `false` | `true` turns on Supabase JWT checks for app routes |
| `MODEL_VERSION` | inference | `stub-0.1` | Returned in every response |

Locally, run the api with `INFERENCE_MODE=mock` so it needs nothing but Supabase. The inference service can also run locally on port 8000, with `INFERENCE_URL=http://localhost:8000` and the same `INFERENCE_API_KEY` on both sides, to test `remote` mode.

## Hosting and budget

- Only `api` must live on Railway, on the Hobby plan ($5/month, no overage). It runs small and always on.
- `inference` can run anywhere; the api only knows `INFERENCE_URL`. Options: a Railway service that sleeps when idle, a teammate's laptop behind an ngrok or Cloudflare tunnel, Modal, or Hugging Face Spaces.
- `inference` may be reachable from the internet, so it requires the `x-inference-key` header (`INFERENCE_API_KEY`, set on both services). Use `https://` for `INFERENCE_URL` whenever the traffic leaves a private network, so the key and the signed image URL are never sent in clear text.
- `inference` wakes on an upload and sleeps afterwards. Expect a 10–30 s cold start and under 1 s warm, on CPU with no GPU, and 0.8–1.5 GB of RAM once the models are loaded.
- Model weights under 50 MB are committed in `inference/weights/`. Larger weights live in a Supabase bucket and are downloaded at startup. `TODO(decision):` how, given that `inference` holds no Supabase keys (see Open decisions).
- Keep `INFERENCE_MODE=mock` during development.

## Action plan

There are eight phases, each ending in something demoable. Phases 0–4 need nothing from the ML team and can finish in Sprints 1–2. Each task is roughly one PR (or one commit on `Backend`, per rule 5).

### Work modules

The phases group into modules that can be picked up as units of work. After M0, modules M1, M2, and M3 can proceed in parallel.

| Module | Covers | Depends on | Delivers |
| --- | --- | --- | --- |
| M0 Repo + tooling | 0.1 | — | Monorepo layout, PlantVision in `plantvision/`, ESLint/Prettier, `.gitignore`, `.env.example` |
| M1 Inference contract | 0.6 | M0 | `contracts/inference.v1.*` |
| M2 Database | 0.5 | M0 | Migration, bucket, seed config |
| M3 API core | 0.2–0.4 | M0 | Express skeleton, env validation, errors, logging, `/health` |
| M4 CI + deploy | 0.7–0.8 | M3 | GitHub Actions, Railway `api` |
| M5 Intake + storage | Phase 1 | M2, M3 | Upload, EXIF, storage, `POST /scans` → `uploaded`, `test.html` |
| M6 Quality gate A | Phase 2 | M5 | Config service, gate, fixtures, calibration script |
| M7 Inference adapter + decision | Phase 3 | M1, M6 | Mock/remote adapters, `decide()`, full pipeline, read and retake endpoints |
| M8 Inference service | Phase 4, 5.1 | M1 | Flask service with stub CV and ML seams, key-protected, on the host the team picks |
| M9 Admin + ground truth | 5.2–5.4 | M7 | Admin key, config versioning, ground truth, latency check |
| M10 Security + client | Phase 6 | M7 | helmet/CORS/rate limit, JWT, OpenAPI |
| M11 Evaluation + handoff | Phase 7 | M9 | Evaluation export, metrics, README, runbook |

### Phase 0 — Foundation (Sprint 1)

- [x] **0.1** Create the monorepo layout from Repository structure (PlantVision is already moved into `plantvision/`), with ESLint, Prettier, `.gitignore`, and `api/.env.example`.
- [x] **0.2** Scaffold the Express 5 app: `app.js` / `server.js` split, listening on `::`, with `pino-http`, a request-id middleware, and a central error handler emitting the shared error shape.
- [x] **0.3** Add `config/env.js` with zod validation of every env var; the app exits non-zero on invalid config.
- [x] **0.4** Add `GET /health` that returns db reachability (a trivial Supabase query) and `inference_mode`.
- [x] **0.5** Commit `supabase/migrations/` (0001 schema, 0002 private bucket `scan-images`, 0003 the 2026-10-01 changes) and apply them in order to the Supabase project.
- [x] **0.6** Commit `contracts/inference.v1.schema.json` and `contracts/inference.v1.example.json` from Inference contract.
- [x] **0.7** Add a GitHub Actions workflow that runs lint and `vitest` for `api/`, and `pytest` for `inference/` and `plantvision/`, on pushes to `Backend` and `main` and on PRs to `main`.
- [x] **0.8** Create the Railway project and the `api` service (root `/api`), set env vars, and turn on auto-deploy from `main`.

**Done when:** the Railway URL `/health` returns 200 with `db: "ok"`, and CI is green on `main`.

### Phase 1 — Intake and storage (Sprint 2)

- [x] **1.1** Add the multer upload middleware: memory storage, `MAX_UPLOAD_MB` limit, magic-byte type check, HEIC → 415.
- [x] **1.2** Build `intake.js`: optional species validation, `sharp` metadata and auto-orient, and the EXIF allowlist via `exifr`.
- [x] **1.3** Build `storage.js`: upload the original to `scans/{scan_id}/{image_id}.{ext}`, and create signed URLs (5 min for inference, 1 h for clients).
- [x] **1.4** Implement `POST /api/v1/scans` up to storage: insert the `scans` + `scan_images` rows and return 201 with status `uploaded`.
- [x] **1.5** Add `public/test.html`, served only when `NODE_ENV` is not `production`: a file picker, an optional species field, one button, and the raw JSON response.

**Done when:** an upload from the test page puts the file in the bucket and the rows in both tables, with EXIF filled in and no GPS.

### Phase 2 — Quality gate, Tier A (Sprint 2)

- [x] **2.1** Add `configService.js`, which loads the active `decision_config` row with a 60 s in-memory cache.
- [x] **2.2** Build `qualityGate.js`, which computes the five Tier A metrics from Pipeline behavior and returns `{ passed, metrics, reasons, hints }`.
- [x] **2.3** Wire the gate into the pipeline: save metrics and reasons on `scan_images`; on failure set status `rejected` and return 422 `IMAGE_REJECTED`.
- [x] **2.4** Write `scripts/gate-calibrate.js`, which runs the gate over a folder of lab photos and prints each metric's distribution and pass rate, so thresholds can be tuned.
- [x] **2.5** Add unit tests with fixture images: good, dark, bright, blurry, and low-resolution.

**Done when:** each bad fixture is rejected with exactly the expected reason, and the good fixture passes.

### Phase 3 — Mock inference and decision (Sprint 2)

- [x] **3.1** Build `inference/schema.js`, a zod schema mirroring the contract, with range checks.
- [ ] **3.2** Build `inference/mock.js` (the example file plus `x-mock-scenario` outside production) and `inference/remote.js` (fetch with `x-inference-key`, timeout, 1 retry, schema validation).
- [ ] **3.3** Build `inference/index.js`, which picks the adapter from `INFERENCE_MODE`.
- [ ] **3.4** Build `decision.js` exactly as specified (Tier B included), plus unit tests for every branch and boundary value.
- [ ] **3.5** Finish `pipeline.js`: status `processing` → inference → `decide()` → `analyses` row (versions, latency, raw response) → final status. A failure sets `failed` and returns 503.
- [ ] **3.6** Implement `GET /scans/:id` and `GET /scans` (cursor pagination, newest first, signed image URLs).
- [ ] **3.7** Implement `POST /scans/:id/images` with the state rules from the API specification.

**Done when:** in `mock` mode, the test page returns a full scan object with a recommendation, and all four mock scenarios produce the right status.

### Phase 4 — Inference service stub (end of Sprint 2)

- [ ] **4.1** Build `inference/app.py`: Flask `POST /v1/analyze` (checks `x-inference-key`, validates the request, downloads the image to prove egress works, calls `cv.analyze` then `ml.predict`, returns the v1 response) and `GET /health`. Models load at import time.
- [ ] **4.2** Add the seams as stubs with the exact signatures from Inference contract: `cv/__init__.py` (`analyze`), `cv/detector.py`, `cv/embedder.py` (with `SPECIES_LABELS`), `cv/features.py`, `ml/__init__.py` (`predict`), and `ml/regressor.py` (with `ENSEMBLE_SIZE`). Tests check the full response against `contracts/inference.v1.example.json` and a 401 without the key.
- [ ] **4.3** Add the `Procfile` with gunicorn bound to `[::]:$PORT` and `--workers 1 --threads 4 --timeout 120`, plus `requirements.txt` with pinned versions.
- [ ] **4.4** Deploy `inference` on the host the team picks (see Hosting and budget), with `INFERENCE_API_KEY` and `MODEL_VERSION` set, over HTTPS if it is public.
- [ ] **4.5** On the deployed `api`, set `INFERENCE_URL` and `INFERENCE_API_KEY` and flip `INFERENCE_MODE=remote`. Local development stays on `mock`.

**Done when:** the deployed api returns a scan object whose `model_version` is `stub-0.1`, reached through `INFERENCE_URL` with the shared key, and a request to `inference` without the key gets 401.

### Phase 5 — Real models and data (Sprint 3, depends on the ML team)

- [ ] **5.1** Support the ML team as they replace the stub function bodies in `inference/cv/` and `inference/ml/` (PlantVision is one source for the CV code); every response must pass the v1 schema, and invalid ones mark the scan `failed`.
- [ ] **5.2** Add the admin-key middleware, plus `GET` and `POST /config/decision`. POST creates a new version and flips `active` in one transaction.
- [ ] **5.3** Add `POST /ground-truth` (GreenSeeker NDVI only) and `scripts/import-ground-truth.js` for bulk CSV import from the lab; the import ignores any SPAD column.
- [ ] **5.4** Log latency; check p50 and p95 over 50 real requests, reporting cold starts separately. If p95 is over 15 s, add `pg-boss` and a `worker` service. `POST /scans` then returns 202 with status `processing`, and clients poll.

**Done when:** a lab photo gets a real-model result stored with `model_version` and `config_version`, and ground truth can be attached to it.

### Phase 6 — Client readiness and security (Sprint 4)

- [ ] **6.1** Add `helmet`, the CORS allowlist, and `express-rate-limit` on the POST scan routes.
- [ ] **6.2** Add Supabase JWT verification middleware behind `AUTH_REQUIRED`; set `user_id` on scans and scope list and get to the owner.
- [ ] **6.3** Publish OpenAPI docs (`docs/openapi.yaml`) for the iOS teammate, and confirm JPEG upload and the 422 retake flow on a real iPhone.

**Done when:** the full flow works from the iOS app against production, and the security checklist in Testing and security passes.

### Phase 7 — Evaluation and handoff (Sprint 5)

- [ ] **7.1** Add `GET /export/evaluation.csv` and `scripts/export-eval.js`: one row per analysis with ground truth, species, EXIF device, quality metrics, versions, and recommendation.
- [ ] **7.2** Add a summary script: MAE, RMSE, and Pearson r of NDVI vs GreenSeeker, plus abstention rate, gate rejection rate by reason, and failure rate.
- [ ] **7.3** Write the README (local setup in under 10 commands), a runbook (deploys, env vars, key rotation, rollback), and a final pass to make `docs/BACKEND_SPEC.md` match what was built.

**Done when:** a teammate can clone, run locally in mock mode, and produce the evaluation CSV without help.

## Testing and security

A task is not done until its tests pass in CI and nothing in this checklist regresses.

**Testing**

- **Unit:** `decision.js` covers every branch, including both Tier B rejections, and each threshold's exact boundary. `qualityGate.js` runs against fixture images in `api/test/fixtures/`. `inference/remote.js` is tested with `fetch` mocked for timeout then success, 5xx then success, 4xx, and a schema-invalid body, and checks that it sends `x-inference-key`. The env schema rejects bad config.
- **Integration:** `supertest` against the Express app in `mock` mode covers upload → 201, bad type → 415, too large → 413, a dark photo → 422, a retake on a rejected scan → 201, and a retake on a completed scan → 409.
- **Database in tests:** use a separate Supabase project (or the Supabase CLI local stack), never production. Tests clean up their own rows and objects.
- **Contract:** a test validates `contracts/inference.v1.example.json` against both `inference.v1.schema.json` and the zod schema, and the inference service's stub response against the example, so none of them can drift apart.

**Code standards**

- ES modules, async/await, and no callbacks. Route handlers stay thin; logic lives in `services/`.
- All errors go through `AppError` with a code from the API error table. There are no ad hoc `res.status(...).json(...)` error bodies.
- Every log line in the pipeline carries `request_id` and `scan_id`.

**Security checklist**

- [ ] The service-role key and `INFERENCE_API_KEY` exist only in host env vars and local `.env`, never in the repo, logs, or responses.
- [ ] `inference` returns 401 without the correct `x-inference-key`, and `INFERENCE_URL` is `https://` whenever inference is reachable from the internet.
- [ ] Bucket `scan-images` is private; clients only ever get signed URLs.
- [ ] RLS is enabled on every table.
- [ ] Uploads are limited by size, count (1), and magic-byte type.
- [ ] Rate limiting is on for the POST scan routes, with a CORS allowlist and `helmet` defaults.
- [ ] Admin routes return 401 without the correct `x-admin-key`.
- [ ] GPS EXIF is never stored.
- [ ] Inference responses are schema-validated before use; `test.html` and `x-mock-scenario` are disabled in production.
- [ ] `npm audit` shows no high or critical issues at each phase's end.

## Open decisions and assumptions

Every open decision has a working default, so none of them blocks the build. When one is settled, update the default here and in `decision_config` or env.

| Decision | Owner | Working default |
| --- | --- | --- |
| NDVI threshold for fertilize | Product Owner | 0.50 (placeholder in config v1) |
| Minimum model confidence (τ) | Product Owner + ML team | 0.70 |
| Minimum leaf-mask confidence | Product Owner | 0.80 (the spec asks for 70–80%) |
| Tier A gate thresholds | Backend + lab | v1 placeholders, recalibrated with `gate-calibrate.js` on lab photos. `blur_min` = 100 is an OpenCV-scale value; `sharp` convolve clamps to 0–255, so treat it as meaningless until calibrated |
| Is user login required? | Product Owner | No: `AUTH_REQUIRED=false`, `user_id` nullable |
| Retake-only vs several images per scan | Team | Both are stored; the scan shows the latest image's result |
| Inference framework | ML team | Flask + gunicorn stub; FastAPI is fine if the contract holds |
| Synchronous vs queued processing | Backend | Synchronous; switch to `pg-boss` only if warm p95 exceeds 15 s. Cold starts take 10–30 s, and a `worker` service costs Railway budget |
| JavaScript vs TypeScript | Backend | JavaScript (ES modules) |
| Calibration card required in photos? | Product Owner | Not required. `checks.calibration_card` is optional and recorded only; no CV function produces it yet |
| Range of `estimate.ndvi` | ML team + Backend | -1 to 1 (the physical range), so an overshooting regression head does not fail the scan; GreenSeeker ground truth is 0.00–0.99. Narrow to 0–1 if the team prefers |
| Source of `mask_confidence` | ML team | Comes from YOLO-seg in `cv/detector.py`; how per-detection scores are combined (max vs. area-weighted mean) is the ML team's call |
| No plant found in the CV stage | ML team | Return 200 with `plant_detected: false` and every required field filled in (placeholders are fine), so the scan is `rejected` rather than `failed` |
| Showing the predicted species to the client | Product Owner + Team | Not shown. `species.top_label` and `top_prob` are stored in `analyses.raw_response` only; the scan object returns the species the client sent |
| Species label names and ensemble size | ML team | `cv/embedder.py` defines `SPECIES_LABELS` and `ml/regressor.py` defines `ENSEMBLE_SIZE`, because the seams return neither |
| Embedding size D, species count K, ensemble form, weight file sizes | ML team | Open; none blocks the backend. Assumed: several heads on one embedding. The stubs use small placeholder sizes |
| Where `inference` is hosted | Team | Undecided among Railway (sleeping when idle), a tunnel to a laptop, Modal, or Hugging Face Spaces; the api only needs `INFERENCE_URL` and `INFERENCE_API_KEY` |
| Downloading large weights | ML team + Backend | Undecided. Weights over 50 MB go in a Supabase bucket, but `inference` holds no Supabase keys; options include a public `model-weights` bucket or a long-lived signed URL in an env var. It must never get the service-role key. Models load at import time, so the host's health check passes only after loading |
| Packaging PlantVision into `inference` | ML team + Backend | Undecided. A host that builds `inference` from its own folder cannot see `plantvision/`; options include copying the needed code into the seams, a Dockerfile built from the repo root, or publishing PlantVision as a package |

**Assumptions**

- The iOS app uploads JPEG, not HEIC.
- The CV and ML models run on CPU inside one Python service and fit its host's memory (about 0.8–1.5 GB loaded). If not, the ML team exports to ONNX or picks a bigger host.
- Lab ground truth is GreenSeeker NDVI only (whole canopy, 0.00–0.99) and arrives as a CSV that can be matched to a stored image id or file name.
- The iOS client waits at least 150 s for `POST /scans` and `POST /scans/:id/images`, since a cold start plus one retry can take over 2 minutes. URLSession's default 60 s request timeout is too short.
- The dataset stays small (hundreds to low thousands of images), so no partitioning or CDN is needed.

## Change log

| Date | Change | Why |
| --- | --- | --- |
| 2026-09-30 | Repo root is the monorepo; PlantVision moved into `plantvision/` | The repo already held PlantVision at its root; its `ARCHITECTURE.md` §5 intends it as a self-contained folder inside a larger repo |
| 2026-09-30 | `inference-stub/` renamed `inference/` and split into CV and ML stage slots (`cv/`, `ml/`, `pipeline.py`) with stub implementations; env vars `CV_MODEL`, `ML_MODEL` added | The team will insert its real CV and ML models into this service, so the folder is their long-term home, not a throwaway stub. The response shape is unchanged |
| 2026-09-30 | Phase 4 tasks renumbered 4.1–4.5 | Added task 4.2 for the stage slots |
| 2026-09-30 | Rule 5 (branching) and CI triggers added | Work happens on `Backend`, is integrated into the fork's `main`, then merged into the team repo |
| 2026-09-30 | CI and Tests row include `pytest` for `inference/` and `plantvision/` | Both Python packages live in the repo and must stay green |
| 2026-09-30 | Six open decisions added from reviewing PlantVision against the v1 contract | They affect how the real models fit the contract; deferred to the team |
| 2026-09-30 | Diagram in System overview redrawn as text | The original embedded diagram does not carry over to Markdown |
| 2026-10-01 | Inference contract v1 revised in place: header `x-inference-key`; request `species` replaced by nullable `species_hint`; response adds `species.top_label`/`top_prob` and `estimate.ensemble_std`/`ensemble_size`; `checks.angle_ok` now required; example values updated | The ML team's CV/ML context overrides the contract. No inference service was live, so v1 was edited rather than versioned |
| 2026-10-01 | `calibration_card` left out of the example; `estimate.ndvi` kept at -1 to 1; `features` have no range | Nothing in the seams produces `calibration_card`. The ML context's "all scores are 0–1" is read as covering scores and probabilities, not NDVI or color indices, which can be negative |
| 2026-10-01 | `scans.species` nullable and `species` optional in `POST /scans`; sent to inference as a hint | ML team: the models predict species themselves |
| 2026-10-01 | `ground_truth.spad` removed (migration `0003`); ground truth is GreenSeeker NDVI only | ML team: SPAD is not collected |
| 2026-10-01 | Tier B checks moved into `decide()` as rules 1–2 of one ordered policy; `decide()` now returns `status` and `reason` | The ML team's hard rules list Tier B and the thresholds as one ordered policy |
| 2026-10-01 | Inference layout changed to the seams `cv.analyze` and `ml.predict` (`cv/detector.py`, `cv/embedder.py`, `cv/features.py`, `ml/regressor.py`); `pipeline.py`, `base.py`/`stub.py`, `CV_MODEL`, and `ML_MODEL` removed | ML team's layout: teammates replace only function bodies |
| 2026-10-01 | `inference` may run on any host; new env var `INFERENCE_API_KEY` on both services; `INFERENCE_TIMEOUT_MS` default 30000 → 60000; timeouts are retried once; new Hosting and budget section; Phase 4 rewritten | Only the api must live on Railway (Hobby, $5/month); inference sleeps when idle and has a 10–30 s cold start |
| 2026-10-01 | Open decisions updated; the iOS client timeout added to Assumptions | Follow-ups from the ML context |
| 2026-10-01 | Tier A metric keys named (`short_side_px`, `mean_luminance`, `clipped_pct`, `laplacian_var`), thresholds stated as inclusive, and a rejected photo stated to be stored on a `rejected` scan | Phase 2 made them visible to clients in `image.quality.metrics` and the 422; the scan object showed `metrics: {}` |
