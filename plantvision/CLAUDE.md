# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in the `plantvision/`
folder of this repository. All paths and commands below are relative to `plantvision/`.

## What this is

PlantVision is the team's CV pipeline prototype (a candidate implementation for the `inference` service's
CV stage; see `../docs/BACKEND_SPEC.md`). It is owned by the ML side of the team — backend work should not
modify it except to keep it working inside the monorepo.

PlantVision: takes an RGB photo of a potted plant, segments the leaf region, computes RGB/greenness
features, and predicts the plant species. It emits a `greenness` score (proxy metric, `2G - R - B`)
rather than true NDVI — an `ndvi` block exists in the output but stays `"status": "unavailable"` until
a sensor-trained regression model is added. See `ARCHITECTURE.md` for the full design rationale and the
`greenness` vs `ndvi` distinction (this separation is intentional and must be preserved — do not relabel
the proxy as NDVI).

## Commands

```bash
# Setup (first time), from plantvision/
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"      # light: enough to run the test suite
.venv/Scripts/python -m pip install -e ".[ml,dev]"   # full: ultralytics/torch/transformers/xgboost, needed for the CLI

# Run the CLI
plantvision path/to/plant.jpg
plantvision path/to/plant.jpg --debug                          # + coverage, metrics, saved files
plantvision path/to/plant.jpg --save-mask --save-overlay --json

# Tests
pytest                             # whole suite (see pyproject.toml: testpaths = tests, addopts = -q)
pytest tests/unit/test_greenness.py
pytest tests/unit/test_greenness.py::test_some_case -v
pytest tests/integration/test_pipeline.py
```

Tests stub the segmentation and species models, so they don't need the `ml` extras. There is no configured
lint/format/type-check tooling for PlantVision (no ruff/flake8/mypy config in `pyproject.toml`).

The first CLI run downloads the species classifier (~390 MB) from Hugging Face and caches it; later runs
are offline. The segmentation model (`models/segmentation/yolo11n-seg.pt`) ships with the repo.

## Architecture

### Pipeline flow

The CLI (`src/plantvision/cli/commands.py::run_pipeline`) wires together independently-testable stages,
each of which can be swapped via dependency injection (used heavily in `tests/integration/test_pipeline.py`
via stub segmentation/species models):

```
load_image → SegmentationPredictor.segment → SpeciesPredictor.classify → FeatureExtractor.extract
    → NDVIPredictor.predict → build_result → save_outputs
```

- **Segmentation** (`segmentation/`): `YoloSegmentationModel` wraps Ultralytics YOLO; only the
  configured `classes` (COCO class 58 = "potted plant" for the current pretrained checkpoint) are kept
  and merged into one boolean `combined_mask` via `mask.merge_masks`. `SegmentationPredictor` validates
  the mask shape against the image and enforces `min_leaf_pixels`, raising `SegmentationError` otherwise.
- **Species** (`species/`): `HuggingFaceSpeciesModel` classifies either the full image or (by default,
  `crop: mask`) the image cropped to the leaf mask bounding box. Disabled entirely if
  `species.enabled: false` or `species` section is absent from config — `SpeciesPredictor.from_config`
  then returns `None` and no `species` key appears in the output.
- **Features** (`features/`): `FeatureExtractor.extract` operates only on `image[mask]` leaf pixels and
  returns a `FeatureVector` (ordered dict + `to_vector()`/`to_dict()`). Which features are computed is
  controlled by `features.include` in `configs/default.yaml` — extending the feature set means adding a
  key here and a matching computation in `features/rgb.py` or `features/greenness.py`.
- **NDVI** (`ndvi/`): `NDVIPredictor.from_config` picks between `proxy` (always use `NDVIProxy`, an RGB
  greenness metric such as `exg`), `model` (require trained weights at `ndvi.model_path`, error if
  missing), and `auto` (use the model if the weights file exists, else fall back to proxy). Models come
  from `models/registry.py`'s small registry (`xgboost` → `XGBoostNDVIModel`); implement `NDVIModel`
  (`models/interfaces.py`) to add a new regression backend and register it there.
- **Output** (`cli/output.py`): `build_result` assembles the final JSON dict. Critically, a `proxy`-type
  prediction is written under the `greenness` key, while a `model`-type prediction is written under
  `ndvi`. `ndvi` and `fertilization` blocks default to `{"status": "unavailable", ...}` when not produced
  — this contract (documented in `ARCHITECTURE.md` §27) must stay intact for downstream consumers.

### Configuration

`config/loader.py::load_config` reads `configs/default.yaml` then deep-merges `segmentation.yaml`,
`ndvi.yaml`, and `species.yaml` over their respective top-level sections (each optional; missing files
are skipped). CLI flags (`--seg-model`, `--ndvi-model`, `--ndvi-mode`) apply as a final override layer.
Access values via `config.section("name").get("key", default)`, and resolve any path value through
`config.resolve(...)` (relative to the config directory) rather than joining paths manually — see
`Config.resolve` / `utils/paths.py`.

### Error handling

All domain errors subclass `PlantVisionError` (`src/plantvision/__init__.py`): `ConfigError`,
`ImageError`, `SegmentationError`, `FeatureError`, `ModelError`, `SpeciesError`. `cli/commands.py::main`
catches `PlantVisionError` for a clean `error: ...` message (exit 2) and anything else as an unexpected
error (exit 1) — raise the specific subclass rather than a bare exception when adding validation.

### Training scripts (`training/`)

`training/segmentation/` and `training/ndvi/` hold placeholder scripts for fine-tuning the YOLO
segmentation model and training the eventual sensor-supervised NDVI regression model. These are not
wired into the CLI pipeline and are for future use once real sensor data / leaf annotations exist —
treat them as a separate concern from `src/plantvision/`.
