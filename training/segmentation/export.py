import argparse
import shutil
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(
        description="Export a trained segmentation checkpoint into models/segmentation/."
    )
    parser.add_argument("--source", required=True, help="Path to the trained best.pt")
    parser.add_argument("--output", default="models/segmentation/leaf-seg.pt")
    return parser.parse_args()


def main():
    args = parse_args()
    source = Path(args.source)
    if not source.is_file():
        raise SystemExit(f"Source checkpoint not found: {source}")
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, output)
    print(f"Exported {source} -> {output}")
    print("Update configs/segmentation.yaml: model_path and classes: [0]")


if __name__ == "__main__":
    main()