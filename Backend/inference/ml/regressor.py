"""The ML stage: color features + species probabilities -> NDVI.

Two modes, chosen once at import:

- **stub** (default): `ML_WEIGHTS_PATH` is unset, so the hardcoded contract-example numbers are
  returned. This keeps tests and CI free of scikit-learn/torch and proves the response shape.
- **artifact**: `ML_WEIGHTS_PATH` points at a JSON bundle written by
  `plantvision/training/ndvi/pipeline.py`. Everything the heads need is in the bundle, so serving
  never imports the training code.

The seam is `estimate(features, species_probs) -> {ndvi, ensemble_std, confidence}`. NDVI and
confidence are enforced into the contract ranges by `ml.bundle.Bundle`. Out-of-range NDVI is
clamped (an abstention signal), never raised: raising would surface as a 4xx/5xx and the api
would record the scan as `failed`, which is tracked separately from `abstained`.

See `docs/ML_TRAINING_HANDOFF.md` for how to produce a bundle.
"""

import os

import numpy as np

from ml.bundle import Bundle

# The stub reproduces contracts/inference.v1.example.json exactly.
STUB_OUTPUT = {"ndvi": 0.62, "ensemble_std": 0.04, "confidence": 0.78}

# Loaded once, at import time, never per request. None means the stub.
WEIGHTS_PATH = os.environ.get("ML_WEIGHTS_PATH", "").strip()
BUNDLE = Bundle.load(WEIGHTS_PATH) if WEIGHTS_PATH else None

# Reported as estimate.ensemble_size. The stub keeps the example's 5; a real bundle carries its own.
ENSEMBLE_SIZE = BUNDLE.ensemble_size if BUNDLE is not None else 5

# Fail fast on a misconfigured deployment: a non-stub MODEL_VERSION with no weights would
# otherwise serve stub numbers while claiming to be a real model.
_MODEL_VERSION = os.environ.get("MODEL_VERSION", "").strip()
if BUNDLE is None and _MODEL_VERSION and not _MODEL_VERSION.startswith("stub"):
    raise RuntimeError(
        f"MODEL_VERSION={_MODEL_VERSION!r} but ML_WEIGHTS_PATH is unset. Set ML_WEIGHTS_PATH to "
        "the JSON bundle written by training/ndvi/pipeline.py, or use MODEL_VERSION=stub-0.1."
    )


def estimate(features: dict, species_probs: np.ndarray) -> dict:
    """Estimate NDVI from the CV color features plus the species probability distribution.

    Returns ndvi (mean of the ensemble heads, -1 to 1), ensemble_std (>= 0), and confidence
    (0-1, derived from the spread). Raises BundleError if the input does not match the bundle
    (missing feature, wrong species count); that is a deployment/config error, not an unusual
    image.
    """
    if BUNDLE is None:
        return dict(STUB_OUTPUT)
    return BUNDLE.predict(features, species_probs)
