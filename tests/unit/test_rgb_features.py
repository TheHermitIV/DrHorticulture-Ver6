import numpy as np
import pytest

from plantvision.features.rgb import extract_channel_statistics


def test_channel_statistics():
    image = np.zeros((4, 4, 3), dtype=np.uint8)
    image[0, 0] = [30, 60, 90]
    image[1, 1] = [10, 20, 30]
    mask = np.zeros((4, 4), dtype=bool)
    mask[0, 0] = True
    mask[1, 1] = True
    stats = extract_channel_statistics(image, mask)
    assert stats["mean_r"] == pytest.approx(20.0)
    assert stats["mean_g"] == pytest.approx(40.0)
    assert stats["mean_b"] == pytest.approx(60.0)
    assert stats["median_r"] == pytest.approx(20.0)
    assert stats["median_g"] == pytest.approx(40.0)
    assert stats["median_b"] == pytest.approx(60.0)


def test_channel_statistics_empty_mask_returns_zeros():
    image = np.zeros((4, 4, 3), dtype=np.uint8)
    mask = np.zeros((4, 4), dtype=bool)
    stats = extract_channel_statistics(image, mask)
    assert stats["mean_r"] == 0.0
    assert stats["mean_g"] == 0.0
    assert stats["mean_b"] == 0.0


def test_extractor_rejects_empty_mask():
    from plantvision import FeatureError
    from plantvision.features.extractor import FeatureExtractor

    mask = np.zeros((4, 4), dtype=bool)
    image = np.zeros((4, 4, 3), dtype=np.uint8)
    with pytest.raises(FeatureError, match="no leaf pixels"):
        FeatureExtractor().extract(image, mask)


def test_extractor_feature_order_matches_config():
    from plantvision.features.extractor import FeatureExtractor, FEATURE_KEYS

    image = np.zeros((4, 4, 3), dtype=np.uint8)
    image[:, :] = [40, 180, 60]
    mask = np.ones((4, 4), dtype=bool)
    features = FeatureExtractor().extract(image, mask)
    assert features.feature_names == FEATURE_KEYS
    assert len(features.to_vector()) == len(FEATURE_KEYS)