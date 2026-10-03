from dataclasses import dataclass, field

import numpy as np

from plantvision import ModelError, SegmentationError
from plantvision.input.image_loader import LoadedImage
from plantvision.segmentation.mask import merge_masks, resize_mask, validate_mask


@dataclass
class SegmentationResult:
    combined_mask: np.ndarray
    confidences: list = field(default_factory=list)

    @property
    def coverage(self):
        return float(self.combined_mask.sum() / self.combined_mask.size)


class SegmentationModel:
    def predict(self, image: LoadedImage) -> SegmentationResult:
        raise NotImplementedError


class YoloSegmentationModel(SegmentationModel):
    def __init__(
        self,
        model_path=None,
        classes=None,
        confidence=0.25,
        device=None,
        imgsz=640,
    ):
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise ModelError(
                "Ultralytics is not installed. Install it with: "
                "pip install 'plantvision[ml]'"
            ) from exc
        try:
            self._model = YOLO(model_path)
        except Exception as exc:
            raise ModelError(
                f"Failed to load segmentation model '{model_path}': {exc}"
            ) from exc
        self.classes = list(classes or [])
        self.confidence = confidence
        self.device = device
        self.imgsz = imgsz

    def predict(self, image: LoadedImage) -> SegmentationResult:
        results = self._model.predict(
            source=image.array,
            conf=self.confidence,
            device=self.device,
            imgsz=self.imgsz,
            verbose=False,
            retina_masks=True,
        )
        if not results:
            raise SegmentationError("Segmentation model returned no results.")
        result = results[0]
        names = dict(getattr(result, "names", {}) or {})
        target_shape = image.array.shape[:2]
        if result.masks is None or getattr(result.masks, "data", None) is None:
            raise SegmentationError(self._no_leaf_message(result, names))
        leaf_masks = []
        confidences = []
        for i in range(int(result.masks.data.shape[0])):
            class_id = (
                int(result.boxes.cls[i].item())
                if result.boxes is not None
                else -1
            )
            if self.classes and class_id not in self.classes:
                continue
            raw = np.asarray(result.masks.data[i].detach().cpu().numpy(), dtype=bool)
            if raw.shape != tuple(target_shape):
                raw = resize_mask(raw, target_shape)
            leaf_masks.append(validate_mask(raw, target_shape))
            confidence = (
                float(result.boxes.conf[i].item())
                if result.boxes is not None
                else 0.0
            )
            confidences.append(confidence)
        combined = merge_masks(leaf_masks, target_shape)
        validate_mask(combined, target_shape)
        if int(combined.sum()) == 0:
            raise SegmentationError(self._no_leaf_message(result, names))
        return SegmentationResult(combined_mask=combined, confidences=confidences)

    def _no_leaf_message(self, result, names):
        detected = {}
        if result.boxes is not None:
            for class_id in result.boxes.cls.detach().cpu().numpy().tolist():
                detected[int(class_id)] = detected.get(int(class_id), 0) + 1
        if detected:
            summary = ", ".join(
                f"{names.get(cid, cid)} ({cid}) x{count}"
                for cid, count in sorted(detected.items())
            )
        else:
            summary = "none"
        configured = ", ".join(
            f"{names.get(cid, cid)} ({cid})" for cid in (self.classes or [])
        )
        hint = ""
        if self.classes:
            hint = (
                " The pretrained COCO model has no 'leaf' class - it recognizes "
                "'potted plant' (58). Use a clear potted-plant photo, update "
                "'classes' in configs/segmentation.yaml, or fine-tune on leaves "
                "via training/segmentation/."
            )
        return (
            "Segmentation returned no usable leaf pixels. "
            f"Configured relevant classes: {configured or 'all'}. "
            f"Classes detected in this image: {summary}.{hint}"
        )