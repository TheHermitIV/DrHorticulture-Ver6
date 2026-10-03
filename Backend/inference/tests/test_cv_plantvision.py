"""CV_ENGINE=plantvision with PlantVision's real code but fake models, so no torch is needed.

Needs PlantVision installed (pip install -e ../plantvision). Real models: test_cv_real.py.
"""

import importlib

import numpy as np
import pytest

plantvision = pytest.importorskip("plantvision")

from plantvision import SegmentationError  # noqa: E402
from plantvision.segmentation.model import SegmentationResult  # noqa: E402
from plantvision.segmentation.predictor import SegmentationPredictor  # noqa: E402

from tests.conftest import API_KEY, analyze_body, png_bytes  # noqa: E402

CV_MODULES = ("cv.engine", "cv.detector", "cv.embedder", "cv.features", "cv")


class FakeSegmenter:
    plant = True
    seen = None

    def segment(self, image):
        self.seen = image.array
        if not self.plant:
            raise SegmentationError("no usable leaf pixels")
        mask = np.zeros(image.array.shape[:2], dtype=bool)
        mask[: mask.shape[0] // 2, :] = True
        return SegmentationResult(combined_mask=mask, confidences=[0.6, 0.8])


class FakeSpeciesModel:
    def __init__(self, model_id, device=None, top_k=5):
        self.model_id = model_id
        self.top_k = top_k
        self.id2label = {0: "rose", 1: "fern", 2: "geranium"}
        self.seen = None

    def predict(self, image):
        self.seen = image
        ranked = [("geranium", 0.7), ("rose", 0.2), ("fern", 0.1)]
        return ranked[: self.top_k]


def reload_cv():
    for name in CV_MODULES:
        importlib.reload(importlib.import_module(name))


@pytest.fixture
def segmenter():
    return FakeSegmenter()


@pytest.fixture
def pv_cv(monkeypatch, segmenter):
    """The cv package reloaded with CV_ENGINE=plantvision and fake models."""
    import plantvision.species.model as species_model

    monkeypatch.setenv("CV_ENGINE", "plantvision")
    monkeypatch.setattr(SegmentationPredictor, "from_config", classmethod(lambda cls, c: segmenter))
    monkeypatch.setattr(species_model, "HuggingFaceSpeciesModel", FakeSpeciesModel)
    reload_cv()
    yield importlib.import_module("cv")
    monkeypatch.undo()
    reload_cv()


def leafy_image():
    image = np.zeros((40, 30, 3), dtype=np.uint8)
    image[..., 1] = 160
    return image


def test_a_plant_maps_plantvision_output_onto_the_seam(pv_cv):
    out = pv_cv.analyze(leafy_image())
    assert out["plant_detected"] is True
    assert out["mask_confidence"] == 0.8
    assert out["leaf_fraction"] == 0.5
    assert out["mask"].shape == (40, 30)
    assert out["features"]["exg"] == 320.0
    assert out["features"]["leaf_coverage"] == 0.5
    assert out["embedding"].dtype == np.float32


def test_species_probs_are_the_full_distribution_in_label_order(pv_cv):
    from cv import embedder

    out = pv_cv.analyze(leafy_image())
    assert embedder.SPECIES_LABELS == ("rose", "fern", "geranium")
    assert embedder.CLASSIFIER.top_k == 3
    np.testing.assert_allclose(out["species_probs"], [0.2, 0.1, 0.7])
    # The classifier sees the crop around the mask (the top half).
    assert embedder.CLASSIFIER.seen.shape == (20, 30, 3)


def test_the_segmenter_gets_bgr_as_ultralytics_expects(pv_cv, segmenter):
    image = leafy_image()
    image[..., 0] = 200  # red
    pv_cv.analyze(image)
    assert segmenter.seen[0, 0].tolist() == [0, 160, 200]


def test_no_plant_is_a_full_answer(pv_cv, segmenter):
    segmenter.plant = False
    out = pv_cv.analyze(leafy_image())
    assert out["plant_detected"] is False
    assert out["mask_confidence"] == 0.0
    assert out["leaf_fraction"] == 0.0
    assert out["features"] == {}
    assert out["species_probs"].shape == (3,)


def test_the_app_reports_plantvision_species(pv_cv):
    from app import create_app

    client = create_app(api_key=API_KEY, fetch_image=lambda url: png_bytes()).test_client()
    res = client.post("/v1/analyze", json=analyze_body(), headers={"x-inference-key": API_KEY})
    assert res.status_code == 200
    body = res.get_json()
    assert body["species"] == {"top_label": "geranium", "top_prob": 0.7}
    assert body["segmentation"] == {
        "plant_detected": True,
        "mask_confidence": 0.8,
        "leaf_fraction": 0.5,
    }
    assert "leaf_coverage" in body["features"]


def test_an_unknown_engine_fails_at_import(monkeypatch):
    monkeypatch.setenv("CV_ENGINE", "yolo")
    with pytest.raises(RuntimeError, match="CV_ENGINE"):
        importlib.reload(importlib.import_module("cv.engine"))
    monkeypatch.undo()
    reload_cv()
