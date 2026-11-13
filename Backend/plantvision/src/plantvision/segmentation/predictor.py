import os

from plantvision import SegmentationError
from plantvision.input.image_loader import LoadedImage
from plantvision.segmentation.mask import validate_mask
from plantvision.segmentation.model import (
    SegmentationModel,
    SegmentationResult,
)


class SegmentationPredictor:
    def __init__(self, segmentation_model, min_leaf_pixels=10):
        self._model = segmentation_model
        self.min_leaf_pixels = min_leaf_pixels

    def segment(self, image: LoadedImage) -> SegmentationResult:
        result = self._model.predict(image)
        combined = validate_mask(result.combined_mask, image.array.shape[:2])
        leaf_pixels = int(combined.sum())
        if leaf_pixels < self.min_leaf_pixels:
            raise SegmentationError(
                f"Segmentation returned no usable leaf pixels "
                f"({leaf_pixels} < {self.min_leaf_pixels})."
            )
        result.combined_mask = combined
        return result

    @classmethod
    def from_config(cls, config):
        from plantvision.segmentation.leaf import LeafSegmenter

        segmentation = config.section("segmentation")
        model_path = os.environ.get("LEAF_SEGMENTER_MODEL_PATH") or config.resolve(
            segmentation.get("model_path", "models/segmentation/leaf-segmentor.json")
        )
        model = LeafSegmenter(model_path)
        return cls(model, min_leaf_pixels=segmentation.get("min_leaf_pixels", 10))
