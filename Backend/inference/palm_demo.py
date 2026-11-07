"""Runtime for the reviewed palm mask and GreenSeeker NDVI proof of concept."""

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from plantvision.features.extractor import FEATURE_KEYS, FeatureExtractor

MODEL_PATH = Path(__file__).with_name("weights") / "palm-demo-v1.json"
MODEL_VERSION = "palm-demo-v1"
MAX_SIDE = 768
MIN_FRACTION = 0.002
MAX_FRACTION = 0.70


def pixel_features(rgb):
    height, width = rgb.shape[:2]
    scale = min(1.0, MAX_SIDE / max(height, width))
    small = cv2.resize(rgb, (max(1, round(width * scale)), max(1, round(height * scale))),
                       interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(small, cv2.COLOR_RGB2LAB).astype(np.float32) / 255
    red, green, blue = (small.astype(np.float32) / 255).transpose(2, 0, 1)
    light, a, b = lab.transpose(2, 0, 1)
    yy, xx = np.indices(light.shape, dtype=np.float32)
    return np.stack([
        light, a, b, green - red, green - blue,
        light - cv2.GaussianBlur(light, (0, 0), 2),
        cv2.GaussianBlur(a, (0, 0), 2), cv2.GaussianBlur(b, (0, 0), 2),
        abs(xx / max(1, light.shape[1] - 1) - .5),
        abs(yy / max(1, light.shape[0] - 1) - .5),
    ], axis=-1)


def clean_mask(selected, image_shape):
    small = selected.astype(np.uint8)
    _, labels, stats, _ = cv2.connectedComponentsWithStats(small)
    keep = stats[:, cv2.CC_STAT_AREA] >= max(4, round(small.size * .00002))
    keep[0] = False
    height, width = image_shape[:2]
    return cv2.resize(keep[labels].astype(np.uint8), (width, height),
                      interpolation=cv2.INTER_NEAREST).astype(bool)


class PalmDemo:
    """Evaluate exported numeric trees and ridge coefficients without a pickle."""

    def __init__(self, path=MODEL_PATH):
        with Path(path).open(encoding="utf-8") as file:
            artifact = json.load(file)
        if artifact["version"] != MODEL_VERSION or artifact["feature_keys"] != FEATURE_KEYS:
            raise ValueError("Incompatible palm demo model")
        self.baseline = artifact["baseline"]
        self.trees = [
            (np.asarray(tree["feature"], dtype=np.intp), np.asarray(tree["threshold"]),
             np.asarray(tree["left"], dtype=np.intp), np.asarray(tree["right"], dtype=np.intp),
             np.asarray(tree["value"]))
            for tree in artifact["trees"]
        ]
        self.coefficients = np.asarray(artifact["coefficients"])
        self.intercept = artifact["intercept"]
        self.extractor = FeatureExtractor()

    def mask(self, image):
        features = pixel_features(image)
        pixels = features.reshape(-1, features.shape[-1])
        score = np.full(len(pixels), self.baseline)
        rows = np.arange(len(pixels))
        for feature, threshold, left, right, value in self.trees:
            nodes = np.zeros(len(pixels), dtype=np.intp)
            while np.any(left[nodes] != nodes):
                nodes = np.where(pixels[rows, feature[nodes]] <= threshold[nodes],
                                 left[nodes], right[nodes])
            score += value[nodes]
        return clean_mask((score >= 0).reshape(features.shape[:2]), image.shape)

    def analyze(self, image):
        resized = Image.fromarray(image)
        resized.thumbnail((1536, 1536), Image.Resampling.LANCZOS)
        rgb = np.asarray(resized)
        mask = self.mask(rgb)
        fraction = float(mask.mean())
        detected = MIN_FRACTION <= fraction <= MAX_FRACTION
        indices = self.extractor.extract(rgb, mask) if detected else None
        ndvi = float(np.clip(self.intercept + self.coefficients @ indices.to_vector(), 0, .99)) if detected else 0.0
        return {
            "model_version": MODEL_VERSION,
            "segmentation": {"plant_detected": detected, "mask_confidence": 0.0,
                             "leaf_fraction": round(fraction, 6)},
            "species": {"top_label": "unknown", "top_prob": 0.0},
            "features": indices.to_dict() if indices is not None else {},
            # Single ridge head. Confidence stays zero until calibrated.
            "estimate": {"ndvi": round(ndvi, 6), "confidence": 0.0,
                         "ensemble_std": 0.0, "ensemble_size": 1},
            "checks": {"angle_ok": True},
        }
