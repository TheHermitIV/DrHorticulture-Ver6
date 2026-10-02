"""Color indices on the masked canopy pixels.

With CV_ENGINE=plantvision these are PlantVision's features (configs/default.yaml features.include:
channel means and medians, green ratio, ExG, channel ratios, leaf coverage); otherwise stub
values. Any keys are allowed; values are plain numbers with no fixed range.
"""

import numpy as np

from cv import engine

EXTRACTOR = None
if engine.ENGINE == "plantvision":
    from plantvision.features.extractor import FeatureExtractor

    EXTRACTOR = FeatureExtractor(engine.CONFIG.section("features").get("include") or None)


def color_indices(image: np.ndarray, mask: np.ndarray) -> dict:
    """Color indices over the pixels where mask is True.

    image: RGB uint8, H x W x 3. mask: bool H x W, from detector.detect().
    """
    if EXTRACTOR is None:
        return {"vari": 0.12, "exg": 0.31, "gli": 0.18, "ngrdi": 0.09}
    if not mask.any():
        return {}  # no plant: nothing to measure
    return EXTRACTOR.extract(image, mask).to_dict()
