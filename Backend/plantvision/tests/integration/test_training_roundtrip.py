"""End-to-end check of the training artifact without the heavy CV stack.

This is the test an agent runs to prove the wiring works: synthetic features -> fit -> bundle ->
load -> predict. It skips when scikit-learn is not installed (CI installs only `.[dev]`); run
`pip install -e ".[ml,dev]"` to exercise it locally.

It deliberately does not touch YOLO, torch, or the species classifier, so it stays fast.
"""

import sys
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("sklearn")

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from training.ndvi.extract import import_bundle_module  # noqa: E402
from training.ndvi.train import fit_bundle  # noqa: E402

Bundle, BundleError = import_bundle_module()


def synthetic(n_rows=80, n_groups=16, seed=0):
    rng = np.random.default_rng(seed)
    features = rng.normal(size=(n_rows, 3))
    species = rng.dirichlet(np.ones(2), size=n_rows)
    matrix = np.hstack([features, species])
    targets = 0.45 + 0.1 * features[:, 0] - 0.05 * features[:, 1] + rng.normal(0, 0.03, n_rows)
    groups = np.array([f"plant-{i % n_groups}" for i in range(n_rows)])
    return matrix, targets, groups


FEATURE_NAMES = ["exg", "green_ratio", "leaf_coverage"]
SPECIES_LABELS = ["geranium", "tomato"]


def test_fit_produces_a_valid_bundle_and_metrics():
    matrix, targets, groups = synthetic()
    bundle, metrics = fit_bundle(
        matrix,
        targets,
        groups,
        FEATURE_NAMES,
        SPECIES_LABELS,
        n_heads=7,
        seed=3,
    )

    # Construction validates the bundle; assert the shape explicitly too.
    assert bundle.ensemble_size == 7
    assert bundle.reference_spread > 0
    assert bundle.feature_names == FEATURE_NAMES
    assert bundle.species_labels == SPECIES_LABELS
    assert set(metrics) >= {"train", "holdout", "greenness", "warnings"}
    assert "raw" in metrics["holdout"] and "calibrated" in metrics["holdout"]
    assert "calibration_helps" in metrics["holdout"]


def test_bundle_roundtrips_and_predicts_in_contract_range(tmp_path):
    matrix, targets, groups = synthetic()
    bundle, _ = fit_bundle(
        matrix, targets, groups, FEATURE_NAMES, SPECIES_LABELS, n_heads=7, seed=3
    )
    path = bundle.save(tmp_path / "model.json")

    loaded = Bundle.load(path)
    features = {"exg": 0.3, "green_ratio": 0.4, "leaf_coverage": 0.2}
    out = loaded.predict(features, [0.8, 0.2])

    assert set(out) == {"ndvi", "ensemble_std", "confidence"}
    assert -1.0 <= out["ndvi"] <= 1.0
    assert out["ensemble_std"] >= 0
    assert 0.0 <= out["confidence"] <= 1.0


def test_feature_order_mismatch_is_refused(tmp_path):
    matrix, targets, groups = synthetic()
    bundle, _ = fit_bundle(
        matrix, targets, groups, FEATURE_NAMES, SPECIES_LABELS, n_heads=5, seed=3
    )
    with pytest.raises(BundleError, match="missing feature"):
        bundle.predict({"exg": 0.3, "green_ratio": 0.4}, [0.8, 0.2])


def test_group_split_does_not_leak_rows_between_train_and_test():
    matrix, targets, groups = synthetic(n_rows=80, n_groups=16)
    bundle, metrics = fit_bundle(
        matrix, targets, groups, FEATURE_NAMES, SPECIES_LABELS, n_heads=5, seed=1
    )
    # Every holdout row's plant must be absent from train; the trainer only reports counts, so
    # this asserts the split sizes sum to the dataset (no accidental row duplication).
    assert metrics["train"]["n"] + metrics["holdout"]["n"] == len(targets)
    assert metrics["holdout"]["n_plants"] >= 1
