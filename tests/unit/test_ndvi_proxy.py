import numpy as np
import pytest

from plantvision import ModelError
from plantvision.features.extractor import FeatureExtractor
from plantvision.ndvi.metrics import evaluate, mae, pearson, r2, rmse
from plantvision.ndvi.proxy import NDVIProxy

GREEN_VALUE = [40, 180, 60]


def make_features():
    image = np.zeros((20, 20, 3), dtype=np.uint8)
    image[:, :] = GREEN_VALUE
    mask = np.ones((20, 20), dtype=bool)
    return FeatureExtractor().extract(image, mask)


def test_exg_proxy_matches_feature():
    features = make_features()
    assert NDVIProxy(method="exg").predict(features) == pytest.approx(features.to_dict()["exg"])


def test_green_ratio_proxy_matches_feature():
    features = make_features()
    proxy = NDVIProxy(method="green_ratio")
    assert proxy.predict(features) == pytest.approx(features.to_dict()["green_ratio"])


def test_unknown_proxy_method_raises():
    proxy = NDVIProxy(method="nope")
    with pytest.raises(ModelError, match="Unknown NDVI proxy"):
        proxy.predict(make_features())


def test_predictor_proxy_mode(stub_config):
    from plantvision.ndvi.predictor import NDVIPredictor

    predictor = NDVIPredictor.from_config(stub_config)
    prediction = predictor.predict(make_features())
    assert prediction.type == "rgb_proxy"
    assert prediction.value > 0
    assert prediction.as_dict()["type"] == "rgb_proxy"


def test_proxy_value_sane():
    r, g, b = GREEN_VALUE
    proxy = NDVIProxy(method="exg")
    prediction = proxy.predict(make_features())
    assert prediction == pytest.approx(2 * g - r - b)


def test_metrics():
    actual = [0.65, 0.72, 0.41]
    predicted = [0.63, 0.70, 0.45]
    results = evaluate(actual, predicted)
    assert results["mae"] == pytest.approx(0.08 / 3)
    assert results["rmse"] == pytest.approx((0.0008) ** 0.5)
    assert -1.0 <= results["r2"] <= 1.0
    assert 0.0 <= results["pearson"] <= 1.0
    assert results["n"] == 3


def test_metrics_degenerate_inputs():
    assert mae([5, 5, 5], [5, 5, 5]) == 0.0
    assert rmse([5, 5, 5], [5, 5, 5]) == 0.0
    assert r2([5, 5, 5], [3, 4, 5]) == 0.0
    assert pearson([5, 5, 5], [3, 4, 5]) == 0.0