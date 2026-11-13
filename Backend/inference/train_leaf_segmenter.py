"""Train LeafSegmenter and its NDVI estimator from a private review workspace."""

import argparse
import hashlib
import json
from pathlib import Path
from tempfile import NamedTemporaryFile

import cv2
import numpy as np
from PIL import Image, ImageOps
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

from plantvision.segmentation.leaf import (
    FEATURE_KEYS, MAX_FRACTION, MIN_FRACTION, MODEL_FORMAT,
    LeafSegmenter, clean_mask, pixel_features, prepare_rgb,
)
from plantvision.features.extractor import FeatureExtractor
from plantvision.segmentation.mask import resize_mask

MODEL_PATH = Path(__file__).with_name("weights") / "leaf-segmenter-v1.0.0.json"


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
    rgb = prepare_rgb(rgb)
    if mask.shape != rgb.shape[:2]:
        mask = resize_mask(mask, rgb.shape[:2])
        if not mask.any() or mask.all():
            raise ValueError(f"Mask has no usable pixel labels after resizing for {entry['id']}")
    target = entry.get("greenseeker_ndvi")
    if target is not None:
        target = float(target)
        if not 0 <= target <= .99:
            raise ValueError(f"Invalid GreenSeeker NDVI for {entry['id']}")
    return rgb, mask, target


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


def train(work, output, model_version):
    entries = json.loads((work / "manifest.json").read_text())
    if len({entry["id"] for entry in entries}) != len(entries):
        raise ValueError("Use a unique plant ID for each reviewed photo")
    reviews = [read_review(work, entry) for entry in entries]
    if sum(target is not None for _, _, target in reviews) < 3:
        raise ValueError("Include at least three reviewed photos with GreenSeeker readings")
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
        if target is not None and MIN_FRACTION <= mask.mean() <= MAX_FRACTION:
            vectors.append(extractor.extract(rgb, mask).to_vector())
            targets.append(target)
    if len(vectors) < 3:
        raise ValueError("Fewer than three paired photos produced usable leaf masks")
    scaler = StandardScaler().fit(vectors)
    regressor = Ridge(alpha=1.0).fit(scaler.transform(vectors), targets)
    coefficients = regressor.coef_ / scaler.scale_
    artifact = {
        "version": MODEL_FORMAT, "feature_keys": FEATURE_KEYS,
        "model_version": model_version,
        "baseline": segmenter._baseline_prediction.item(),
        "trees": [export_tree(head[0].nodes) for head in segmenter._predictors],
        "coefficients": coefficients.tolist(),
        "intercept": float(regressor.intercept_ - coefficients @ scaler.mean_),
    }
    with NamedTemporaryFile(dir=output.parent, delete=False, mode="w", encoding="utf-8") as file:
        temporary = Path(file.name)
        json.dump(artifact, file, separators=(",", ":"))
    try:
        exported = LeafSegmenter(temporary)
        for (rgb, _, _), expected in zip(reviews, training_masks):
            if not np.array_equal(exported.mask(rgb), expected):
                raise ValueError("Exported mask differs from the training implementation")
        expected = regressor.predict(scaler.transform(vectors))
        np.testing.assert_allclose(exported.intercept + np.asarray(vectors) @ exported.coefficients, expected)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Verified parity on {len(reviews)} masks and {len(vectors)} regression inputs")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("work", type=Path)
    parser.add_argument("--output", type=Path, default=MODEL_PATH)
    parser.add_argument("--model-version", required=True, help="Unique version reported by the API")
    args = parser.parse_args()
    with threadpool_limits(limits=4):
        cv2.setNumThreads(2)
        train(args.work, args.output, args.model_version)
