import argparse
import csv
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(
        description="Extract RGB/leaf features for raw images and join with sensor labels."
    )
    parser.add_argument("--images-dir", required=True, help="Directory of raw plant images")
    parser.add_argument(
        "--labels-csv",
        default=None,
        help="Optional CSV with image_id, plant_id, sensor_ndvi, ...",
    )
    parser.add_argument("--features-out", default="data/features/features.csv")
    parser.add_argument("--config-dir", default=None)
    parser.add_argument("--seg-model", default=None)
    return parser.parse_args()


def _read_labels(path):
    labels = {}
    if not path or not Path(path).is_file():
        return labels
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            image_id = row.get("image_id") or row.get("image")
            if not image_id:
                continue
            record = labels.setdefault(image_id, {})
            for key, value in row.items():
                if key in ("image_id", "image"):
                    continue
                record[key] = value
    return labels


def _write_csv(rows, out_path):
    if not rows:
        raise SystemExit("No feature rows were produced.")
    header = list(rows[0].keys())
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=header)
        writer.writeheader()
        writer.writerows(rows)
    return str(out_path)


def main():
    args = parse_args()
    from plantvision.features.extractor import FeatureExtractor
    from plantvision.input.image_loader import load_image
    from plantvision.segmentation.predictor import SegmentationPredictor
    from plantvision.config.loader import load_config

    overrides = {}
    if args.seg_model:
        overrides["segmentation"] = {"model_path": args.seg_model}
    config = load_config(config_dir=args.config_dir, overrides=overrides)
    predictor = SegmentationPredictor.from_config(config)
    extractor = FeatureExtractor()
    labels = _read_labels(args.labels_csv)

    images = sorted(
        f for f in Path(args.images_dir).iterdir() if f.is_file()
    )
    rows = []
    for image_path in images:
        try:
            image = load_image(str(image_path))
            segmentation = predictor.segment(image)
            features = extractor.extract(image.array, segmentation.combined_mask).to_dict()
        except Exception as exc:
            print(f"skipping {image_path.name}: {exc}")
            continue
        row = dict(features)
        row["image_id"] = image_path.stem
        row.update(labels.get(image_path.stem, {}))
        rows.append(row)

    out_path = Path(args.features_out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    _write_csv(rows, str(out_path))
    print(f"Wrote {len(rows)} rows to {out_path}")


if __name__ == "__main__":
    main()