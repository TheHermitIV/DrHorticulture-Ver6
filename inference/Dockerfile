# The inference service with PlantVision's CV models (CV_ENGINE=plantvision).
# Build context is the repo root, so the image can include plantvision/:
#   docker build -f inference/Dockerfile .
# On Railway: root directory "/", config file inference/railway.json.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/opt/hf \
    YOLO_CONFIG_DIR=/tmp/ultralytics \
    YOLO_OFFLINE=1 \
    CV_ENGINE=plantvision

# OpenCV (pulled in by ultralytics) needs these shared libraries.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY inference/requirements.txt inference/requirements-cv.txt inference/
RUN pip install -r inference/requirements.txt -r inference/requirements-cv.txt

# Only what the service needs from PlantVision: the package, its configs, and the YOLO weights.
# Installed editable so its configs/ and models/ paths resolve from /app/plantvision.
COPY plantvision/pyproject.toml plantvision/README.md plantvision/
COPY plantvision/src plantvision/src
COPY plantvision/configs plantvision/configs
COPY plantvision/models plantvision/models
RUN pip install --no-deps -e plantvision

COPY inference/ inference/
WORKDIR /app/inference

# Load every model once at build time, which downloads the species classifier (~390 MB) into the
# image, so a cold start never fetches it. After this the service runs offline.
RUN python -c "import cv"
ENV HF_HUB_OFFLINE=1

CMD ["sh", "-c", "exec gunicorn -b \"[::]:${PORT:-8000}\" --workers 1 --threads 4 --timeout 120 app:app"]
