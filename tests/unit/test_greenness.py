import numpy as np
import pytest

from plantvision.features.greenness import (
    channel_ratio,
    excess_green,
    green_ratio,
)


def test_excess_green_scalar():
    assert excess_green(40, 180, 60) == pytest.approx(260.0)


def test_green_ratio_scalar():
    assert green_ratio(40, 180, 60) == pytest.approx(180 / 280)


def test_channel_ratios_scalar():
    assert channel_ratio(40, 180) == pytest.approx(40 / 180)
    assert channel_ratio(180, 0) == pytest.approx(0.0)


def test_array_versions_match_scalar_formula():
    r = np.array([40, 10, 100], dtype=float)
    g = np.array([180, 20, 200], dtype=float)
    b = np.array([60, 30, 50], dtype=float)
    expected_denom = r + g + b
    expected_green = np.divide(g, expected_denom, out=np.zeros_like(expected_denom), where=expected_denom > 0)
    assert green_ratio(r, g, b) == pytest.approx(float(np.mean(expected_green)))
    assert excess_green(r, g, b) == pytest.approx(float(np.mean(2 * g - r - b)))