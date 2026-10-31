"""The trained NDVI model bundle: one JSON file that training writes and inference loads.

This module is the single source of truth for the artifact format. It is deliberately
dependency-light (numpy only) so both the training scripts and the inference service can import
it, and so CI stays free of scikit-learn, torch, and xgboost.

The bundle carries everything needed to reproduce a prediction exactly:

- `feature_names`: the ordered color features the heads consume. Inference reorders/dict-looks
  them up by name; a same-width column reorder must fail rather than silently predict nonsense.
- `species_labels`: the order of the species-probability columns appended after the features.
- `scaler_mean`/`scaler_std`: the standardization fitted on the training rows (null for models
  that do not standardize).
- `heads`: the ensemble. Each head is a linear model (coef + intercept) in scaled space. The mean
  is the NDVI estimate; the spread across heads is the confidence signal.
- `reference_spread`: mean across-head spread on the training data, the baseline that
  `spread_to_confidence` maps onto [0, 1]. Measured at fit time and stored, never guessed.
- `greenness`: the optional post-model adjustment fitted on held-out residuals:
  `ndvi_final = clip(ndvi_raw + alpha * greenness + beta)`.
- `metrics`: whatever the trainer measured, kept for evaluation/audit; inference ignores it.

See `docs/ML_TRAINING_HANDOFF.md` for the full handoff.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

SCHEMA_VERSION = 1
REPRESENTATION = "color_features+species_probs"


class BundleError(ValueError):
    """A bundle is missing, malformed, or does not match the input it was given."""


def spread_to_confidence(spread, reference_spread, saturate_at=2.0):
    """Map across-head prediction spread onto the contract's [0, 1] confidence scale.

    `spread` is the standard deviation across heads for one input; `reference_spread` is the
    mean spread measured on the training data. Linear from the training baseline down to zero,
    saturating at `saturate_at` times the baseline:

        confidence = 1 - min(1, spread / (saturate_at * reference_spread))

    This is a relative signal, not a calibrated probability of correctness. Calibration needs
    held-out residuals and is a documented follow-up.

    Guards the degenerate cases explicitly: a non-positive baseline would make the abstain gate
    inert, so it raises; a non-finite spread raises; unanimous heads return 1.0.
    """
    try:
        spread = float(spread)
        reference_spread = float(reference_spread)
        saturate_at = float(saturate_at)
    except (TypeError, ValueError) as exc:
        raise BundleError(f"spread_to_confidence takes numbers: {exc}") from exc
    if saturate_at <= 0:
        raise BundleError(f"saturate_at must be positive, got {saturate_at}.")
    if not math.isfinite(reference_spread) or reference_spread <= 0:
        raise BundleError(
            "reference_spread must be a positive finite number. A zero baseline means the "
            "ensemble's heads never disagreed, so spread carries no information; re-fit with "
            "more bootstrap variance rather than passing 0."
        )
    if not math.isfinite(spread):
        raise BundleError("spread must be a finite number, not NaN or inf.")
    if spread <= 0:
        return 1.0
    return float(max(0.0, min(1.0, 1.0 - spread / (saturate_at * reference_spread))))


@dataclass
class Bundle:
    """The serializable artifact. Construct it in training; `load()` it in inference."""

    model_version: str
    feature_names: list
    species_labels: list
    heads: list
    reference_spread: float
    saturate_at: float = 2.0
    scaler_mean: list | None = None
    scaler_std: list | None = None
    greenness: dict | None = None
    representation: str = REPRESENTATION
    metrics: dict = field(default_factory=dict)
    schema_version: int = SCHEMA_VERSION

    def __post_init__(self):
        self.feature_names = list(self.feature_names)
        self.species_labels = list(self.species_labels)
        self.heads = [dict(head) for head in self.heads]
        self.validate()

    @property
    def ensemble_size(self):
        return len(self.heads)

    @property
    def vector_width(self):
        return len(self.feature_names) + len(self.species_labels)

    def validate(self):
        """Raise BundleError with an actionable message when the artifact is unusable."""
        if self.schema_version != SCHEMA_VERSION:
            raise BundleError(
                f"Unsupported bundle schema_version {self.schema_version}; expected "
                f"{SCHEMA_VERSION}. Re-export the model with the current trainer."
            )
        if self.representation != REPRESENTATION:
            raise BundleError(
                f"Unsupported representation {self.representation!r}; this service expects "
                f"{REPRESENTATION!r}. A new representation needs a code change, not just a bundle."
            )
        if not str(self.model_version or "").strip():
            raise BundleError("Bundle model_version must be a non-empty string.")
        if not self.feature_names:
            raise BundleError("Bundle feature_names is empty; the heads need an explicit order.")
        if any(not isinstance(name, str) or not name for name in self.feature_names):
            raise BundleError("Bundle feature_names must all be non-empty strings.")
        if len(set(self.feature_names)) != len(self.feature_names):
            raise BundleError("Bundle feature_names contains duplicates; the order is ambiguous.")
        if any(not isinstance(label, str) or not label for label in self.species_labels):
            raise BundleError("Bundle species_labels must all be non-empty strings.")
        if len(set(self.species_labels)) != len(self.species_labels):
            raise BundleError("Bundle species_labels contains duplicates.")
        if not self.heads:
            raise BundleError(
                "Bundle has no heads. An ensemble needs at least one fitted head; two or more "
                "are needed for a meaningful ensemble_std."
            )

        width = self.vector_width
        for index, head in enumerate(self.heads):
            if not isinstance(head, dict) or "coef" not in head or "intercept" not in head:
                raise BundleError(
                    f"Bundle head {index} must be an object with 'coef' and 'intercept'."
                )
            coef = list(head["coef"])
            if len(coef) != width:
                raise BundleError(
                    f"Bundle head {index} has {len(coef)} coefficients but "
                    f"{len(self.feature_names)} features + {len(self.species_labels)} species "
                    f"= {width} were declared. Refusing to guess the mapping."
                )
            try:
                values = [float(value) for value in coef]
                intercept = float(head["intercept"])
            except (TypeError, ValueError) as exc:
                raise BundleError(f"Bundle head {index} is not numeric: {exc}") from exc
            if not all(math.isfinite(value) for value in values + [intercept]):
                raise BundleError(f"Bundle head {index} contains NaN or inf.")
            head["coef"] = values
            head["intercept"] = intercept

        try:
            self.reference_spread = float(self.reference_spread)
            self.saturate_at = float(self.saturate_at)
        except (TypeError, ValueError) as exc:
            raise BundleError(f"reference_spread/saturate_at must be numeric: {exc}") from exc
        if not math.isfinite(self.reference_spread) or self.reference_spread <= 0:
            raise BundleError(
                "Bundle reference_spread must be a positive finite number; it is measured at fit "
                "time and is the denominator of every confidence value."
            )
        if not math.isfinite(self.saturate_at) or self.saturate_at <= 0:
            raise BundleError("Bundle saturate_at must be a positive finite number.")

        if (self.scaler_mean is None) != (self.scaler_std is None):
            raise BundleError("Bundle must provide both scaler_mean and scaler_std, or neither.")
        if self.scaler_mean is not None:
            if len(self.scaler_mean) != width or len(self.scaler_std) != width:
                raise BundleError(
                    f"Bundle scaler has {len(self.scaler_mean)} means and "
                    f"{len(self.scaler_std)} stds but the vector width is {width}."
                )
            self.scaler_mean = [float(value) for value in self.scaler_mean]
            self.scaler_std = [float(value) for value in self.scaler_std]
            if any(not math.isfinite(value) for value in self.scaler_mean + self.scaler_std):
                raise BundleError("Bundle scaler contains NaN or inf.")
            if any(value <= 0 for value in self.scaler_std):
                raise BundleError("Bundle scaler_std values must be positive.")

        if self.greenness is not None:
            self._validate_greenness()

    def _validate_greenness(self):
        required = {"key", "alpha", "beta"}
        missing = sorted(required - set(self.greenness))
        if missing:
            raise BundleError(
                f"Bundle greenness is missing required key(s) {missing}; expected {sorted(required)}."
            )
        key = self.greenness["key"]
        if key not in self.feature_names:
            raise BundleError(
                f"Bundle greenness.key {key!r} is not one of feature_names; the adjustment "
                "would read a column the model does not carry."
            )
        try:
            alpha = float(self.greenness["alpha"])
            beta = float(self.greenness["beta"])
        except (TypeError, ValueError) as exc:
            raise BundleError(f"Bundle greenness alpha/beta must be numeric: {exc}") from exc
        if not math.isfinite(alpha) or not math.isfinite(beta):
            raise BundleError("Bundle greenness alpha/beta must be finite.")
        normalizer = self.greenness.get("normalizer")
        if normalizer is not None:
            normalizer = float(normalizer)
            if not math.isfinite(normalizer) or normalizer <= 0:
                raise BundleError("Bundle greenness.normalizer must be a positive finite number.")
            self.greenness["normalizer"] = normalizer
        clip = self.greenness.get("clip", [-1.0, 1.0])
        if len(clip) != 2:
            raise BundleError("Bundle greenness.clip must be [low, high].")
        self.greenness["key"] = key
        self.greenness["alpha"] = alpha
        self.greenness["beta"] = beta
        self.greenness["clip"] = [float(clip[0]), float(clip[1])]

    # --- prediction ---------------------------------------------------------

    def build_vector(self, features, species_probs):
        """Order features by name, append species probabilities, and apply the scaler."""
        if not isinstance(features, dict):
            raise BundleError(f"ML stage features must be a dict, got {type(features).__name__}.")
        missing = [name for name in self.feature_names if name not in features]
        if missing:
            raise BundleError(
                f"ML stage is missing feature(s) {missing} that this bundle was trained on. "
                "Refusing to impute: a silently substituted column yields a confident wrong "
                "answer. Regenerate the features with the same CV path used for training."
            )
        probs = list(species_probs)
        if len(probs) != len(self.species_labels):
            raise BundleError(
                f"species_probs has {len(probs)} values but the bundle expects "
                f"{len(self.species_labels)} ({self.species_labels}). The classifier and the "
                "trained model disagree; retrain or fix SPECIES_LABELS."
            )
        row = [float(features[name]) for name in self.feature_names]
        row.extend(float(prob) for prob in probs)
        vector = np.asarray(row, dtype=float)
        if not np.all(np.isfinite(vector)):
            raise BundleError("ML stage input contains NaN or inf.")
        if self.scaler_mean is not None:
            mean = np.asarray(self.scaler_mean, dtype=float)
            std = np.asarray(self.scaler_std, dtype=float)
            vector = (vector - mean) / std
        return vector

    def predict_raw(self, features, species_probs):
        """Return (mean prediction, across-head std) before any greenness adjustment."""
        vector = self.build_vector(features, species_probs)
        predictions = np.asarray(
            [float(np.dot(np.asarray(head["coef"]), vector) + head["intercept"])
             for head in self.heads],
            dtype=float,
        )
        return float(np.mean(predictions)), float(np.std(predictions))

    def greenness_value(self, features):
        """The normalized greenness scalar the adjustment consumes."""
        if self.greenness is None:
            return 0.0
        key = self.greenness["key"]
        if key not in features:
            raise BundleError(f"Greenness key {key!r} is missing from the CV features.")
        value = float(features[key])
        if not math.isfinite(value):
            raise BundleError(f"Greenness feature {key!r} is NaN or inf.")
        normalizer = self.greenness.get("normalizer")
        if normalizer:
            value /= float(normalizer)
        return value

    def calibrate(self, ndvi_raw, features):
        """Apply the fitted greenness adjustment and clip to the contract's range."""
        if self.greenness is None:
            return max(-1.0, min(1.0, float(ndvi_raw)))
        adjusted = (
            float(ndvi_raw)
            + self.greenness["alpha"] * self.greenness_value(features)
            + self.greenness["beta"]
        )
        low, high = self.greenness["clip"]
        return float(max(low, min(high, adjusted)))

    def predict(self, features, species_probs):
        """The full ML-stage output: ndvi, ensemble_std, confidence."""
        ndvi_raw, spread = self.predict_raw(features, species_probs)
        return {
            "ndvi": max(-1.0, min(1.0, self.calibrate(ndvi_raw, features))),
            "ensemble_std": spread,
            "confidence": spread_to_confidence(spread, self.reference_spread, self.saturate_at),
        }

    # --- serialization ------------------------------------------------------

    def to_dict(self):
        return {
            "schema_version": self.schema_version,
            "model_version": self.model_version,
            "representation": self.representation,
            "feature_names": list(self.feature_names),
            "species_labels": list(self.species_labels),
            "ensemble_size": self.ensemble_size,
            "heads": [dict(head) for head in self.heads],
            "reference_spread": self.reference_spread,
            "saturate_at": self.saturate_at,
            "scaler_mean": None if self.scaler_mean is None else list(self.scaler_mean),
            "scaler_std": None if self.scaler_std is None else list(self.scaler_std),
            "greenness": None if self.greenness is None else dict(self.greenness),
            "metrics": self.metrics,
        }

    @classmethod
    def from_dict(cls, data):
        if not isinstance(data, dict):
            raise BundleError("A bundle must be a JSON object.")
        required = (
            "model_version",
            "feature_names",
            "species_labels",
            "heads",
            "reference_spread",
        )
        missing = [key for key in required if key not in data]
        if missing:
            raise BundleError(f"Bundle is missing required key(s) {missing}.")
        declared_size = data.get("ensemble_size")
        heads = data["heads"]
        if declared_size is not None and int(declared_size) != len(heads):
            raise BundleError(
                f"Bundle claims ensemble_size {declared_size} but has {len(heads)} heads."
            )
        return cls(
            model_version=data["model_version"],
            feature_names=data["feature_names"],
            species_labels=data["species_labels"],
            heads=heads,
            reference_spread=data["reference_spread"],
            saturate_at=data.get("saturate_at", 2.0),
            scaler_mean=data.get("scaler_mean"),
            scaler_std=data.get("scaler_std"),
            greenness=data.get("greenness"),
            representation=data.get("representation", REPRESENTATION),
            metrics=data.get("metrics") or {},
            schema_version=data.get("schema_version", SCHEMA_VERSION),
        )

    def save(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(self.to_dict(), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return path

    @classmethod
    def load(cls, path):
        path = Path(path)
        if not path.is_file():
            raise BundleError(f"Model bundle not found: {path}")
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise BundleError(f"Model bundle {path} is not valid JSON: {exc}") from exc
        return cls.from_dict(data)
