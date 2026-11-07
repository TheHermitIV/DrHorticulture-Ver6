"""Tests for the shared ML bundle artifact.

These run with numpy only (no scikit-learn), so CI covers the format and prediction contract even
though the trainer's heavy dependencies are not installed there.
"""

import json

import pytest

from ml.bundle import Bundle, BundleError, spread_to_confidence


def make_bundle(**overrides):
    base = dict(
        model_version="ridge-feat-0.1",
        feature_names=["exg", "green_ratio"],
        species_labels=["geranium", "tomato"],
        heads=[
            {"coef": [0.2, -0.1, 0.05, 0.0], "intercept": 0.1},
            {"coef": [0.2, -0.1, 0.05, 0.0], "intercept": 0.3},
        ],
        reference_spread=0.1,
        saturate_at=2.0,
        greenness={"key": "exg", "normalizer": 1.0, "alpha": 0.2, "beta": 0.0, "clip": [-1, 1]},
    )
    base.update(overrides)
    return Bundle(**base)


FEATURES = {"green_ratio": 0.4, "exg": 0.5}
SPECIES = [1.0, 0.0]


def test_predict_returns_the_expected_ndvi_spread_and_confidence():
    out = make_bundle().predict(FEATURES, SPECIES)
    # dot = 0.2*0.5 - 0.1*0.4 + 0.05*1.0 = 0.11; heads 0.21 and 0.41 -> mean 0.31, std 0.1
    assert out["ensemble_std"] == pytest.approx(0.1)
    assert out["ndvi"] == pytest.approx(0.31 + 0.2 * 0.5)  # greenness adjustment
    assert out["confidence"] == pytest.approx(0.5)


def test_features_are_ordered_by_name_not_dict_order():
    bundle = make_bundle()
    assert bundle.predict(FEATURES, SPECIES) == bundle.predict(
        {"exg": 0.5, "green_ratio": 0.4}, SPECIES
    )


def test_missing_feature_is_refused_not_imputed():
    with pytest.raises(BundleError, match="missing feature"):
        make_bundle().predict({"exg": 0.5}, SPECIES)


def test_wrong_species_count_is_refused():
    with pytest.raises(BundleError, match="species_probs has 1 values"):
        make_bundle().predict(FEATURES, [1.0])


def test_calibration_clips_to_the_contract_range():
    bundle = make_bundle(
        heads=[{"coef": [0.0, 0.0, 0.0, 0.0], "intercept": 0.9}],
        greenness={"key": "exg", "normalizer": 1.0, "alpha": 100.0, "beta": 0.0, "clip": [-1, 1]},
    )
    assert bundle.predict(FEATURES, SPECIES)["ndvi"] == 1.0


def test_ensemble_size_and_vector_width():
    bundle = make_bundle()
    assert bundle.ensemble_size == 2
    assert bundle.vector_width == 4


def test_save_and_load_roundtrip(tmp_path):
    bundle = make_bundle()
    path = bundle.save(tmp_path / "model.json")
    loaded = Bundle.load(path)
    assert loaded.to_dict() == bundle.to_dict()
    assert loaded.predict(FEATURES, SPECIES) == bundle.predict(FEATURES, SPECIES)


def test_load_rejects_a_missing_file(tmp_path):
    with pytest.raises(BundleError, match="not found"):
        Bundle.load(tmp_path / "nope.json")


def test_load_rejects_invalid_json(tmp_path):
    path = tmp_path / "model.json"
    path.write_text("{not json")
    with pytest.raises(BundleError, match="not valid JSON"):
        Bundle.load(path)


def test_head_width_mismatch_is_refused():
    with pytest.raises(BundleError, match="coefficients"):
        make_bundle(heads=[{"coef": [0.1, 0.2], "intercept": 0.0}])


def test_zero_reference_spread_is_refused():
    with pytest.raises(BundleError, match="reference_spread"):
        make_bundle(reference_spread=0.0)


def test_greenness_key_must_be_a_feature():
    with pytest.raises(BundleError, match="greenness.key"):
        make_bundle(
            greenness={"key": "ndvi", "alpha": 0.1, "beta": 0.0, "clip": [-1, 1]}
        )


def test_declared_ensemble_size_must_match_heads():
    data = make_bundle().to_dict()
    data["ensemble_size"] = 9
    with pytest.raises(BundleError, match="ensemble_size"):
        Bundle.from_dict(data)


def test_bundle_json_is_plain_json(tmp_path):
    path = make_bundle().save(tmp_path / "model.json")
    json.loads(path.read_text())  # must not raise


# --- confidence mapping ------------------------------------------------------


def test_spread_to_confidence_at_reference_is_one_over_saturate():
    assert spread_to_confidence(0.05, 0.05, 2.0) == pytest.approx(0.5)


def test_spread_to_confidence_is_monotonic_decreasing():
    values = [spread_to_confidence(s, 0.05, 2.0) for s in (0.0, 0.02, 0.05, 0.1, 0.2)]
    assert values == sorted(values, reverse=True)


def test_spread_to_confidence_zero_spread_is_certain():
    assert spread_to_confidence(0.0, 0.05) == 1.0


def test_spread_to_confidence_rejects_zero_reference():
    with pytest.raises(BundleError, match="reference_spread"):
        spread_to_confidence(0.01, 0.0)


def test_spread_to_confidence_rejects_nan():
    with pytest.raises(BundleError, match="finite"):
        spread_to_confidence(float("nan"), 0.05)
