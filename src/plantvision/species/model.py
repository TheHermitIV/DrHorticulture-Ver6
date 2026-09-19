from abc import ABC, abstractmethod

import numpy as np

from plantvision import SpeciesError


def _auto_device(torch):
    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return "mps"
    return "cpu"


class SpeciesModel(ABC):
    @abstractmethod
    def predict(self, image):
        """Return ranked (label, confidence) pairs, best first."""


class HuggingFaceSpeciesModel(SpeciesModel):
    def __init__(self, model_id, device=None, top_k=5):
        try:
            import torch
            from transformers import (
                AutoImageProcessor,
                AutoModelForImageClassification,
            )
        except ImportError as exc:
            raise SpeciesError(
                "Species classification needs torch and transformers. "
                "Install them with: pip install 'plantvision[ml]'"
            ) from exc
        self._torch = torch
        self.device = device or _auto_device(torch)
        self.top_k = int(top_k)
        try:
            self._processor = AutoImageProcessor.from_pretrained(model_id)
            self._model = AutoModelForImageClassification.from_pretrained(model_id)
        except Exception as exc:
            raise SpeciesError(
                f"Failed to load species model '{model_id}': {exc}"
            ) from exc
        self._model.to(self.device)
        self._model.eval()
        self.id2label = dict(self._model.config.id2label)

    def predict(self, image):
        from PIL import Image

        pil_image = Image.fromarray(np.asarray(image, dtype=np.uint8)).convert("RGB")
        inputs = self._processor(images=pil_image, return_tensors="pt")
        inputs = {key: value.to(self.device) for key, value in inputs.items()}
        with self._torch.no_grad():
            logits = self._model(**inputs).logits
        probs = logits.softmax(dim=-1)[0]
        count = max(1, min(self.top_k, int(probs.shape[-1])))
        values, indices = self._torch.topk(probs, k=count)
        return [
            (str(self.id2label[int(index)]), float(value))
            for value, index in zip(values.tolist(), indices.tolist())
        ]