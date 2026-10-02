"""YOLO-seg canopy segmentation (stub).

The ML team replaces the body of detect() and loads the model below. It must keep the signature
and the keys of the returned dict.
"""

import numpy as np

# Loaded once, at import time, never per request. The stub has no weights.
MODEL = None


def detect(image: np.ndarray) -> dict:
    """Segment the canopy, masking out petals, pot, and soil.

    image: RGB uint8, H x W x 3.
    Returns mask (bool H x W), mask_confidence (0-1), leaf_fraction (0-1), plant_detected (bool),
    and angle_ok (bool).
    """
    return {
        "mask": np.ones(image.shape[:2], dtype=bool),
        "mask_confidence": 0.91,
        "leaf_fraction": 0.42,
        "plant_detected": True,
        "angle_ok": True,
    }
