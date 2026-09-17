import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(
        description="Export a trained NDVI model to a production path with metadata."
    )
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", default="models/ndvi/plantvision-ndvi.json")
    parser.add_argument("--model", default=None, help="Model type (xgboost)")
    return parser.parse_args()


def main():
    args = parse_args()
    source = Path(args.source)
    if not source.is_file():
        raise SystemExit(f"Source model not found: {source}")
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, output)

    sidecar = output.with_suffix(output.suffix + ".meta.json")
    metadata = {
        "model": args.model or output.stem,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source": str(source),
    }
    sidecar.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"Exported {source} -> {output}")
    print(f"Metadata: {sidecar}")


if __name__ == "__main__":
    main()