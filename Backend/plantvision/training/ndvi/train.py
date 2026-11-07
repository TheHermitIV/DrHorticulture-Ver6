"""Fit the NDVI ensemble and write the inference bundle.

Model shape (chosen for hundreds of labeled images, not thousands):

- Input: the ordered CV color features + the species probability distribution.
- Standardize the input (saved in the bundle).
- Fit an ensemble of bootstrap ridge heads. The mean is the NDVI estimate; the spread is the
  uncertainty signal the api turns into `confidence`.
- Fit an optional greenness adjustment on *held-out* residuals:
      ndvi_final = clip(ndvi_raw + alpha * greenness + beta, -1, 1)
  and report held-out MAE/RMSE with and without it. Ship the adjustment only if it earns it.

Group splitting by `plant_id` is mandatory: the same plant must never appear in both train and
test, or the metrics are optimistic and the abstain thresholds are meaningless.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from training.ndvi.extract import import_bundle_module, read_features_csv
from training.ndvi.metrics import evaluate


class TrainingError(RuntimeError):
    """The training data or settings cannot produce a usable model."""


def _bundle_cls():
    Bundle, _ = import_bundle_module()
    return Bundle


def _fit_heads(scaled, targets, n_heads, alpha, seed):
    from sklearn.linear_model import Ridge  # deferred: plantvision[ml] only

    if n_heads < 2:
        raise TrainingError(
            "n_heads must be >= 2: a one-head ensemble has no spread, so confidence and the "
            "api's abstain gate would be inert."
        )
    rng = np.random.default_rng(seed)
    heads = []
    for _ in range(n_heads):
        indices = rng.integers(0, len(targets), size=len(targets))
        heads.append(Ridge(alpha=alpha, random_state=seed).fit(scaled[indices], targets[indices]))
    return heads


def _head_predictions(heads, scaled):
    return np.column_stack([head.predict(scaled) for head in heads])


def _ensemble_mean(heads, scaled):
    return _head_predictions(heads, scaled).mean(axis=1)


def _group_split(indices, groups, test_size, seed):
    from sklearn.model_selection import GroupShuffleSplit  # deferred

    subset = groups[indices]
    if len(np.unique(subset)) < 2:
        raise TrainingError(
            f"Cannot split {len(indices)} rows into train/test: only "
            f"{len(np.unique(subset))} distinct plant_id group(s). Add rows from more plants."
        )
    splitter = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=seed)
    train_rel, test_rel = next(splitter.split(indices, groups=subset))
    if len(train_rel) == 0 or len(test_rel) == 0:
        raise TrainingError(
            f"The grouped split produced {len(train_rel)} train / {len(test_rel)} test rows. "
            "Adjust --test-size or add more groups."
        )
    return indices[train_rel], indices[test_rel]


def _lstsq_intercept(x, y):
    design = np.column_stack([np.asarray(x, dtype=float), np.ones_like(np.asarray(x, dtype=float))])
    (slope, intercept), *_ = np.linalg.lstsq(design, np.asarray(y, dtype=float), rcond=None)
    return float(slope), float(intercept)


def fit_bundle(
    features_matrix,
    targets,
    groups,
    feature_names,
    species_labels,
    *,
    n_heads=9,
    alpha=1.0,
    seed=7,
    test_size=0.2,
    calib_fraction=0.25,
    greenness_key="exg",
    greenness_normalizer=255.0,
    saturate_at=2.0,
    model_version="ridge-feat-0.1",
):
    """Fit the ensemble + greenness calibration and return (Bundle, metrics)."""
    features_matrix = np.asarray(features_matrix, dtype=float)
    targets = np.asarray(targets, dtype=float)
    groups = np.asarray(groups)
    feature_names = list(feature_names)
    species_labels = list(species_labels)

    if features_matrix.ndim != 2:
        raise TrainingError(f"Feature matrix must be 2-D, got shape {features_matrix.shape}.")
    expected_width = len(feature_names) + len(species_labels)
    if features_matrix.shape[1] != expected_width:
        raise TrainingError(
            f"Feature matrix has {features_matrix.shape[1]} columns but "
            f"{len(feature_names)} features + {len(species_labels)} species = {expected_width} "
            "were named. Append the species columns before fitting."
        )
    if len(targets) != features_matrix.shape[0] or len(groups) != features_matrix.shape[0]:
        raise TrainingError(
            f"Row mismatch: {features_matrix.shape[0]} rows, {len(targets)} targets, "
            f"{len(groups)} groups."
        )
    if not np.all(np.isfinite(features_matrix)):
        raise TrainingError("Feature matrix contains NaN or inf; fix the extraction first.")

    warnings = []
    all_indices = np.arange(len(targets))
    train_idx, valid_idx = _group_split(all_indices, groups, test_size, seed)

    mean = features_matrix[train_idx].mean(axis=0)
    std = features_matrix[train_idx].std(axis=0)
    std[std == 0.0] = 1.0
    scaled = (features_matrix - mean) / std

    if greenness_key in feature_names:
        greenness_index = feature_names.index(greenness_key)
    else:
        greenness_index = None

    # Calibration is fitted on a held-out slice of train, never on the final evaluation rows.
    greenness = None
    if greenness_index is None:
        warnings.append(
            f"greenness feature {greenness_key!r} not in the CV features; skipping the "
            "post-model adjustment."
        )
    elif len(np.unique(groups[train_idx])) < 2:
        warnings.append(
            "fewer than 2 plant groups in the training split; skipping the greenness adjustment "
            "because it cannot be fitted without leaking."
        )
    else:
        fit_idx, cal_idx = _group_split(train_idx, groups, calib_fraction, seed + 1)
        provisional = _fit_heads(scaled[fit_idx], targets[fit_idx], n_heads, alpha, seed + 2)
        predicted = _ensemble_mean(provisional, scaled[cal_idx])
        green = features_matrix[cal_idx, greenness_index] / float(greenness_normalizer)
        slope, intercept = _lstsq_intercept(green, targets[cal_idx] - predicted)
        greenness = {
            "key": greenness_key,
            "normalizer": float(greenness_normalizer),
            "alpha": slope,
            "beta": intercept,
            "clip": [-1.0, 1.0],
        }

    heads = _fit_heads(scaled[train_idx], targets[train_idx], n_heads, alpha, seed + 3)

    train_predictions = _head_predictions(heads, scaled[train_idx])
    reference_spread = float(np.mean(np.std(train_predictions, axis=1)))
    if not np.isfinite(reference_spread) or reference_spread <= 0:
        raise TrainingError(
            "The ensemble's heads never disagree (reference_spread=0), so confidence would be "
            "meaningless. Increase the data's variance or --n-heads."
        )

    raw_valid = np.clip(_ensemble_mean(heads, scaled[valid_idx]), -1.0, 1.0)
    if greenness is not None:
        green_valid = features_matrix[valid_idx, greenness_index] / float(greenness_normalizer)
        calibrated_valid = np.clip(
            _ensemble_mean(heads, scaled[valid_idx])
            + greenness["alpha"] * green_valid
            + greenness["beta"],
            -1.0,
            1.0,
        )
    else:
        calibrated_valid = raw_valid

    holdout = {
        "n": int(len(valid_idx)),
        "n_plants": int(len(np.unique(groups[valid_idx]))),
        "raw": evaluate(targets[valid_idx], raw_valid),
        "calibrated": evaluate(targets[valid_idx], calibrated_valid),
    }
    if greenness_index is not None:
        green_train = features_matrix[train_idx, greenness_index] / float(greenness_normalizer)
        green_valid = features_matrix[valid_idx, greenness_index] / float(greenness_normalizer)
        slope, intercept = _lstsq_intercept(green_train, targets[train_idx])
        baseline = np.clip(slope * green_valid + intercept, -1.0, 1.0)
        holdout["greenness_only"] = evaluate(targets[valid_idx], baseline)
    holdout["calibration_helps"] = holdout["calibrated"]["mae"] < holdout["raw"]["mae"]

    metrics = {
        "train": {"n": int(len(train_idx)), "n_plants": int(len(np.unique(groups[train_idx])))},
        "holdout": holdout,
        "greenness": greenness,
        "warnings": warnings,
    }

    Bundle = _bundle_cls()
    bundle = Bundle(
        model_version=model_version,
        feature_names=feature_names,
        species_labels=species_labels,
        heads=[
            {"coef": [float(value) for value in head.coef_], "intercept": float(head.intercept_)}
            for head in heads
        ],
        reference_spread=reference_spread,
        saturate_at=saturate_at,
        scaler_mean=[float(value) for value in mean],
        scaler_std=[float(value) for value in std],
        greenness=greenness,
        metrics=metrics,
    )
    return bundle, metrics


def fit_from_rows(rows, feature_names, species_labels, **kwargs):
    """Build X/y/groups from TrainingRow objects and fit."""
    feature_names = list(feature_names)
    species_labels = list(species_labels)
    matrix = []
    targets = []
    groups = []
    for row in rows:
        missing = [name for name in feature_names if name not in row.features]
        if missing:
            raise TrainingError(f"Row {row.image!r} is missing feature(s) {missing}.")
        if len(row.species_probs) != len(species_labels):
            raise TrainingError(
                f"Row {row.image!r} has {len(row.species_probs)} species probabilities but "
                f"{len(species_labels)} labels were declared."
            )
        matrix.append([row.features[name] for name in feature_names] + list(row.species_probs))
        targets.append(row.target)
        groups.append(row.plant_id)
    return fit_bundle(matrix, targets, groups, feature_names, species_labels, **kwargs)


def _git_sha():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def save_training_outputs(bundle, metrics, out_dir, manifest_extra=None):
    """Write model.json + metrics.json + manifest.json into out_dir."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    model_path = bundle.save(out_dir / "model.json")
    (out_dir / "metrics.json").write_text(
        json.dumps(metrics, indent=2) + "\n", encoding="utf-8"
    )
    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "git_sha": _git_sha(),
        "python": sys.version.split()[0],
        "model_version": bundle.model_version,
        "model_file": model_path.name,
        "representation": bundle.representation,
        "feature_names": bundle.feature_names,
        "species_labels": bundle.species_labels,
        "ensemble_size": bundle.ensemble_size,
        "reference_spread": bundle.reference_spread,
        "metrics": metrics,
    }
    manifest.update(manifest_extra or {})
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return model_path, manifest_path


