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
the inference service are stubs that return contract-valid data (`inference/cv/`, `inference/ml/`, selected
by `CV_MODEL` / `ML_MODEL`). Don't implement computer-vision or ML logic.

`plantvision/` is the ML team's existing CV pipeline prototype (self-contained Python package with its own
`CLAUDE.md`, README, and tests). Don't modify it beyond keeping it working inside the monorepo.

## Git workflow

All work happens on the `Backend` branch of the fork (`erne2003/DrHorticulture-Ver6`). The repo owner
integrates `Backend` into the fork's `main`, tests, and then merges into the team repo; Railway deploys from
`main`. Never commit to `main`, push, or open PRs against `main` or the team repo unless asked.

## Layout

Monorepo, one folder per Railway service (see the spec's Repository structure for the full tree; folders
that don't exist yet are created by their Action plan tasks):

- `api/` — Node 24 + Express 5 (ES modules, JavaScript). Public; owns every rule and every write.
- `inference/` — Python 3.12 + Flask + gunicorn. Private; turns an image URL into numbers, never writes data.
- `contracts/` — `inference.v1.schema.json` + `inference.v1.example.json`, the single source of truth for
  the api ↔ inference boundary. v1 is never changed in place; breaking changes become v2.
- `supabase/migrations/` — Postgres schema (Supabase CLI).
- `plantvision/` — ML team's CV prototype (see above).

## Cross-cutting invariants

These span multiple files and are easy to break:

- Product thresholds (NDVI, confidence, mask, Tier A quality gate) come from the active `decision_config`
  row, never from code or env vars.
- `abstained` (model not confident) and `failed` (system error) scan statuses must never be conflated —
  abstention rate is an evaluation metric.
- All api errors go through `AppError` and the shared error shape; route handlers stay thin, logic lives
  in `api/src/services/`. Pipeline log lines carry `request_id` and `scan_id`.
- The stored image is the untouched original; GPS EXIF is never stored; the bucket is private and clients
  only get signed URLs.
- Inference responses are schema-validated by the api before use; the mock adapter, the inference stubs,
  and `contracts/inference.v1.example.json` must stay in sync (a contract test enforces this).

## Commands

```bash
# PlantVision tests (from plantvision/; see plantvision/CLAUDE.md for setup)
cd plantvision && .venv/Scripts/python -m pytest
```
