"""Extract training features only, with the serving CV path.

Superseded as the normal entrypoint by `python -m training.ndvi.pipeline`, which extracts *and*
trains. This shim keeps a feature-only command for inspection and for `train.py`/`evaluate.py`
when run separately. It calls the same `extract()` code as the pipeline, so training and serving
cannot drift.

    python -m training.ndvi.build_features --images-dir data/raw --labels-csv data/labels/labels.csv
"""

import argparse
import json
from pathlib import Path

from training.ndvi.extract import extract, write_features_csv
from training.ndvi.labels import DatasetError, load_labels, validate_dataset


def parse_args():
    parser = argparse.ArgumentParser(
        description="Extract CV color features + species probabilities for training."
    )
    parser.add_argument("--images-dir", required=True, help="Directory of raw plant images")
    parser.add_argument("--labels-csv", required=True, help="Labels CSV (see labels.py)")
    parser.add_argument("--features-out", default="data/features/features.csv")
    parser.add_argument(
        "--species-source", choices=["classifier", "labels"], default="classifier"
    )
    parser.add_argument("--limit", type=int, default=None)
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        labels = load_labels(args.labels_csv)
        report = validate_dataset(args.images_dir, labels)
        print(json.dumps(report, indent=2))
        result = extract(
            args.images_dir,
            labels,
            species_source=args.species_source,
            limit=args.limit,
        )
    except (DatasetError, ValueError, FileNotFoundError, RuntimeError) as exc:
        raise SystemExit(f"error: {exc}") from exc

    path = Path(args.features_out)
    write_features_csv(result.rows, result.feature_names, result.species_labels, path)
    path.with_name("feature_names.json").write_text(
        json.dumps(result.feature_names, indent=2) + "\n", encoding="utf-8"
    )
    path.with_name("species_labels.json").write_text(
        json.dumps(result.species_labels, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(result.rows)} rows to {path}")
    print(f"Skipped {len(result.skipped)} image(s).")


if __name__ == "__main__":
    main()
