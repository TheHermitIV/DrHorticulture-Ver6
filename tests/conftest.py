import sys
from pathlib import Path

import numpy as np
import pytest

_SRC = Path(__file__).resolve().parents[1] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))


@pytest.fixture
def green_image():
    image = np.full((64, 64, 3), 20, dtype=np.uint8)
    image[16:48, 16:48] = [40, 180, 60]
    return image


@pytest.fixture
def stub_config():
    from plantvision.config.loader import load_config

    config = load_config()
    config.values["ndvi"]["mode"] = "proxy"
    return config