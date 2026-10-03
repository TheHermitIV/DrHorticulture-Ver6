"""Ensemble of shallow regression heads (stub).

The ML team replaces the body of estimate(), loads the heads below, and sets ENSEMBLE_SIZE to the
number of heads.
"""

import numpy as np

# Number of heads, reported as estimate.ensemble_size. TODO(decision): set by the real ensemble.
ENSEMBLE_SIZE = 5

# Loaded once, at import time, never per request. The stub has no weights.
HEADS = None


def estimate(embedding: np.ndarray, species_probs: np.ndarray) -> dict:
    """Estimate NDVI from the embedding plus the species probabilities.

    Returns ndvi (mean of the heads, -1 to 1), ensemble_std (>= 0), and confidence (0-1, derived
    from the spread).
    """
    return {"ndvi": 0.62, "ensemble_std": 0.04, "confidence": 0.78}
