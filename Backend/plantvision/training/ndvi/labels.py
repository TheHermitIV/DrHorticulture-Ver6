"""Load and validate the NDVI training labels CSV.

The CSV is the one input a teammate (or an agent) supplies besides the images. Keeping the schema
strict and the errors actionable is what lets the pipeline be run without tribal knowledge.

Required columns:

    image            file name (or relative path) under --images
    plant_id         group key; the same plant must never span train and test
    species          the labeled species (captured for provenance/analysis)
    greenseeker_ndvi target in [-1, 1]; GreenSeeker ground truth is 0.00-0.99

Any other columns are preserved on `LabelRow.source` and ignored by training.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from pathlib import Path

REQUIRED_COLUMNS = ("image", "plant_id", "species", "greenseeker_ndvi")
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".bmp")
MIN_RECOMMENDED_ROWS = 30


class DatasetError(ValueError):
    """The labels CSV or the images directory cannot be used as-is."""


@dataclass
class LabelRow:
    image: str
    plant_id: str
    species: str
    target: float
    source: dict = field(default_factory=dict)


def load_labels(path) -> list[LabelRow]:
    """Read the CSV, enforcing the required columns and per-row values."""
    path = Path(path)
    if not path.is_file():
        raise DatasetError(f"Labels CSV not found: {path}")

    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None:
            raise DatasetError(f"Labels CSV {path} is empty (no header row).")
        missing = [column for column in REQUIRED_COLUMNS if column not in reader.fieldnames]
        if missing:
            raise DatasetError(
                f"Labels CSV {path} is missing required column(s) {missing}. "
                f"Required: {list(REQUIRED_COLUMNS)}."
            )

        rows = []
        for line, raw in enumerate(reader, start=2):
            image = str(raw.get("image") or "").strip()
            plant_id = str(raw.get("plant_id") or "").strip()
            species = str(raw.get("species") or "").strip()
            if not image:
                raise DatasetError(f"Labels CSV line {line}: 'image' is empty.")
            if not plant_id:
                raise DatasetError(f"Labels CSV line {line}: 'plant_id' is empty.")
            if not species:
                raise DatasetError(f"Labels CSV line {line}: 'species' is empty.")
            target_text = raw.get("greenseeker_ndvi")
            try:
                target = float(target_text)
            except (TypeError, ValueError) as exc:
                raise DatasetError(
                    f"Labels CSV line {line}: greenseeker_ndvi must be a number, got "
                    f"{target_text!r}."
                ) from exc
            if target != target or target in (float("inf"), float("-inf")):
                raise DatasetError(f"Labels CSV line {line}: greenseeker_ndvi is not finite.")
            if not -1.0 <= target <= 1.0:
                raise DatasetError(
                    f"Labels CSV line {line}: greenseeker_ndvi {target} is outside [-1, 1]. "
                    "GreenSeeker ground truth is 0.00-0.99."
                )
            rows.append(LabelRow(image=image, plant_id=plant_id, species=species,
                                  target=target, source=dict(raw)))

    if not rows:
        raise DatasetError(f"Labels CSV {path} has no data rows.")
    return rows


def resolve_image(images_dir, name) -> Path | None:
    """Find `name` under `images_dir`, trying common extensions when none was given."""
    base = Path(images_dir)
    candidate = base / name
    if candidate.is_file():
        return candidate
    if Path(name).suffix:
        return None
    for extension in IMAGE_EXTENSIONS:
        candidate = base / f"{name}{extension}"
        if candidate.is_file():
            return candidate
    return None


def validate_dataset(images_dir, rows) -> dict:
    """Check that every label resolves to an image and summarize the dataset.

    Raises DatasetError (listing the problems) when the dataset cannot be trained on. Warnings
    are returned in the report so the run can continue.
    """
    images_dir = Path(images_dir)
    if not images_dir.is_dir():
        raise DatasetError(f"Images directory not found: {images_dir}")
    if not rows:
        raise DatasetError("No label rows to validate.")

    errors = []
    warnings = []
    seen = {}
    resolved = []
    for index, row in enumerate(rows, start=2):
        if row.image in seen:
            errors.append(
                f"duplicate image row {row.image!r} (lines {seen[row.image]} and {index})"
            )
        else:
            seen[row.image] = index
        path = resolve_image(images_dir, row.image)
        if path is None:
            errors.append(f"image not found under {images_dir}: {row.image!r}")
        else:
            resolved.append(path)

    plants = {}
    species = set()
    for row in rows:
        plants.setdefault(row.plant_id, set()).add(row.species)
        species.add(row.species)
    mixed = {plant: sorted(labels) for plant, labels in plants.items() if len(labels) > 1}
    if mixed:
        warnings.append(
            f"{len(mixed)} plant_id(s) map to multiple species, e.g. "
            f"{dict(list(mixed.items())[:3])}. Check the labels or the group key."
        )

    targets = [row.target for row in rows]
    if len(rows) < MIN_RECOMMENDED_ROWS:
        warnings.append(
            f"only {len(rows)} labeled rows; {MIN_RECOMMENDED_ROWS}+ is recommended for a "
            "grouped split and a meaningful ensemble."
        )
    if len(plants) < 2:
        errors.append(
            f"only {len(plants)} distinct plant_id value(s); a group split needs at least 2 so "
            "the same plant is never in both train and test."
        )
    if max(targets) > 0.99:
        warnings.append("some greenseeker_ndvi values exceed 0.99; GreenSeeker is 0.00-0.99.")

    report = {
        "n_rows": len(rows),
        "n_images_found": len(resolved),
        "n_plants": len(plants),
        "n_species": len(species),
        "species": sorted(species),
        "target": {
            "min": min(targets),
            "max": max(targets),
            "mean": sum(targets) / len(targets),
        },
        "warnings": warnings,
        "errors": errors,
    }
    if errors:
        raise DatasetError(_format_errors(errors))
    return report


def _format_errors(errors):
    shown = "; ".join(errors[:10])
    more = f" (and {len(errors) - 10} more)" if len(errors) > 10 else ""
    return f"Dataset has {len(errors)} problem(s): {shown}{more}"
