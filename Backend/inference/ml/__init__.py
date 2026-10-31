"""ML stage. Seam: predict(features, species_probs) -> dict, with a fixed signature and keys.

`features` is the CV stage's color-index dict. The frozen-backbone embedding is deferred: at the
current dataset size the color features are the representation the heads consume. `species_probs`
is the classifier's distribution, aligned to `cv.embedder.SPECIES_LABELS`. See
`docs/ML_TRAINING_HANDOFF.md`.
"""

from ml import regressor


def predict(features, species_probs) -> dict:
    """Run the ML stage on the CV stage's color features and species probabilities.

    Returns ndvi (mean of the ensemble heads), ensemble_std, and confidence.
    """
    return regressor.estimate(features, species_probs)
