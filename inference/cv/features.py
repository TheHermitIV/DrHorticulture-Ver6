"""Color indices on the masked canopy pixels (stub).

The ML team replaces the body of color_indices(). Any keys are allowed; values are plain numbers
with no fixed range, since some indices are negative by definition.
"""

import numpy as np


def color_indices(image: np.ndarray, mask: np.ndarray) -> dict:
    """VARI, ExG, GLI, and NGRDI over the pixels where mask is True.

    image: RGB uint8, H x W x 3. mask: bool H x W, from detector.detect().
    """
    return {"vari": 0.12, "exg": 0.31, "gli": 0.18, "ngrdi": 0.09}
