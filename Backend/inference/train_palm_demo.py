"""Export the palm demo from a private review workspace: python train_palm_demo.py WORK."""

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

from palm_demo import (
    FEATURE_KEYS, MAX_FRACTION, MIN_FRACTION, MODEL_PATH, MODEL_VERSION,
    PalmDemo, clean_mask, pixel_features,
)
from plantvision.features.extractor import FeatureExtractor


def read_review(work, entry):
    folder = work / entry["id"]
    annotation = json.loads((folder / "annotation.json").read_text())
    mask_path = folder / "reviewed.png"
    digest = hashlib.sha256(mask_path.read_bytes()).hexdigest()
    if annotation["status"] != "accepted" or annotation["mask_sha256"] != digest:
        raise ValueError(f"Mask review verification failed for {entry['id']}")
    with Image.open(folder / "photo.jpg") as image:
        rgb = np.asarray(ImageOps.exif_transpose(image).convert("RGB"))
    with Image.open(mask_path) as image:
        mask = np.asarray(image.convert("L")) > 127
    if mask.shape != rgb.shape[:2] or not mask.any() or mask.all():
        raise ValueError(f"Invalid reviewed mask for {entry['id']}")
    return rgb, mask, float(entry["greenseeker_ndvi"])


def sample_pixels(features, mask, rng):
    height, width = features.shape[:2]
    labels = cv2.resize(mask.astype(np.uint8), (width, height),
                        interpolation=cv2.INTER_NEAREST).ravel()
    positions = []
    for label, limit in ((0, 2400), (1, 1200)):
        candidates = np.flatnonzero(labels == label)
        positions.append(rng.choice(candidates, size=min(limit, len(candidates)), replace=False))
    indices = np.concatenate(positions)
    return features.reshape(-1, features.shape[-1])[indices], labels[indices]


def export_tree(nodes):
    left, right = nodes["left"].copy(), nodes["right"].copy()
    leaves = nodes["is_leaf"].astype(bool)
    left[leaves] = right[leaves] = np.flatnonzero(leaves)
    return {"feature": nodes["feature_idx"].tolist(),
            "threshold": nodes["num_threshold"].tolist(),
            "left": left.tolist(), "right": right.tolist(), "value": nodes["value"].tolist()}


def train(work, output):
    entries = json.loads((work / "manifest.json").read_text())
    if len(entries) != 25 or len({entry["id"] for entry in entries}) != 25:
        raise ValueError("palm-demo-v1 expects the 25 distinct reviewed plants")
    reviews = [read_review(work, entry) for entry in entries]
    rng = np.random.default_rng(7)
    rows, labels = zip(*(sample_pixels(pixel_features(rgb), mask, rng) for rgb, mask, _ in reviews))
    segmenter = HistGradientBoostingClassifier(
        max_iter=80, max_leaf_nodes=15, learning_rate=.1,
        early_stopping=False, random_state=7,
    ).fit(np.concatenate(rows), np.concatenate(labels))
    extractor = FeatureExtractor()
    vectors, targets, training_masks = [], [], []
    for rgb, _, target in reviews:
        features = pixel_features(rgb)
        selected = segmenter.predict_proba(features.reshape(-1, features.shape[-1]))[:, 1] >= .5
        mask = clean_mask(selected.reshape(features.shape[:2]), rgb.shape)
        training_masks.append(mask)
        if MIN_FRACTION <= mask.mean() <= MAX_FRACTION:
            vectors.append(extractor.extract(rgb, mask).to_vector())
            targets.append(target)
    scaler = StandardScaler().fit(vectors)
    regressor = Ridge(alpha=1.0).fit(scaler.transform(vectors), targets)
    coefficients = regressor.coef_ / scaler.scale_
    artifact = {
        "version": MODEL_VERSION, "feature_keys": FEATURE_KEYS,
        "baseline": segmenter._baseline_prediction.item(),
        "trees": [export_tree(head[0].nodes) for head in segmenter._predictors],
        "coefficients": coefficients.tolist(),
        "intercept": float(regressor.intercept_ - coefficients @ scaler.mean_),
    }
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(artifact, separators=(",", ":")) + "\n", encoding="utf-8")
    exported = PalmDemo(temporary)
    for (rgb, _, _), expected in zip(reviews, training_masks):
        if not np.array_equal(exported.mask(rgb), expected):
            raise ValueError("Exported mask differs from the training implementation")
    expected = regressor.predict(scaler.transform(vectors))
    np.testing.assert_allclose(exported.intercept + np.asarray(vectors) @ exported.coefficients, expected)
    temporary.replace(output)
    print(f"Verified parity on {len(reviews)} masks and {len(vectors)} regression inputs")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("work", type=Path)
    parser.add_argument("--output", type=Path, default=MODEL_PATH)
    args = parser.parse_args()
    with threadpool_limits(limits=4):
        cv2.setNumThreads(2)
        train(args.work, args.output)
