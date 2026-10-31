"""One-command NDVI training pipeline: labels + images -> inference bundle.

    cd Backend/plantvision
    python -m training.ndvi.pipeline --images data/raw --labels data/labels/labels.csv

What it does, in order:

1. Validate the labels CSV and that every row resolves to an image (`--dry-run` stops here).
2. Run the *serving* CV path over each image and write `features.csv` plus the column orders.
3. Fit the ensemble + greenness adjustment on a group split by `plant_id`.
4. Write `model.json`, `metrics.json`, and `manifest.json` into `--out`.

If it fails, the error names the file, column, or setting to fix. See
`docs/ML_TRAINING_HANDOFF.md` for the input schema and the failure -> action table.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from training.ndvi.extract import extract, write_features_csv
from training.ndvi.labels import DatasetError, load_labels, validate_dataset
from training.ndvi.train import TrainingError, fit_from_rows, save_training_outputs


def build_parser():
    parser = argparse.ArgumentParser(
        description="Run the full NDVI training pipeline (labels -> bundle)."
    )
    parser.add_argument("--images", required=True, help="Directory of raw potted-plant photos")
    parser.add_argument("--labels", required=True, help="Labels CSV (see labels.py)")
    parser.add_argument("--out", default="../inference/weights", help="Bundle output directory")
    parser.add_argument(
        "--features-out", default="data/features/features.csv",
        help="Where to write the extracted feature matrix",
    )
    parser.add_argument("--model-version", default="ridge-feat-0.1")
    parser.add_argument("--n-heads", type=int, default=9)
    parser.add_argument("--alpha", type=float, default=1.0)
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--calib-fraction", type=float, default=0.25)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--greenness-key", default="exg")
    parser.add_argument("--greenness-normalizer", type=float, default=255.0)
    parser.add_argument(
        "--species-source", choices=["classifier", "labels"], default="classifier",
        help=(
            "classifier: feed the pretrained classifier's probabilities (matches serving). "
            "labels: feed a one-hot of the CSV species (ablation/offline fallback)."
        ),
    )
    parser.add_argument("--limit", type=int, default=None, help="Use only the first N rows")
    parser.add_argument(
        "--dry-run", action="store_true", help="Validate the data and print a report, then stop"
    )
    return parser


def run(args):
    labels = load_labels(args.labels)
    report = validate_dataset(args.images, labels)
    print(json.dumps({"dataset": report}, indent=2))

    if args.dry_run:
        print("Dry run: data is valid. Re-run without --dry-run to extract and train.")
        return None

    print(f"\nExtracting features from {args.images} (CV_ENGINE decides the CV backend)...")
    result = extract(
        args.images,
        labels,
        species_source=args.species_source,
        limit=args.limit,
    )
    print(
        f"Extracted {len(result.rows)} usable rows, skipped {len(result.skipped)}; "
        f"{len(result.feature_names)} color features, {len(result.species_labels)} species."
    )
    if result.skipped:
        for name, reason in result.skipped[:5]:
            print(f"  skipped {name}: {reason}")
        if len(result.skipped) > 5:
            print(f"  ... and {len(result.skipped) - 5} more")

    features_path = Path(args.features_out)
    write_features_csv(
        result.rows, result.feature_names, result.species_labels, features_path
    )
    features_path.with_name("feature_names.json").write_text(
        json.dumps(result.feature_names, indent=2) + "\n", encoding="utf-8"
    )
    features_path.with_name("species_labels.json").write_text(
        json.dumps(result.species_labels, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {features_path}")

    bundle, metrics = fit_from_rows(
        result.rows,
        result.feature_names,
        result.species_labels,
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
        bundle,
        metrics,
        args.out,
        {
            "images_dir": str(args.images),
            "labels_csv": str(args.labels),
            "features_csv": str(features_path),
            "n_rows": len(result.rows),
            "n_skipped": len(result.skipped),
            "species_source": args.species_source,
        },
    )

    print("\n" + json.dumps(metrics, indent=2))
    print(f"\nWrote {model_path}\nWrote {manifest_path}")
    holdout = metrics["holdout"]
    print(
        "Holdout MAE: raw "
        f"{holdout['raw']['mae']:.4f} -> calibrated {holdout['calibrated']['mae']:.4f} "
        f"({'improved' if holdout['calibration_helps'] else 'no improvement'})"
    )
    if not holdout["calibration_helps"]:
        print(
            "The greenness adjustment did not improve held-out MAE. Per the handoff, drop it "
            "(remove the greenness block from the bundle) before shipping."
        )
    return model_path


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        run(args)
    except (DatasetError, TrainingError, ValueError, FileNotFoundError, RuntimeError) as exc:
        raise SystemExit(f"error: {exc}") from exc


if __name__ == "__main__":
    main()
