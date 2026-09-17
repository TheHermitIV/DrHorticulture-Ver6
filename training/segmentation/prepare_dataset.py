import argparse
import random
import shutil
from pathlib import Path

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Prepare a YOLO segmentation dataset from annotated leaf images."
    )
    parser.add_argument("--images-dir", required=True, help="Directory of plant images")
    parser.add_argument("--labels-dir", required=True, help="Directory of YOLO-style <stem>.txt labels")
    parser.add_argument("--output-dir", default="data/processed/yolo_leaf")
    parser.add_argument("--val-fraction", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=7)
    return parser.parse_args()


def main():
    args = parse_args()
    images = [
        f
        for f in sorted(Path(args.images_dir).iterdir())
        if f.is_file() and f.suffix.lower() in IMAGE_EXTS
    ]
    if not images:
        raise SystemExit(
            f"No images found in {args.images_dir} (supported: {sorted(IMAGE_EXTS)})"
        )
    random.Random(args.seed).shuffle(images)
    split_at = max(1, int(len(images) * (1 - args.val_fraction)))
    train_images, val_images = images[:split_at], images[split_at:]

    output_dir = Path(args.output_dir)
    for split, subset in (("train", train_images), ("val", val_images)):
        out_images = output_dir / "images" / split
        out_labels = output_dir / "labels" / split
        out_images.mkdir(parents=True, exist_ok=True)
        out_labels.mkdir(parents=True, exist_ok=True)
        for image in subset:
            shutil.copy2(image, out_images / image.name)
            label = Path(args.labels_dir) / f"{image.stem}.txt"
            if label.is_file():
                shutil.copy2(label, out_labels / label.name)

    dataset_yaml = output_dir / "dataset.yaml"
    dataset_yaml.write_text(
        "path: {}\n"
        "train: images/train\n"
        "val: images/val\n"
        "names:\n"
        "  0: leaf\n".format(output_dir.resolve()),
        encoding="utf-8",
    )
    print(
        f"Prepared {len(train_images)} train / {len(val_images)} val images "
        f"in {output_dir}/"
    )
    print(f"Dataset config: {dataset_yaml.resolve()}")


if __name__ == "__main__":
    main()