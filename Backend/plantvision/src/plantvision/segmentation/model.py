from dataclasses import dataclass, field

import numpy as np

from plantvision.input.image_loader import LoadedImage


@dataclass
class SegmentationResult:
    combined_mask: np.ndarray
    confidences: list = field(default_factory=list)

    @property
    def coverage(self):
        return float(self.combined_mask.mean())


class SegmentationModel:
    def predict(self, image: LoadedImage) -> SegmentationResult:
        raise NotImplementedError
