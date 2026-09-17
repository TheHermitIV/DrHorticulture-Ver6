from dataclasses import dataclass

import numpy as np
from PIL import Image

from plantvision import ImageError
from plantvision.input.validators import (
    DEFAULT_SUPPORTED_EXTENSIONS,
    validate_decodable,
    validate_extension,
    validate_image_array,
    validate_path_exists,
)


@dataclass
class LoadedImage:
    array: np.ndarray
    path: str

    @property
    def width(self):
        return self.array.shape[1]

    @property
    def height(self):
        return self.array.shape[0]


def load_image(path, supported=DEFAULT_SUPPORTED_EXTENSIONS) -> LoadedImage:
    validate_path_exists(path)
    validate_extension(path, supported)
    validate_decodable(path)
    try:
        with Image.open(path) as img:
            rgb = img.convert("RGB")
            array = np.asarray(rgb)
    except Exception as exc:
        raise ImageError(f"Failed to load image '{path}': {exc}") from exc
    validate_image_array(array)
    return LoadedImage(array=array, path=str(path))


def image_from_array(array) -> LoadedImage:
    image = np.asarray(array)
    validate_image_array(image)
    return LoadedImage(array=image, path="<memory>")