"""YOLO-seg canopy segmentation.

With CV_ENGINE=plantvision this runs PlantVision's YOLO-seg predictor (configs/segmentation.yaml);
otherwise it returns stub values. Either way it keeps the signature and the keys of the returned
dict.
"""

import numpy as np

from cv import engine

# Loaded once, at import time, never per request. None for the stub.
MODEL = None
if engine.ENGINE == "plantvision":
    from plantvision import SegmentationError
    from plantvision.input.image_loader import image_from_array
    from plantvision.segmentation.predictor import SegmentationPredictor

    MODEL = SegmentationPredictor.from_config(engine.CONFIG)


def detect(image: np.ndarray) -> dict:
    """Segment the canopy, masking out petals, pot, and soil.

    image: RGB uint8, H x W x 3.
    Returns mask (bool H x W), mask_confidence (0-1), leaf_fraction (0-1), plant_detected (bool),
    and angle_ok (bool).
    """
    if MODEL is None:
        return {
            "mask": np.ones(image.shape[:2], dtype=bool),
            "mask_confidence": 0.91,
            "leaf_fraction": 0.42,
            "plant_detected": True,
            "angle_ok": True,
        }

    # PlantVision passes its array straight to ultralytics, which reads numpy arrays as BGR, so
    # it is given BGR here (the mask's geometry is the same). Remove this once PlantVision
    # converts RGB to BGR itself, or every color flips twice.
    bgr = np.ascontiguousarray(image[..., ::-1])
    try:
        result = MODEL.segment(image_from_array(bgr))
    except SegmentationError:
        # No plant: still a full answer, so the scan is rejected rather than failed.
        return {
            "mask": np.zeros(image.shape[:2], dtype=bool),
            "mask_confidence": 0.0,
            "leaf_fraction": 0.0,
            "plant_detected": False,
            "angle_ok": True,
        }
    return {
        "mask": result.combined_mask,
        # TODO(decision): how per-detection scores combine is the ML team's call; max for now.
        "mask_confidence": max(result.confidences, default=0.0),
        "leaf_fraction": result.coverage,
        "plant_detected": True,
        # TODO(decision): nothing in PlantVision checks the camera angle yet.
        "angle_ok": True,
    }
