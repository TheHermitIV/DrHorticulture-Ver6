"""Frozen CNN backbone and pretrained species classifier (stub).

The ML team replaces the body of embed(), loads the models below, and sets SPECIES_LABELS and
EMBEDDING_SIZE to the real classifier's classes and the backbone's output size.
"""

import numpy as np

# The classifier's class names, in the order of species_probs (length K). app.py uses them to
# report species.top_label. TODO(decision): the real label set comes from the ML team.
SPECIES_LABELS = ("geranium", "petunia", "begonia")

# Embedding length D. TODO(decision): set by the real backbone.
EMBEDDING_SIZE = 8

# Loaded once, at import time, never per request. The stub has no weights.
BACKBONE = None
CLASSIFIER = None


def embed(image: np.ndarray, mask: np.ndarray) -> dict:
    """Embed the image and classify its species.

    image: RGB uint8, H x W x 3. mask: bool H x W, from detector.detect().
    Returns embedding (float32[D]) and species_probs (float32[K], summing to 1, ordered like
    SPECIES_LABELS).
    """
    return {
        "embedding": np.zeros(EMBEDDING_SIZE, dtype=np.float32),
        "species_probs": np.array([0.83, 0.10, 0.07], dtype=np.float32),
    }
