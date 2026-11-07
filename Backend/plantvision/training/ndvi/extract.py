"""Turn labeled images into a training matrix using the *serving* CV path.

The important property is train/serve parity: extraction calls `inference/cv.analyze`, the exact
function the Flask service calls, rather than re-implementing segmentation and features here. If
the CV stage changes, both training and serving change together.

This module is intentionally lazy about heavy imports. `--dry-run` and unit tests never import
torch/ultralytics; only `extract()` does, and only when actually run.
"""

from __future__ import annotations

import csv
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

from training.ndvi.labels import LabelRow, resolve_image


def inference_dir() -> Path:
    """Backend/inference, relative to this file (Backend/plantvision/training/ndvi/extract.py)."""
    return Path(__file__).resolve().parents[3] / "inference"


def import_bundle_module():
    """Import `ml.bundle` from the inference package, keeping one artifact format."""
    path = str(inference_dir())
    if path not in sys.path:
        sys.path.insert(0, path)
    from ml.bundle import Bundle, BundleError  # noqa: PLC0415 (deliberate deferred import)

    return Bundle, BundleError


@dataclass
class TrainingRow:
    image: str
    plant_id: str
    species: str
    target: float
    features: dict
    species_probs: list
    mask_confidence: float = 0.0
    leaf_fraction: float = 0.0


@dataclass
class ExtractResult:
    rows: list
    feature_names: list
    species_labels: list
    skipped: list = field(default_factory=list)


def _load_cv(species_source):
    """Import the serving CV package with CV_ENGINE forced to plantvision unless set."""
    if not os.environ.get("CV_ENGINE"):
        os.environ["CV_ENGINE"] = "plantvision"
    if os.environ["CV_ENGINE"] != "plantvision":
        print(
            f"warning: CV_ENGINE={os.environ['CV_ENGINE']!r}; extracting stub features. "
            "Unset it or set CV_ENGINE=plantvision for real training data."
        )
    path = str(inference_dir())
    if path not in sys.path:
        sys.path.insert(0, path)
    try:
        import cv  # noqa: PLC0415
        from cv import embedder  # noqa: PLC0415
    except ImportError as exc:
        raise RuntimeError(
            f"The serving CV stack could not be imported ({exc}). Install it with "
            '`pip install -e ".[ml]"` from Backend/plantvision, or run with --dry-run to '
            "validate the labels without loading any models."
        ) from exc

    return cv, embedder


def extract(images_dir, labels: list[LabelRow], species_source="classifier", limit=None):
    """Run the CV stage over labeled images -> TrainingRow list + column orders."""
    cv, embedder = _load_cv(species_source)
    from plantvision.input.image_loader import load_image  # noqa: PLC0415

    if species_source == "labels":
        species_labels = sorted({row.species for row in labels})
        if not species_labels:
            raise ValueError("No species labels to train on.")
    elif species_source == "classifier":
        species_labels = list(embedder.SPECIES_LABELS)
    else:
        raise ValueError(
            f"species_source must be 'classifier' or 'labels', got {species_source!r}."
        )

    selected = labels[:limit] if limit else labels
    rows = []
    skipped = []
    feature_names = None

    for index, label in enumerate(selected, start=1):
        path = resolve_image(images_dir, label.image)
        if path is None:
            skipped.append((label.image, "image not found"))
            continue
        try:
            image = load_image(str(path))
            out = cv.analyze(image.array)
        except Exception as exc:  # a bad image must not abort a long run
            skipped.append((label.image, f"{type(exc).__name__}: {exc}"))
            continue
        if not out.get("plant_detected", False):
            skipped.append((label.image, "no plant detected"))
            continue
        features = out.get("features") or {}
        if not features:
            skipped.append((label.image, "no color features"))
            continue
        if feature_names is None:
            feature_names = list(features)
        missing = [name for name in feature_names if name not in features]
        if missing:
            skipped.append((label.image, f"missing features {missing}"))
            continue

        if species_source == "labels":
            probs = [1.0 if label.species == name else 0.0 for name in species_labels]
        else:
            probs = [float(value) for value in out["species_probs"]]
            if len(probs) != len(species_labels):
                raise ValueError(
                    f"classifier returned {len(probs)} probabilities but SPECIES_LABELS has "
                    f"{len(species_labels)}. Rebuild the CV stage before extracting."
                )

        rows.append(
            TrainingRow(
                image=label.image,
                plant_id=label.plant_id,
                species=label.species,
                target=label.target,
                features={name: float(features[name]) for name in feature_names},
                species_probs=probs,
                mask_confidence=float(out.get("mask_confidence", 0.0)),
                leaf_fraction=float(out.get("leaf_fraction", 0.0)),
            )
        )
        if index % 10 == 0:
            print(f"  extracted {index}/{len(selected)} ({len(rows)} usable, {len(skipped)} skipped)")

    if not rows:
        detail = "; ".join(f"{name}: {reason}" for name, reason in skipped[:5])
        raise ValueError(f"No usable rows were extracted. Skipped: {detail}")
    return ExtractResult(rows=rows, feature_names=feature_names,
                          species_labels=species_labels, skipped=skipped)


def features_columns(feature_names, species_labels):
    return (
        ["image", "plant_id", "species", "target", "mask_confidence", "leaf_fraction"]
        + list(feature_names)
        + [f"p_{label}" for label in species_labels]
    )


def write_features_csv(rows, feature_names, species_labels, path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    columns = features_columns(feature_names, species_labels)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            record = {
                "image": row.image,
                "plant_id": row.plant_id,
                "species": row.species,
                "target": row.target,
                "mask_confidence": row.mask_confidence,
                "leaf_fraction": row.leaf_fraction,
            }
            record.update({name: row.features[name] for name in feature_names})
            record.update(
                {f"p_{label}": prob for label, prob in zip(species_labels, row.species_probs)}
            )
            writer.writerow(record)
    return path


def read_features_csv(path, feature_names, species_labels):
    """Read a features CSV back into TrainingRow objects (used by evaluate.py)."""
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"Features CSV not found: {path}")
    rows = []
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        missing = [name for name in feature_names if name not in (reader.fieldnames or [])]
        missing += [
            f"p_{label}" for label in species_labels
            if f"p_{label}" not in (reader.fieldnames or [])
        ]
        if missing:
            raise ValueError(
                f"Features CSV {path} is missing column(s) {missing}. It may have been built "
                "with a different feature set; regenerate it from the same CV path."
            )
        for raw in reader:
            rows.append(
                TrainingRow(
                    image=raw.get("image", ""),
                    plant_id=raw.get("plant_id", ""),
                    species=raw.get("species", ""),
                    target=float(raw["target"]),
                    features={name: float(raw[name]) for name in feature_names},
                    species_probs=[float(raw[f"p_{label}"]) for label in species_labels],
                    mask_confidence=float(raw.get("mask_confidence") or 0.0),
                    leaf_fraction=float(raw.get("leaf_fraction") or 0.0),
                )
            )
    return rows
