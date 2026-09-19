import json

import numpy as np
import pytest
from PIL import Image

from plantvision import SegmentationError
from plantvision.cli.commands import run_pipeline
from plantvision.segmentation.model import SegmentationModel, SegmentationResult
from plantvision.species.model import SpeciesModel


class GreenStubModel(SegmentationModel):
    def predict(self, image):
        arr = image.array
        r = arr[..., 0].astype(int)
        g = arr[..., 1].astype(int)
        b = arr[..., 2].astype(int)
        mask = (g > r) & (g > b)
        return SegmentationResult(combined_mask=mask)


class StubSpeciesModel(SpeciesModel):
    def predict(self, image):
        return [("Monstera deliciosa", 0.9), ("Ficus elastica", 0.05)]


def _write_image(tmp_path, array, name="plant.png"):
    path = tmp_path / name
    Image.fromarray(array).save(path)
    return path


def test_full_pipeline(green_image, stub_config, tmp_path):
    image_path = _write_image(tmp_path, green_image)
    outcome = run_pipeline(
        str(image_path),
        stub_config,
        segmentation_model=GreenStubModel(),
        output_dir=str(tmp_path / "out"),
    )
    result = outcome["result"]
    assert result["image"] == str(image_path)
    assert result["segmentation"]["leaf_coverage"] > 0
    expected = {"mean_r", "mean_g", "mean_b", "median_g", "exg", "leaf_coverage"}
    assert expected <= set(result["features"])
    assert result["ndvi"]["status"] == "unavailable"
    assert result["fertilization"]["status"] == "unavailable"
    assert result["greenness"]["metric"] == "exg"
    assert result["greenness"]["value"] > 0
    assert (tmp_path / "out" / "prediction.json").is_file()
    assert (tmp_path / "out" / "features.json").is_file()
    saved = json.loads((tmp_path / "out" / "prediction.json").read_text())
    assert saved["greenness"]["value"] == result["greenness"]["value"]


def test_pipeline_includes_species(green_image, stub_config, tmp_path):
    image_path = _write_image(tmp_path, green_image)
    outcome = run_pipeline(
        str(image_path),
        stub_config,
        segmentation_model=GreenStubModel(),
        species_model=StubSpeciesModel(),
        output_dir=str(tmp_path / "out"),
    )
    species = outcome["result"]["species"]
    assert species["label"] == "Monstera deliciosa"
    assert species["confidence"] == 0.9
    assert species["top_k"][0] == {"label": "Monstera deliciosa", "confidence": 0.9}


def test_pipeline_saves_mask_and_overlay(green_image, stub_config, tmp_path):
    image_path = _write_image(tmp_path, green_image)
    run_pipeline(
        str(image_path),
        stub_config,
        segmentation_model=GreenStubModel(),
        output_dir=str(tmp_path / "out"),
        save_mask=True,
        save_overlay=True,
    )
    assert (tmp_path / "out" / "mask.png").is_file()
    assert (tmp_path / "out" / "overlay.png").is_file()


def test_pipeline_requires_leaf_pixels(stub_config, tmp_path):
    image_path = _write_image(tmp_path, np.full((30, 30, 3), 100, dtype=np.uint8))
    with pytest.raises(SegmentationError, match="no usable leaf pixels"):
        run_pipeline(
            str(image_path),
            stub_config,
            segmentation_model=GreenStubModel(),
            output_dir=str(tmp_path / "out"),
        )


def test_pipeline_rejects_bad_mask_shape(green_image, stub_config, tmp_path):
    class WrongShapeModel(SegmentationModel):
        def predict(self, image):
            return SegmentationResult(combined_mask=np.zeros((3, 3), dtype=bool))

    image_path = _write_image(tmp_path, green_image)
    with pytest.raises(SegmentationError, match="does not match"):
        run_pipeline(
            str(image_path),
            stub_config,
            segmentation_model=WrongShapeModel(),
            output_dir=str(tmp_path / "out"),
        )