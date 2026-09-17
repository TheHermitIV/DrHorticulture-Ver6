import numpy as np


def extract_channel_statistics(image, mask):
    pixels = np.asarray(image)[np.asarray(mask, dtype=bool)]
    if pixels.shape[0] == 0:
        return {
            "mean_r": 0.0,
            "mean_g": 0.0,
            "mean_b": 0.0,
            "median_r": 0.0,
            "median_g": 0.0,
            "median_b": 0.0,
        }
    return {
        "mean_r": float(np.mean(pixels[:, 0])),
        "mean_g": float(np.mean(pixels[:, 1])),
        "mean_b": float(np.mean(pixels[:, 2])),
        "median_r": float(np.median(pixels[:, 0])),
        "median_g": float(np.median(pixels[:, 1])),
        "median_b": float(np.median(pixels[:, 2])),
    }