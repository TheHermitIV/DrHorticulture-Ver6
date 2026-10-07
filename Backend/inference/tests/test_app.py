import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import pytest

import app as app_module
from app import ServiceError, create_app, decode_image, download_image
from tests.conftest import API_KEY, analyze_body, png_bytes

EXAMPLE = json.loads(
    (Path(__file__).parents[2] / "contracts" / "inference.v1.example.json").read_text()
)


def post(client, body, key=API_KEY, **kwargs):
    headers = {} if key is None else {"x-inference-key": key}
    return client.post("/v1/analyze", json=body, headers=headers, **kwargs)


def assert_error(res, status, code):
    assert res.status_code == status
    assert res.get_json()["error"]["code"] == code
    assert isinstance(res.get_json()["error"]["message"], str)


def test_health_needs_no_key(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.get_json() == {"status": "ok", "model_version": "stub-0.1"}


def test_analyze_returns_the_contract_example(client, fetched):
    res = post(client, analyze_body())
    assert res.status_code == 200
    assert res.get_json() == EXAMPLE
    assert fetched == [analyze_body()["image_url"]]


def test_analyze_reports_the_configured_model_version():
    client = create_app(
        api_key=API_KEY, model_version="stub-0.2", fetch_image=lambda url: png_bytes()
    ).test_client()
    assert post(client, analyze_body()).get_json()["model_version"] == "stub-0.2"
    assert client.get("/health").get_json()["model_version"] == "stub-0.2"


def test_analyze_accepts_a_null_species_hint(client):
    assert post(client, analyze_body(species_hint=None)).status_code == 200


@pytest.mark.parametrize("key", [None, "", "wrong-key-0123456789"])
def test_analyze_rejects_a_missing_or_wrong_key(client, fetched, key):
    assert_error(post(client, analyze_body(), key=key), 401, "UNAUTHORIZED")
    assert fetched == []


def test_the_key_is_checked_before_the_body(client):
    assert_error(post(client, {}, key=None), 401, "UNAUTHORIZED")


@pytest.mark.parametrize(
    "body",
    [
        ["not", "an", "object"],
        analyze_body(image_url="ftp://example.com/a.png"),
        analyze_body(image_url="not a url"),
        analyze_body(image_url=None),
        analyze_body(image_id="not-a-uuid"),
        analyze_body(image_id=42),
        analyze_body(species_hint=""),
        analyze_body(species_hint="x" * 65),
        analyze_body(species_hint=3),
        {"image_url": "https://example.com/a.png", "image_id": analyze_body()["image_id"]},
    ],
)
def test_analyze_rejects_an_invalid_body(client, fetched, body):
    assert_error(post(client, body), 400, "VALIDATION_ERROR")
    assert fetched == []


def test_analyze_rejects_a_body_that_is_not_json(client):
    res = client.post(
        "/v1/analyze", data="nope", headers={"x-inference-key": API_KEY, "content-type": "text/plain"}
    )
    assert_error(res, 400, "VALIDATION_ERROR")


def test_a_failed_download_is_a_502():
    def failing_fetch(url):
        raise ServiceError(502, "IMAGE_DOWNLOAD_FAILED", "image URL returned HTTP 403")

    client = create_app(api_key=API_KEY, fetch_image=failing_fetch).test_client()
    assert_error(post(client, analyze_body()), 502, "IMAGE_DOWNLOAD_FAILED")


def test_bytes_that_are_not_an_image_are_a_422():
    client = create_app(api_key=API_KEY, fetch_image=lambda url: b"not an image").test_client()
    assert_error(post(client, analyze_body()), 422, "INVALID_IMAGE")


def test_the_cv_seam_gets_an_rgb_uint8_array(client, monkeypatch):
    seen = {}
    real_analyze = app_module.cv.analyze

    def spy(image):
        seen["image"] = image
        return real_analyze(image)

    monkeypatch.setattr(app_module.cv, "analyze", spy)
    assert post(client, analyze_body()).status_code == 200
    assert seen["image"].dtype == np.uint8
    assert seen["image"].shape == (24, 32, 3)


def test_no_plant_is_still_a_200(client, monkeypatch):
    real_analyze = app_module.cv.analyze
    monkeypatch.setattr(
        app_module.cv,
        "analyze",
        lambda image: {**real_analyze(image), "plant_detected": False, "mask_confidence": 0.0},
    )
    res = post(client, analyze_body())
    assert res.status_code == 200
    assert res.get_json()["segmentation"]["plant_detected"] is False


def test_a_seam_error_is_a_500_without_details(client, monkeypatch):
    def broken(embedding, species_probs):
        raise RuntimeError("secret internals")

    monkeypatch.setattr(app_module.ml, "predict", broken)
    res = post(client, analyze_body())
    assert_error(res, 500, "INTERNAL_ERROR")
    assert "secret" not in res.get_data(as_text=True)


def test_unknown_routes_use_the_error_shape(client):
    assert_error(client.get("/nope"), 404, "NOT_FOUND")
    assert_error(client.get("/v1/analyze"), 405, "METHOD_NOT_ALLOWED")


@pytest.mark.parametrize("key", [None, "", "too-short"])
def test_create_app_refuses_a_missing_or_short_key(key, monkeypatch):
    monkeypatch.delenv("INFERENCE_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="INFERENCE_API_KEY"):
        create_app(api_key=key)


def test_decode_image_applies_exif_orientation():
    from io import BytesIO

    from PIL import Image

    img = Image.new("RGB", (40, 10))
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90° clockwise to display
    buf = BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    assert decode_image(buf.getvalue()).shape == (40, 10, 3)


@pytest.fixture
def image_server():
    """A local HTTP server: /ok.png serves a PNG, anything else is a 404."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/ok.png":
                body = png_bytes()
                self.send_response(200)
                self.send_header("content-type", "image/png")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_error(404)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def test_download_image_fetches_over_http(image_server):
    assert download_image(f"{image_server}/ok.png") == png_bytes()


def test_download_image_reports_an_http_error(image_server):
    with pytest.raises(ServiceError) as exc:
        download_image(f"{image_server}/missing.png")
    assert (exc.value.status, exc.value.code) == (502, "IMAGE_DOWNLOAD_FAILED")
    assert "404" in exc.value.message


def test_download_image_reports_an_unreachable_host():
    with pytest.raises(ServiceError) as exc:
        download_image("http://127.0.0.1:1/ok.png")
    assert exc.value.code == "IMAGE_DOWNLOAD_FAILED"


def test_download_image_rejects_an_oversized_image(image_server, monkeypatch):
    monkeypatch.setattr(app_module, "MAX_IMAGE_BYTES", 10)
    with pytest.raises(ServiceError) as exc:
        download_image(f"{image_server}/ok.png")
    assert (exc.value.status, exc.value.code) == (422, "INVALID_IMAGE")
