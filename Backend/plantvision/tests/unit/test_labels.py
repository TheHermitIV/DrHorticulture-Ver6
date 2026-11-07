"""Tests for the training-label schema and dataset validation."""

import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from training.ndvi.labels import (  # noqa: E402
    DatasetError,
    load_labels,
    resolve_image,
    validate_dataset,
)

HEADER = "image,plant_id,species,greenseeker_ndvi\n"


def write_csv(tmp_path, body, name="labels.csv"):
    path = tmp_path / name
    path.write_text(HEADER + body, encoding="utf-8")
    return path


def make_images(tmp_path, names):
    images = tmp_path / "images"
    images.mkdir(exist_ok=True)
    for name in names:
        (images / name).write_bytes(b"not really an image")
    return images


def test_loads_valid_rows(tmp_path):
    path = write_csv(tmp_path, "a.jpg,p1,geranium,0.42\nb.jpg,p2,tomato,0.61\n")
    rows = load_labels(path)
    assert [row.image for row in rows] == ["a.jpg", "b.jpg"]
    assert rows[0].target == 0.42
    assert rows[0].plant_id == "p1"


def test_missing_required_column_names_the_column(tmp_path):
    path = tmp_path / "labels.csv"
    path.write_text("image,plant_id,greenseeker_ndvi\na.jpg,p1,0.4\n")
    with pytest.raises(DatasetError, match="species"):
        load_labels(path)


def test_non_numeric_target_is_rejected(tmp_path):
    path = write_csv(tmp_path, "a.jpg,p1,geranium,high\n")
    with pytest.raises(DatasetError, match="must be a number"):
        load_labels(path)


def test_out_of_range_target_is_rejected(tmp_path):
    path = write_csv(tmp_path, "a.jpg,p1,geranium,1.4\n")
    with pytest.raises(DatasetError, match=r"outside \[-1, 1\]"):
        load_labels(path)


def test_empty_target_is_rejected(tmp_path):
    path = write_csv(tmp_path, "a.jpg,p1,geranium,\n")
    with pytest.raises(DatasetError, match="must be a number"):
        load_labels(path)


def test_resolve_image_tries_common_extensions(tmp_path):
    images = make_images(tmp_path, ["plant-1.jpg"])
    assert resolve_image(images, "plant-1") == images / "plant-1.jpg"
    assert resolve_image(images, "plant-1.jpg") == images / "plant-1.jpg"
    assert resolve_image(images, "missing") is None


def test_validate_reports_a_missing_image(tmp_path):
    images = make_images(tmp_path, ["a.jpg"])
    path = write_csv(tmp_path, "a.jpg,p1,geranium,0.4\nmissing.jpg,p2,tomato,0.5\n")
    with pytest.raises(DatasetError, match="image not found"):
        validate_dataset(images, load_labels(path))


def test_validate_rejects_a_duplicate_image(tmp_path):
    images = make_images(tmp_path, ["a.jpg"])
    path = write_csv(tmp_path, "a.jpg,p1,geranium,0.4\na.jpg,p2,geranium,0.5\n")
    with pytest.raises(DatasetError, match="duplicate image"):
        validate_dataset(images, load_labels(path))


def test_validate_requires_at_least_two_plant_groups(tmp_path):
    images = make_images(tmp_path, ["a.jpg", "b.jpg"])
    path = write_csv(tmp_path, "a.jpg,p1,geranium,0.4\nb.jpg,p1,geranium,0.5\n")
    with pytest.raises(DatasetError, match="distinct plant_id"):
        validate_dataset(images, load_labels(path))


def test_validate_warns_when_a_plant_has_two_species(tmp_path):
    images = make_images(tmp_path, ["a.jpg", "b.jpg", "c.jpg"])
    # p1 maps to two species; p2 keeps a second group so the split is still valid.
    path = write_csv(
        tmp_path,
        "a.jpg,p1,geranium,0.4\nb.jpg,p1,tomato,0.5\nc.jpg,p2,geranium,0.6\n",
    )
    report = validate_dataset(images, load_labels(path))
    assert any("multiple species" in warning for warning in report["warnings"])
    assert report["n_plants"] == 2
