import argparse


def parse_args():
    parser = argparse.ArgumentParser(description="Validate a YOLO segmentation model.")
    parser.add_argument("--weights", default="models/segmentation/leaf-seg.pt")
    parser.add_argument("--data", default="data/processed/yolo_leaf/dataset.yaml")
    parser.add_argument("--split", default="val")
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise SystemExit(
            "ultralytics is not installed. Install it with: pip install 'plantvision[ml]'"
        ) from exc
    model = YOLO(args.weights)
    metrics = model.val(data=args.data, split=args.split)
    print(metrics)


if __name__ == "__main__":
    main()