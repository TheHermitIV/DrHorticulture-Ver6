"""Evaluate a saved bundle against a features.csv, with and without the greenness adjustment."""

from __future__ import annotations

import argparse
import json

import numpy as np

from training.ndvi.extract import import_bundle_module, read_features_csv
from training.ndvi.metrics import evaluate


def evaluate_bundle(bundle, rows):
    actual = np.asarray([row.target for row in rows], dtype=float)
    raw = []
    calibrated = []
    for row in rows:
        mean, _spread = bundle.predict_raw(row.features, row.species_probs)
        raw.append(max(-1.0, min(1.0, mean)))
        calibrated.append(bundle.predict(row.features, row.species_probs)["ndvi"])
    raw = np.asarray(raw)
    calibrated = np.asarray(calibrated)
    return {
        "n": int(len(rows)),
        "raw": evaluate(actual, raw),
        "calibrated": evaluate(actual, calibrated),
        "calibration_helps": evaluate(actual, calibrated)["mae"] < evaluate(actual, raw)["mae"],
    }


def build_parser():
    parser = argparse.ArgumentParser(description="Evaluate a trained NDVI bundle.")
    parser.add_argument("--features", required=True, help="features.csv path")
    parser.add_argument(
        "--model", default="../inference/weights/model.json", help="bundle JSON path"
    )
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    Bundle, BundleError = import_bundle_module()
    try:
        bundle = Bundle.load(args.model)
    except BundleError as exc:
        raise SystemExit(f"error: {exc}") from exc
    rows = read_features_csv(args.features, bundle.feature_names, bundle.species_labels)
    print(json.dumps(evaluate_bundle(bundle, rows), indent=2))


if __name__ == "__main__":
    main()
