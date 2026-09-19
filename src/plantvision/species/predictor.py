from dataclasses import dataclass, field

from plantvision import SpeciesError
from plantvision.segmentation.mask import crop_to_mask
from plantvision.species.model import HuggingFaceSpeciesModel


@dataclass
class SpeciesPrediction:
    label: str
    confidence: float
    top_k: list = field(default_factory=list)

    def as_dict(self):
        return {
            "label": self.label,
            "confidence": round(float(self.confidence), 4),
            "top_k": [
                {"label": label, "confidence": round(float(score), 4)}
                for label, score in self.top_k
            ],
        }


class SpeciesPredictor:
    def __init__(self, model, crop="mask"):
        self.model = model
        self.crop = crop

    @classmethod
    def from_config(cls, config):
        if "species" not in config.values:
            return None
        section = config.section("species")
        if not section.get("enabled", True):
            return None
        model_id = section.get("model_id")
        if not model_id:
            return None
        model = HuggingFaceSpeciesModel(
            model_id,
            device=section.get("device"),
            top_k=section.get("top_k", 3),
        )
        return cls(model, crop=section.get("crop", "mask"))

    def classify(self, image, mask) -> SpeciesPrediction:
        source = image.array
        if self.crop == "mask" and mask is not None:
            source = crop_to_mask(image.array, mask)
        ranked = self.model.predict(source)
        if not ranked:
            raise SpeciesError("Species model returned no predictions.")
        label, confidence = ranked[0]
        return SpeciesPrediction(label=label, confidence=float(confidence), top_k=ranked)