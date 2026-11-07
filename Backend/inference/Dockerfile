# LeafSegmenter inference with a privately provisioned model file.
# Build context is the repo root, so the image can include Backend/plantvision/:
#   docker build -f Backend/inference/Dockerfile .
# On Railway: root directory "/", config file Backend/inference/railway.json.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    LEAF_SEGMENTER_ENABLED=true

WORKDIR /app

COPY Backend/inference/requirements.txt inference/
RUN pip install -r inference/requirements.txt opencv-python-headless==5.0.0.93

COPY Backend/plantvision/pyproject.toml Backend/plantvision/README.md plantvision/
COPY Backend/plantvision/src plantvision/src
RUN pip install --no-deps -e plantvision

COPY Backend/inference/ inference/
WORKDIR /app/inference

CMD ["sh", "-c", "exec gunicorn -b \"[::]:${PORT:-8000}\" --workers 1 --threads 4 --timeout 120 app:app"]
