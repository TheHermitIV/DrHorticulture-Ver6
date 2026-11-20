"""Regressions for exported confidence arithmetic and the bundled inference path."""
import io

import numpy as np
import pytest
from PIL import Image

pytest.importorskip("cv2")
pytest.importorskip("plantvision")
from plantvision.segmentation.confidence import mask_quality_features, ndvi_uncertainty


def test_empty_and_saturated_masks_have_finite_quality_features():
    for scores in (np.full((8, 9), -1000.), np.full((8, 9), 1000.)):
        features = mask_quality_features(scores)
        assert len(features) == 8
        assert np.isfinite(features).all()


def test_ndvi_range_and_support_use_the_artifacts_calibration_residuals():
    model = dict(feature_count=1, mean=[0], scale=[1], coefficients=[0],
                 intercept=float(np.log(.1)), scale_min=.02, scale_max=.3,
                 calibration_ratios=[.5, 1., 2.], tolerance=.1, quantile=2.)
    radius, support = ndvi_uncertainty([123], model)
    assert radius == pytest.approx(.2)
    assert support == pytest.approx(3/5)


def test_bundled_model_serves_model_specific_calibration(monkeypatch):
    import app as app_module
    from tests.conftest import API_KEY, analyze_body

    monkeypatch.setattr(app_module, "LEAF_SEGMENTER_ENABLED", True)
    monkeypatch.delenv("LEAF_SEGMENTER_MODEL_PATH", raising=False)
    pixels = np.full((120, 160, 3), 110, dtype=np.uint8)
    pixels[25:85, 50:110] = [45, 140, 35]
    photo = io.BytesIO()
    Image.fromarray(pixels).save(photo, format="PNG")
    client = app_module.create_app(api_key=API_KEY, fetch_image=lambda _: photo.getvalue()).test_client()
    assert client.get("/health").json["model_version"] == "LeafSegmenter v1.2.0"
    response = client.post("/v1/analyze", json=analyze_body(), headers={"x-inference-key": API_KEY})
    assert response.status_code == 200
    body = response.json
    assert body["segmentation"]["plant_detected"]
    assert body["segmentation"]["mask_png"]
    assert 0 < body["segmentation"]["mask_confidence"] < 1
    assert 0 < body["estimate"]["confidence"] < 1
    assert body["calibration"]["method"] == "provisional-v2"
    assert body["calibration"]["mask_samples"] == 45
    assert body["calibration"]["ndvi_samples"] == 17
    assert body["calibration"]["ndvi_radius"] > 0
