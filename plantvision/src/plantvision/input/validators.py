from pathlib import Path

import numpy as np
from PIL import Image

from plantvision import ImageError

DEFAULT_SUPPORTED_EXTENSIONS = (
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".tif",
    ".tiff",
    ".webp",
)


def validate_path_exists(path):
    candidate = Path(path)
    if not candidate.exists():
        raise ImageError(f"Image path does not exist: {path}")
    if not candidate.is_file():
        raise ImageError(f"Image path is not a file: {path}")
    return candidate


def validate_extension(path, supported=DEFAULT_SUPPORTED_EXTENSIONS):
    ext = Path(path).suffix.lower()
    if ext not in supported:
        raise ImageError(
            f"Unsupported image format '{ext}'. Supported formats: "
            f"{', '.join(supported)}"
        )
    return ext


def validate_decodable(path):
    try:
        with Image.open(path) as img:
            img.load()
    except Exception as exc:
        raise ImageError(f"Image cannot be decoded: {path} ({exc})") from exc


def validate_image_array(array):
    if not isinstance(array, np.ndarray):
        raise ImageError(
            f"Expected a numpy image array, got {type(array).__name__}"
        )
    if array.ndim != 3:
        raise ImageError(f"Expected an HxWx3 image, got shape {array.shape}")
    if array.shape[2] != 3:
        raise ImageError(f"Expected 3 channels, got {array.shape[2]}")
    return array