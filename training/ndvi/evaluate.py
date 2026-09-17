import argparse
import json


def parse_args():
    parser = argparse.ArgumentParser(
        description="Evaluate a trained NDVI regression model against sensor ground truth."
    )
    parser.add_argument("--features", default="data/features/features.csv")
    parser.add_argument("--target", default="sensor_ndvi")
    parser.add_argument("--group", default="plant_id")
    parser.add_argument("--model", default="xgboost")
    parser.add_argument("--model-path", default="models/ndvi/ndvi_xgb.json")
    return parser.parse_args()


def main():
    args = parse_args()
    import pandas as pd

    from plantvision.ndvi.metrics import evaluate
    from plantvision.models.registry import load_model

    data = pd.read_csv(args.features)
    if args.target not in data.columns:
        raise SystemExit(f"Missing target column '{args.target}' in {args.features}")
    feature_cols = [
        c
        for c in data.columns
        if c not in {args.target, "image_id", args.group}
    ]
    X = data[feature_cols].to_numpy(dtype=float)
    y = data[args.target].to_numpy(dtype=float)

    model = load_model(args.model, args.model_path)
    predictions = [model.predict(vector) for vector in X.tolist()]
    print(json.dumps(evaluate(y.tolist(), predictions), indent=2))


if __name__ == "__main__":
    main()