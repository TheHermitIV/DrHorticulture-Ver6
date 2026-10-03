import numpy as np


def _arrays(actual, predicted):
    return (
        np.asarray(actual, dtype=float),
        np.asarray(predicted, dtype=float),
    )


def mae(actual, predicted):
    a, p = _arrays(actual, predicted)
    return float(np.mean(np.abs(a - p)))


def rmse(actual, predicted):
    a, p = _arrays(actual, predicted)
    return float(np.sqrt(np.mean((a - p) ** 2)))


def r2(actual, predicted):
    a, p = _arrays(actual, predicted)
    ss_res = float(np.sum((a - p) ** 2))
    ss_tot = float(np.sum((a - np.mean(a)) ** 2))
    if ss_tot == 0.0:
        return 0.0
    return float(1.0 - ss_res / ss_tot)


def pearson(actual, predicted):
    a, p = _arrays(actual, predicted)
    if np.std(a) == 0.0 or np.std(p) == 0.0:
        return 0.0
    return float(np.corrcoef(a, p)[0, 1])


def evaluate(actual, predicted):
    a, p = _arrays(actual, predicted)
    return {
        "n": int(a.size),
        "mae": mae(a, p),
        "rmse": rmse(a, p),
        "r2": r2(a, p),
        "pearson": pearson(a, p),
    }