"""Frozen CNN backbone and pretrained species classifier.

With CV_ENGINE=plantvision the species classifier is PlantVision's Hugging Face model
(configs/species.yaml) and SPECIES_LABELS are its classes; otherwise both are stubs. The
embedding is a placeholder either way until the ML team picks the backbone.
"""

import numpy as np

from cv import engine

# Embedding length D. TODO(decision): set by the real backbone.
EMBEDDING_SIZE = 8

# The classifier's class names, in the order of species_probs (length K). app.py uses them to
# report species.top_label.
SPECIES_LABELS = ("geranium", "petunia", "begonia")

# Loaded once, at import time, never per request. None for the stub.
BACKBONE = None  # TODO(decision): no backbone yet; see embed().
CLASSIFIER = None
CROP = "mask"
if engine.ENGINE == "plantvision":
    from plantvision.segmentation.mask import crop_to_mask
    from plantvision.species.model import HuggingFaceSpeciesModel

    _species = engine.CONFIG.section("species")
    CROP = _species.get("crop", "mask")
    CLASSIFIER = HuggingFaceSpeciesModel(_species.get("model_id"), device=_species.get("device"))
    SPECIES_LABELS = tuple(CLASSIFIER.id2label[i] for i in sorted(CLASSIFIER.id2label))
    # PlantVision reports the top_k classes; asking for all of them gives the full distribution.
    CLASSIFIER.top_k = len(SPECIES_LABELS)
    _LABEL_INDEX = {label: i for i, label in enumerate(SPECIES_LABELS)}


def embed(image: np.ndarray, mask: np.ndarray) -> dict:
    """Embed the image and classify its species.

    image: RGB uint8, H x W x 3. mask: bool H x W, from detector.detect().
    Returns embedding (float32[D]) and species_probs (float32[K], summing to 1, ordered like
    SPECIES_LABELS).
    """
    # TODO(decision): a placeholder until the ML team picks the backbone; ml.predict ignores it.
    embedding = np.zeros(EMBEDDING_SIZE, dtype=np.float32)
    if CLASSIFIER is None:
        return {
            "embedding": embedding,
            "species_probs": np.array([0.83, 0.10, 0.07], dtype=np.float32),
        }

    source = crop_to_mask(image, mask) if CROP == "mask" else image
    probs = np.zeros(len(SPECIES_LABELS), dtype=np.float32)
    for label, prob in CLASSIFIER.predict(source):
        probs[_LABEL_INDEX[label]] = prob
    return {"embedding": embedding, "species_probs": probs}
