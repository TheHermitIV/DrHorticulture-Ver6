from plantvision import SegmentationError
from plantvision.input.image_loader import LoadedImage
from plantvision.segmentation.mask import validate_mask
from plantvision.segmentation.model import (
    SegmentationModel,
    SegmentationResult,
    YoloSegmentationModel,
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
        segmentation = config.section("segmentation")
        model_path = config.resolve(
            segmentation.get("model_path", "models/segmentation/yolo26s-seg.pt")
        )
        model = YoloSegmentationModel(
            model_path=model_path,
            classes=segmentation.get("classes"),
            confidence=segmentation.get("confidence_threshold", 0.25),
            device=segmentation.get("device"),
            imgsz=segmentation.get("image_size", 640),
        )
        return cls(model, min_leaf_pixels=segmentation.get("min_leaf_pixels", 10))