"""Small exported confidence models, evaluated without scikit-learn."""
import cv2
import numpy as np


def sigmoid(value):
    return 1 / (1 + np.exp(-np.clip(value, -40, 40)))


def mask_quality_features(scores):
    probability = sigmoid(scores)
    selected = (scores >= 0).astype(np.uint8)
    foreground = probability[selected.astype(bool)]
    count = int(selected.sum())
    _, _, stats, _ = cv2.connectedComponentsWithStats(selected)
    components = stats[1:, cv2.CC_STAT_AREA]
    boundary = np.zeros(selected.shape, dtype=bool)
    boundary[:2] = boundary[-2:] = True
    boundary[:, :2] = boundary[:, -2:] = True
    yy, xx = np.indices(selected.shape)
    central = ((xx / max(1, selected.shape[1] - 1) - .5) ** 2
               + (yy / max(1, selected.shape[0] - 1) - .5) ** 2) <= .09
    return np.array([
        float(np.median(foreground)) if len(foreground) else 0,
        float((probability >= .75).sum() / max(1, (probability >= .25).sum())),
        count / selected.size,
        float(components.max() / max(1, count)) if len(components) else 0,
        float(np.log1p(len(components))),
        float(selected[boundary].sum() / max(1, count)),
        float(selected[central].sum() / max(1, count)),
        float(np.quantile(foreground, .25)) if len(foreground) else 0,
    ])


def linear_prediction(features, model):
    normalized = (np.asarray(features) - np.asarray(model["mean"])) / np.asarray(model["scale"])
    return float(normalized @ np.asarray(model["coefficients"]) + model["intercept"])


def mask_confidence(scores, model):
    raw = linear_prediction(mask_quality_features(scores), model)
    return float(sigmoid(model["platt_coefficient"] * raw + model["platt_intercept"]))


def ndvi_uncertainty(features, model):
    log_scale = linear_prediction(features[:model["feature_count"]], model)
    scale = float(np.exp(np.clip(log_scale, np.log(model["scale_min"]), np.log(model["scale_max"]))))
    ratios = np.asarray(model["calibration_ratios"])
    # Smoothed empirical support for an absolute NDVI error within the stated tolerance.
    support = (int((ratios <= model["tolerance"] / scale + 1e-12).sum()) + 1) / (len(ratios) + 2)
    return float(model["quantile"] * scale), float(support)
