import argparse


def parse_args():
    parser = argparse.ArgumentParser(
        description="Fine-tune a YOLO segmentation model on leaf annotations."
    )
    parser.add_argument("--data", default="data/processed/yolo_leaf/dataset.yaml")
    parser.add_argument("--weights", default="yolo26s-seg.pt")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--project", default="runs/seg")
    parser.add_argument("--name", default="leaf-seg")
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
    model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        project=args.project,
        name=args.name,
    )
    print(f"Finished. Best weights: {args.project}/{args.name}/weights/best.pt")


if __name__ == "__main__":
    main()