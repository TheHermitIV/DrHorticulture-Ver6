"""Which CV implementation runs, chosen once at import by CV_ENGINE.

- stub (default): hardcoded values that reproduce contracts/inference.v1.example.json. Needs only
  numpy, so tests and local development run without torch.
- plantvision: the ML team's PlantVision prototype (plantvision/, installed with
  requirements-cv.txt). Its models load here, once, at import time.
"""

import os

ENGINES = ("stub", "plantvision")

ENGINE = os.environ.get("CV_ENGINE", "stub")
if ENGINE not in ENGINES:
    raise RuntimeError(f"CV_ENGINE must be one of {', '.join(ENGINES)}, got {ENGINE!r}")

# PlantVision's merged configs/*.yaml (model paths, classes, thresholds), or None for the stub.
CONFIG = None
if ENGINE == "plantvision":
    from plantvision.config.loader import load_config

    CONFIG = load_config()
