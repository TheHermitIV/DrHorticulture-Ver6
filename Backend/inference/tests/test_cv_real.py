"""PlantVision's real models end to end. Slow and needs requirements-cv.txt plus the downloaded
species model, so it only runs with CV_REAL_TESTS=1 (not in CI):

    CV_REAL_TESTS=1 CV_ENGINE=plantvision .venv/bin/python -m pytest tests/test_cv_real.py
"""

import os

import numpy as np
import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("CV_REAL_TESTS") != "1" or os.environ.get("CV_ENGINE") != "plantvision",
    reason="set CV_REAL_TESTS=1 and CV_ENGINE=plantvision to run the real models",
)


def test_real_models_fill_every_seam_key():
    import cv
    from cv import embedder

    out = cv.analyze(np.full((480, 640, 3), (60, 150, 70), dtype=np.uint8))
    assert isinstance(out["plant_detected"], bool)
    assert 0 <= out["mask_confidence"] <= 1
    assert 0 <= out["leaf_fraction"] <= 1
    assert out["species_probs"].shape == (len(embedder.SPECIES_LABELS),)
    assert np.isclose(out["species_probs"].sum(), 1, atol=1e-3)
