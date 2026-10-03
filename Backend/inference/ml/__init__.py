"""ML stage. Seam: predict(embedding, species_probs) -> dict, with a fixed signature and keys."""

from ml import regressor


def predict(embedding, species_probs) -> dict:
    """Run the ML stage on the CV stage's embedding and species probabilities.

    Returns ndvi (mean of the ensemble heads), ensemble_std, and confidence.
    """
    return regressor.estimate(embedding, species_probs)
