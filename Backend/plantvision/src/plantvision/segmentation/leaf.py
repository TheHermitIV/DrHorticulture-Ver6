"""Runtime for the reviewed palm mask and GreenSeeker NDVI proof of concept."""

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from plantvision import SegmentationError
from plantvision.features.extractor import FEATURE_KEYS, FeatureExtractor
from plantvision.segmentation.model import SegmentationModel, SegmentationResult
from plantvision.segmentation.confidence import mask_confidence, ndvi_uncertainty

MODEL_FORMAT = "palm-demo-v1"
MODEL_VERSION = "LeafSegmenter v1.0.0"
MAX_SIDE = 768
MIN_FRACTION = 0.002
MAX_FRACTION = 0.70


def prepare_rgb(image):
    resized = Image.fromarray(image)
    resized.thumbnail((1536, 1536), Image.Resampling.LANCZOS)
    return np.asarray(resized)


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


class LeafSegmenter(SegmentationModel):
    """Evaluate exported numeric trees and ridge coefficients without a pickle."""

    def __init__(self, path):
        with Path(path).open(encoding="utf-8") as file:
            artifact = json.load(file)
        if artifact["version"] != MODEL_FORMAT or artifact["feature_keys"] != FEATURE_KEYS:
            raise ValueError("Incompatible LeafSegmenter model")
        self.model_version = artifact.get("model_version", MODEL_VERSION)
        if not isinstance(self.model_version, str) or not self.model_version.strip():
            raise ValueError("Palm model version must be a nonempty string")
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
        self.mask_quality = artifact.get("mask_quality")
        self.ndvi_uncertainty = artifact.get("ndvi_uncertainty")

    def pixel_scores(self, image):
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
        return score.reshape(features.shape[:2])

    def mask(self, image, *, scores=None):
        if scores is None:
            scores = self.pixel_scores(image)
        return clean_mask(scores >= 0, image.shape)

    def predict(self, image):
        mask = self.mask(image.array)
        if not MIN_FRACTION <= mask.mean() <= MAX_FRACTION:
            raise SegmentationError("Segmentation returned no usable leaf mask")
        return SegmentationResult(combined_mask=mask)

    def analyze(self, image):
        rgb = prepare_rgb(image)
        scores = self.pixel_scores(rgb)
        mask = self.mask(rgb, scores=scores)
        fraction = float(mask.mean())
        detected = MIN_FRACTION <= fraction <= MAX_FRACTION
        indices = self.extractor.extract(rgb, mask) if detected else None
        ndvi = float(np.clip(self.intercept + self.coefficients @ indices.to_vector(), 0, .99)) if detected else 0.0
        checks = {"angle_ok": True}
        mask_score = 0.0
        quality_confidence = 0.0
        error_radius, estimate_confidence = 0.0, 0.0
        if detected:
            foreground = scores[scores >= 0]
            mask_score = float(np.median(1 / (1 + np.exp(-foreground))))
            quality_confidence = mask_confidence(scores, self.mask_quality) if self.mask_quality else mask_score
            if self.ndvi_uncertainty:
                error_radius, estimate_confidence = ndvi_uncertainty(indices.to_vector(), self.ndvi_uncertainty)
            luminance = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)[mask]
            checks["leaf_lighting"] = {
                "mean_luminance": round(float(luminance.mean()), 2),
                "clipped_pct": round(100 * float((luminance >= 250).mean()), 2),
            }
        response = {
            "model_version": self.model_version,
            "segmentation": {"plant_detected": detected, "mask_confidence": round(quality_confidence, 6),
                             "leaf_fraction": round(fraction, 6)},
            "species": {"top_label": "unknown", "top_prob": 0.0},
            "features": indices.to_dict() if indices is not None else {},
            "estimate": {"ndvi": round(ndvi, 6), "confidence": round(estimate_confidence, 6),
                         "ensemble_std": 0.0, "ensemble_size": 1},
            "checks": checks,
        }
        if self.mask_quality and self.ndvi_uncertainty and detected:
            response["calibration"] = {
                "method": "provisional-v2",
                "mask_samples": self.mask_quality["fit_samples"],
                "mask_overlap_target": self.mask_quality["overlap_target"],
                "ndvi_samples": self.ndvi_uncertainty["samples"],
                "ndvi_radius": round(error_radius, 6),
                "ndvi_nominal_coverage": self.ndvi_uncertainty["nominal_coverage"],
                "ndvi_tolerance": self.ndvi_uncertainty["tolerance"],
            }
        return response