def _load_names(features_csv, feature_names_path, species_labels_path):
    features_csv = Path(features_csv)
    feature_names_path = Path(feature_names_path or features_csv.parent / "feature_names.json")
    species_labels_path = Path(species_labels_path or features_csv.parent / "species_labels.json")
    try:
        feature_names = json.loads(feature_names_path.read_text(encoding="utf-8"))
        species_labels = json.loads(species_labels_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise TrainingError(
            f"Missing column-order file: {exc}. Run the feature extraction step first; it writes "
            "feature_names.json and species_labels.json next to features.csv."
        ) from exc
    return feature_names, species_labels


def build_parser():
    parser = argparse.ArgumentParser(
        description="Fit the NDVI ensemble from a features.csv produced by the extract step."
    )
    parser.add_argument("--features", required=True, help="features.csv path")
    parser.add_argument("--feature-names", default=None)
    parser.add_argument("--species-labels", default=None)
    parser.add_argument("--out", default="../inference/weights")
    parser.add_argument("--model-version", default="ridge-feat-0.1")
    parser.add_argument("--n-heads", type=int, default=9)
    parser.add_argument("--alpha", type=float, default=1.0)
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--calib-fraction", type=float, default=0.25)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--greenness-key", default="exg")
    parser.add_argument("--greenness-normalizer", type=float, default=255.0)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    feature_names, species_labels = _load_names(
        args.features, args.feature_names, args.species_labels
    )
    rows = read_features_csv(args.features, feature_names, species_labels)
    bundle, metrics = fit_from_rows(
        rows,
        feature_names,
        species_labels,
        n_heads=args.n_heads,
        alpha=args.alpha,
        test_size=args.test_size,
        calib_fraction=args.calib_fraction,
        seed=args.seed,
        greenness_key=args.greenness_key,
        greenness_normalizer=args.greenness_normalizer,
        model_version=args.model_version,
    )
    model_path, manifest_path = save_training_outputs(
        bundle, metrics, args.out, {"features_csv": str(args.features)}
    )
    print(json.dumps(metrics, indent=2))
    print(f"Wrote {model_path}")
    print(f"Wrote {manifest_path}")


if __name__ == "__main__":
    main()
