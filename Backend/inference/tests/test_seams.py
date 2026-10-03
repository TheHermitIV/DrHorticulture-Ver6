import numpy as np

import cv
import ml
from cv.embedder import EMBEDDING_SIZE, SPECIES_LABELS
from ml.regressor import ENSEMBLE_SIZE

IMAGE = np.zeros((48, 64, 3), dtype=np.uint8)


def test_analyze_returns_every_seam_key():
    out = cv.analyze(IMAGE)
    assert set(out) == {
        "mask",
        "mask_confidence",
        "leaf_fraction",
        "plant_detected",
        "angle_ok",
        "embedding",
        "species_probs",
        "features",
    }
    assert out["mask"].shape == (48, 64)
    assert out["mask"].dtype == bool
    assert isinstance(out["plant_detected"], bool)
    assert isinstance(out["angle_ok"], bool)
    assert 0 <= out["mask_confidence"] <= 1
    assert 0 <= out["leaf_fraction"] <= 1
    assert all(isinstance(v, float) for v in out["features"].values())


def test_analyze_embedding_and_species_probs_match_their_declared_sizes():
    out = cv.analyze(IMAGE)
    assert out["embedding"].dtype == np.float32
    assert out["embedding"].shape == (EMBEDDING_SIZE,)
    assert out["species_probs"].dtype == np.float32
    assert out["species_probs"].shape == (len(SPECIES_LABELS),)
    assert np.isclose(out["species_probs"].sum(), 1)


def test_predict_returns_every_seam_key():
    cv_out = cv.analyze(IMAGE)
    out = ml.predict(cv_out["embedding"], cv_out["species_probs"])
    assert set(out) == {"ndvi", "ensemble_std", "confidence"}
    assert -1 <= out["ndvi"] <= 1
    assert out["ensemble_std"] >= 0
    assert 0 <= out["confidence"] <= 1
    assert ENSEMBLE_SIZE >= 1
