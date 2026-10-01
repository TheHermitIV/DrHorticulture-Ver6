# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Start here

`docs/BACKEND_SPEC.md` is the build spec for this repo: architecture, data model, API, inference contract,
pipeline rules, and the phased Action plan (grouped into work modules M0–M11). Read the sections relevant to
a task before starting it. Its agent rules apply:

- Work through the Action plan in order, one task per commit; don't start a phase until the previous
  phase's "Done when" passes.
- The Data model, API specification, Inference contract, and Pipeline behavior sections are contracts. If
  one must change, update the spec in the same commit and add a row to its Change log saying why.
- Anything unspecified: pick the simplest option, leave a `TODO(decision):` comment, and list it in the
  commit/PR description. Don't invent product rules; in-depth specifics are settled later with the team.
- Add no dependencies beyond the spec's Tech stack without asking.

## Scope

The backend builds the *structure* the team will plug models into, not the models. The CV and ML stages of
the inference service are stubs behind two fixed seams, `cv.analyze(image)` (`inference/cv/`) and
`ml.predict(embedding, species_probs)` (`inference/ml/`), that return contract-valid hardcoded data;
teammates replace only the function bodies. Don't implement computer-vision or ML logic.

`plantvision/` is the ML team's existing CV pipeline prototype (self-contained Python package with its own
`CLAUDE.md`, README, and tests). Don't modify it beyond keeping it working inside the monorepo.

## Git workflow

All work happens on the `Backend` branch of the fork (`erne2003/DrHorticulture-Ver6`). The repo owner
integrates `Backend` into the fork's `main`, tests, and then merges into the team repo; Railway deploys from
`main`. Never commit to `main`, push, or open PRs against `main` or the team repo unless asked.

## Layout

Monorepo, one folder per service (see the spec's Repository structure for the full tree; folders that
don't exist yet are created by their Action plan tasks):

- `api/` — Node 24 + Express 5 (ES modules, JavaScript). On Railway (Hobby plan); public; owns every rule
  and every write.
- `inference/` — Python 3.12 + Flask + gunicorn. Runs on whatever host the team picks (see the spec's
  Hosting and budget); turns an image URL into raw numbers, never decides, never writes data.
- `contracts/` — `inference.v1.schema.json` + `inference.v1.example.json`, the single source of truth for
  the api ↔ inference boundary. v1 was revised in place on 2026-10-01 because no inference service was
  live; once one is, v1 is frozen and breaking changes become v2.
- `supabase/migrations/` — Postgres schema (Supabase CLI).
- `plantvision/` — ML team's CV prototype (see above).

## Cross-cutting invariants

These span multiple files and are easy to break:

- Product thresholds (NDVI, confidence, mask, Tier A quality gate) come from the active `decision_config`
  row, never from code or env vars. Inference returns raw numbers only; `api/src/services/decision.js`
  makes every decision (Tier B rejections, abstentions, and the recommendation).
- `abstained` (model not confident) and `failed` (system error) scan statuses must never be conflated —
  abstention rate is an evaluation metric.
- All api errors go through `AppError` and the shared error shape; route handlers stay thin, logic lives
  in `api/src/services/`. Pipeline log lines carry `request_id` and `scan_id`.
- The stored image is the untouched original; GPS EXIF is never stored; the bucket is private and clients
  only get signed URLs.
- Inference responses are schema-validated by the api before use; the mock adapter, the inference stubs,
  and `contracts/inference.v1.example.json` must stay in sync (a contract test enforces this). Every call
  to inference carries `x-inference-key`; inference never gets Supabase keys.
- Applied migrations in `supabase/migrations/` are never edited; schema changes go in a new numbered file.

## Commands

```bash
# api (from api/). npm run dev loads api/.env (copy from .env.example); the server exits 1
# with a list of invalid variables if env validation fails.
npm ci
npm run dev                          # node --watch on PORT (default 3000); upload page at /test.html
npm test                             # vitest run (all tests)
npx vitest run test/env.test.js      # one file
npx vitest run -t "reports ok"       # tests matching a name
npm run lint
npm run format                       # Prettier write; CI runs format:check
npm run gate:calibrate -- <folder>   # Tier A metric distributions + pass rates (reads api/.env)

# PlantVision tests (from plantvision/; see plantvision/CLAUDE.md for setup)
.venv/Scripts/python -m pytest
```

CI (`.github/workflows/ci.yml`) runs the api's lint, format check, and tests on Node 24 and PlantVision's
pytest on Python 3.12, on pushes to `Backend`/`main` and PRs to `main`.

## api structure

`src/server.js` loads env, builds the logger, the Supabase client (`src/db/`, one query module per table),
and the storage service, and calls `createApp({ env, logger, db, storage })` from `src/app.js`. Everything
the app needs is injected through `createApp`, so tests build the app with `testEnv()`, a silent logger,
and the in-memory `fakeDb()` / `fakeStorage()` from `test/helpers.js`, and never touch Supabase or the
network. `fakeDb()` serves the v1 seed `decision_config` (`SEED_CONFIG`) unless given another. Test images
are generated in memory by `test/images.js`: `makeImage()` is a tiny solid image that fails the quality
gate, `makePhoto()` a leaf scene that passes it. Keep new routes and services injectable the same way.

`POST /api/v1/scans` runs `middleware/upload.js` (one JPEG/PNG, typed by magic bytes), then
`services/pipeline.js`: `intake.js` → `qualityGate.js` (Tier A, thresholds from `configService.js`) →
`storage.js` → rows. A photo that fails the gate is still stored, on a `rejected` scan, and the request
returns 422 `IMAGE_REJECTED` with that `scan_id`. Phase 3 adds inference and `decision.js` to the same
pipeline.
