from dataclasses import dataclass, field

import numpy as np

from plantvision import FeatureError
from plantvision.features.greenness import channel_ratio, excess_green, green_ratio
from plantvision.features.rgb import extract_channel_statistics

FEATURE_KEYS = [
    "mean_r",
    "mean_g",
    "mean_b",
    "median_r",
    "median_g",
    "median_b",
    "green_ratio",
    "exg",
    "r_g_ratio",
    "g_b_ratio",
    "r_b_ratio",
    "leaf_coverage",
]


@dataclass
class FeatureVector:
    data: dict
    order: list = field(default_factory=lambda: list(FEATURE_KEYS))

    def to_dict(self):
        return dict(self.data)

    def to_vector(self):
        return [float(self.data.get(key, 0.0)) for key in self.order]

    @property
    def feature_names(self):
        return list(self.order)


class FeatureExtractor:
    def __init__(self, feature_keys=None):
        self.feature_keys = list(feature_keys) if feature_keys else list(FEATURE_KEYS)

    def extract(self, image, mask) -> FeatureVector:
        image_array = np.asarray(image)
        mask_array = np.asarray(mask, dtype=bool)
        if image_array.ndim != 3 or image_array.shape[2] != 3:
            raise FeatureError(
                f"Feature extraction requires an HxWx3 image, got {image_array.shape}"
            )
        if mask_array.shape != image_array.shape[:2]:
            raise FeatureError(
                f"Mask shape {mask_array.shape} does not match image "
                f"{image_array.shape[:2]}"
            )
        if mask_array.sum() == 0:
            raise FeatureError("Cannot extract features: mask contains no leaf pixels.")

        pixels = image_array[mask_array]
        red, green, blue = pixels[:, 0], pixels[:, 1], pixels[:, 2]

        data = extract_channel_statistics(image_array, mask_array)
        data["green_ratio"] = green_ratio(red, green, blue)
        data["exg"] = excess_green(red, green, blue)
        data["r_g_ratio"] = channel_ratio(red, green)
        data["g_b_ratio"] = channel_ratio(green, blue)
        data["r_b_ratio"] = channel_ratio(red, blue)
        data["leaf_coverage"] = float(mask_array.sum() / mask_array.size)

        ordered = {key: data[key] for key in self.feature_keys if key in data}
        return FeatureVector(data=ordered, order=list(ordered.keys()))