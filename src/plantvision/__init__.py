__version__ = "0.1.0"


class PlantVisionError(Exception):
    pass


class ConfigError(PlantVisionError):
    pass


class ImageError(PlantVisionError):
    pass


class SegmentationError(PlantVisionError):
    pass


class FeatureError(PlantVisionError):
    pass


class ModelError(PlantVisionError):
    pass


class SpeciesError(PlantVisionError):
    pass


__all__ = [
    "PlantVisionError",
    "ConfigError",
    "ImageError",
    "SegmentationError",
    "FeatureError",
    "ModelError",
    "SpeciesError",
    "__version__",
]