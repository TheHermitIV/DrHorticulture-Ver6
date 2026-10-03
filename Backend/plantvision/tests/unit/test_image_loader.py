import numpy as np
import pytest
from PIL import Image

from plantvision import ImageError
from plantvision.input.image_loader import image_from_array, load_image


def test_loads_rgb(tmp_path):
    path = tmp_path / "plant.png"
    Image.fromarray(np.zeros((10, 12, 3), dtype=np.uint8)).save(path)
    loaded = load_image(str(path))
    assert loaded.array.shape == (10, 12, 3)
    assert loaded.array.dtype == np.uint8
    assert loaded.width == 12
    assert loaded.height == 10


def test_rgba_converted_to_rgb(tmp_path):
    path = tmp_path / "plant.png"
    Image.fromarray(np.zeros((6, 6, 4), dtype=np.uint8)).save(path)
    loaded = load_image(str(path))
    assert loaded.array.shape == (6, 6, 3)


def test_missing_path_raises(tmp_path):
    with pytest.raises(ImageError, match="does not exist"):
        load_image(str(tmp_path / "nope.jpg"))


def test_unsupported_extension(tmp_path):
    path = tmp_path / "plant.xyz"
    path.write_bytes(b"anything")
    with pytest.raises(ImageError, match="Unsupported image format"):
        load_image(str(path))


def test_corrupt_image_raises(tmp_path):
    path = tmp_path / "plant.png"
    path.write_bytes(b"this is not a real png")
    with pytest.raises(ImageError, match="cannot be decoded"):
        load_image(str(path))


def test_image_from_array_rejects_2d():
    with pytest.raises(ImageError, match="HxWx3"):
        image_from_array(np.zeros((5, 5), dtype=np.uint8))