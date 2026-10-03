"""CV stage. Seam: analyze(image) -> dict, with a fixed signature and fixed keys."""

import numpy as np

from cv import detector, embedder, features


def analyze(image: np.ndarray) -> dict:
    """Run the CV stage on one image.

    image: RGB uint8, H x W x 3.
    Returns mask, mask_confidence, leaf_fraction, plant_detected, angle_ok, embedding
    (float32[D]), species_probs (float32[K]), and features (dict of floats). When no plant is
    found, every key is still filled in (placeholders are fine), so the scan is rejected rather
    than failed.
    """
    detection = detector.detect(image)
    embedding = embedder.embed(image, detection["mask"])
    return {
        **detection,
        **embedding,
        "features": features.color_indices(image, detection["mask"]),
    }
