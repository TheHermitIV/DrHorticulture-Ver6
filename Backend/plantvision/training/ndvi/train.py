import argparse


def parse_args():
    parser = argparse.ArgumentParser(
        description="Train an RGB-feature -> sensor-NDVI regression model."
    )
    parser.add_argument("--features", default="data/features/features.csv")
    parser.add_argument("--target", default="sensor_ndvi")
    parser.add_argument("--group", default="plant_id", help="Group key for leak-aware splitting")
    parser.add_argument("--model", default="xgboost", choices=["xgboost"])
    parser.add_argument("--out", default="models/ndvi/ndvi_xgb.json")
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=7)
    return parser.parse_args()


def _build_estimator(name, seed):
    import xgboost as xgb

    return xgb.XGBRegressor(
        n_estimators=300, learning_rate=0.05, random_state=seed, verbosity=0
    )


def _wrap(name, estimator):
    from plantvision.models.interfaces import XGBoostNDVIModel

    return XGBoostNDVIModel(estimator=estimator)


def _report_validation(actual, predicted):
    import json

    from plantvision.ndvi.metrics import evaluate

    print(json.dumps(evaluate(actual, predicted), indent=2))


def main():
    args = parse_args()
    import numpy as np
    import pandas as pd

    data = pd.read_csv(args.features)
    required = {args.target}
    if args.group:
        required.add(args.group)
    missing = required - set(data.columns)
    if missing:
        raise SystemExit(
            f"Missing required columns in {args.features}: {sorted(missing)}"
        )

    if args.group and args.group in data.columns:
        from sklearn.model_selection import GroupShuffleSplit

        splitter = GroupShuffleSplit(
            n_splits=1, test_size=args.test_size, random_state=args.seed
        )
        train_idx, valid_idx = next(
            splitter.split(data, groups=data[args.group])
        )
    else:
        from sklearn.model_selection import train_test_split

        train_idx, valid_idx = train_test_split(
            np.arange(len(data)), test_size=args.test_size, random_state=args.seed
        )

    feature_cols = [
        c
        for c in data.columns
        if c not in {args.target, "image_id", args.group}
    ]
    X = data[feature_cols].to_numpy(dtype=float)
    y = data[args.target].to_numpy(dtype=float)
    X_train, y_train = X[train_idx], y[train_idx]
    X_valid, y_valid = X[valid_idx], y[valid_idx]

    estimator = _build_estimator(args.model, args.seed)
    estimator.fit(X_train, y_train)

    model = _wrap(args.model, estimator)
    model.save(args.out)

    predictions = estimator.predict(X_valid)
    _report_validation(y_valid, predictions)
    print(
        f"Saved {args.model} model to {args.out} "
        f"({len(feature_cols)} features, {len(train_idx)} train / {len(valid_idx)} valid)"
    )


if __name__ == "__main__":
    main()