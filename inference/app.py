"""Inference service: POST /v1/analyze and GET /health (contracts/inference.v1.*).

Turns an image URL into raw numbers through the CV stage (cv.analyze) and the ML stage
(ml.predict). It never decides fertilize, do not fertilize, or abstain, and never writes data.
The models load when cv and ml are imported, once, before the first request.
"""

import hmac
import io
import logging
import os
import time
import urllib.error
import urllib.request
import uuid
from urllib.parse import urlsplit

import numpy as np
from flask import Flask, jsonify, request
from PIL import Image, ImageOps
from werkzeug.exceptions import HTTPException

import cv
import ml
from cv.embedder import SPECIES_LABELS
from ml.regressor import ENSEMBLE_SIZE

DEFAULT_MODEL_VERSION = "stub-0.1"
MIN_API_KEY_LENGTH = 16

# Per download. The signed URL points at Supabase Storage, so this is usually well under 1 s.
DOWNLOAD_TIMEOUT_S = 20
# The api caps uploads at MAX_UPLOAD_MB (10 by default). TODO(decision): share one limit.
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_SPECIES_HINT_LENGTH = 64

log = logging.getLogger("inference")


class ServiceError(Exception):
    """An error returned as { "error": { "code", "message" } } with the given HTTP status."""

    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def download_image(url):
    """GET the image at url and return its bytes, at most MAX_IMAGE_BYTES."""
    req = urllib.request.Request(url, headers={"user-agent": "drhorticulture-inference"})
    try:
        with urllib.request.urlopen(req, timeout=DOWNLOAD_TIMEOUT_S) as res:
            data = res.read(MAX_IMAGE_BYTES + 1)
    except urllib.error.HTTPError as err:
        raise ServiceError(502, "IMAGE_DOWNLOAD_FAILED", f"image URL returned HTTP {err.code}")
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        reason = getattr(err, "reason", err)
        raise ServiceError(502, "IMAGE_DOWNLOAD_FAILED", f"image URL unreachable: {reason}")
    if len(data) > MAX_IMAGE_BYTES:
        raise ServiceError(422, "INVALID_IMAGE", f"image is over {MAX_IMAGE_BYTES} bytes")
    return data


def decode_image(data):
    """Decode JPEG/PNG bytes into the RGB uint8 H x W x 3 array the CV seam takes.

    The stored image is the untouched original, so its EXIF orientation is applied here.
    """
    try:
        with Image.open(io.BytesIO(data)) as img:
            rgb = ImageOps.exif_transpose(img).convert("RGB")
    except (OSError, ValueError, Image.DecompressionBombError) as err:
        raise ServiceError(422, "INVALID_IMAGE", f"image could not be decoded: {err}")
    return np.asarray(rgb, dtype=np.uint8)


def parse_request(body):
    """Validate an AnalyzeRequest body; returns (image_url, image_id, species_hint)."""
    if not isinstance(body, dict):
        raise ServiceError(400, "VALIDATION_ERROR", "body must be a JSON object")

    image_url = body.get("image_url")
    parts = urlsplit(image_url) if isinstance(image_url, str) else None
    if parts is None or parts.scheme not in ("http", "https") or not parts.netloc:
        raise ServiceError(400, "VALIDATION_ERROR", "image_url must be an http(s) URL")

    image_id = body.get("image_id")
    try:
        uuid.UUID(image_id)
    except (TypeError, ValueError, AttributeError):
        raise ServiceError(400, "VALIDATION_ERROR", "image_id must be a UUID")

    if "species_hint" not in body:
        raise ServiceError(400, "VALIDATION_ERROR", "species_hint is required (it may be null)")
    hint = body["species_hint"]
    if hint is not None and (
        not isinstance(hint, str) or not 1 <= len(hint) <= MAX_SPECIES_HINT_LENGTH
    ):
        raise ServiceError(
            400,
            "VALIDATION_ERROR",
            f"species_hint must be null or a string of 1-{MAX_SPECIES_HINT_LENGTH} characters",
        )
    return image_url, image_id, hint


def num(value):
    """A plain JSON number. float32 values such as 0.83 would otherwise print as 0.8299999833."""
    return round(float(value), 6)


def build_response(cv_out, ml_out, model_version):
    """Assemble the v1 AnalyzeResponse. mask and embedding never leave the service."""
    probs = np.asarray(cv_out["species_probs"])
    top = int(np.argmax(probs))
    return {
        "model_version": model_version,
        "segmentation": {
            "plant_detected": bool(cv_out["plant_detected"]),
            "mask_confidence": num(cv_out["mask_confidence"]),
            "leaf_fraction": num(cv_out["leaf_fraction"]),
        },
        "species": {"top_label": SPECIES_LABELS[top], "top_prob": num(probs[top])},
        "features": {name: num(value) for name, value in cv_out["features"].items()},
        "estimate": {
            "ndvi": num(ml_out["ndvi"]),
            "confidence": num(ml_out["confidence"]),
            "ensemble_std": num(ml_out["ensemble_std"]),
            "ensemble_size": ENSEMBLE_SIZE,
        },
        "checks": {"angle_ok": bool(cv_out["angle_ok"])},
    }


def error_response(status, code, message):
    return jsonify({"error": {"code": code, "message": message}}), status


def create_app(api_key=None, model_version=None, fetch_image=download_image):
    """Build the Flask app. api_key and model_version default to INFERENCE_API_KEY and
    MODEL_VERSION; fetch_image is injectable so tests need no network."""
    api_key = api_key if api_key is not None else os.environ.get("INFERENCE_API_KEY", "")
    if len(api_key) < MIN_API_KEY_LENGTH:
        raise RuntimeError(
            f"INFERENCE_API_KEY must be set to at least {MIN_API_KEY_LENGTH} characters"
        )
    model_version = model_version or os.environ.get("MODEL_VERSION") or DEFAULT_MODEL_VERSION

    app = Flask(__name__)

    @app.get("/health")
    def health():
        return jsonify({"status": "ok", "model_version": model_version})

    @app.post("/v1/analyze")
    def analyze():
        sent_key = request.headers.get("x-inference-key", "")
        if not hmac.compare_digest(sent_key.encode(), api_key.encode()):
            raise ServiceError(401, "UNAUTHORIZED", "missing or invalid x-inference-key")

        image_url, image_id, _species_hint = parse_request(request.get_json(silent=True))
        started = time.perf_counter()
        image = decode_image(fetch_image(image_url))
        cv_out = cv.analyze(image)
        ml_out = ml.predict(cv_out["embedding"], cv_out["species_probs"])
        body = build_response(cv_out, ml_out, model_version)
        # Never log image_url: its token grants access to the image.
        log.info(
            "analyzed image_id=%s size=%dx%d latency_ms=%d",
            image_id,
            image.shape[1],
            image.shape[0],
            (time.perf_counter() - started) * 1000,
        )
        return jsonify(body)

    @app.errorhandler(ServiceError)
    def handle_service_error(err):
        return error_response(err.status, err.code, err.message)

    @app.errorhandler(HTTPException)
    def handle_http_error(err):
        codes = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}
        return error_response(err.code, codes.get(err.code, "HTTP_ERROR"), err.description)

    @app.errorhandler(Exception)
    def handle_unexpected(err):
        log.exception("unhandled error")
        return error_response(500, "INTERNAL_ERROR", "internal error")

    return app


logging.basicConfig(level=logging.INFO)
app = create_app()
