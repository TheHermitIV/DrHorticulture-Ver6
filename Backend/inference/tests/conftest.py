import io
import os

import pytest
from PIL import Image

# app.py builds its module-level app at import, which needs the key.
os.environ.setdefault("INFERENCE_API_KEY", "test-inference-key-0123456789")
os.environ.pop("MODEL_VERSION", None)

API_KEY = os.environ["INFERENCE_API_KEY"]
IMAGE_ID = "6f1c2b9e-3d4a-4f5b-8c6d-7e8f9a0b1c2d"


def png_bytes(size=(32, 24), color=(40, 140, 60)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def fetched():
    """The URLs the fake fetcher was asked for."""
    return []


@pytest.fixture
def client(fetched):
    from app import create_app

    def fake_fetch(url):
        fetched.append(url)
        return png_bytes()

    return create_app(api_key=API_KEY, fetch_image=fake_fetch).test_client()


def analyze_body(**overrides):
    body = {
        "image_url": "https://example.supabase.co/storage/v1/object/sign/scan-images/a.png?token=t",
        "image_id": IMAGE_ID,
        "species_hint": "geranium",
    }
    body.update(overrides)
    return body
