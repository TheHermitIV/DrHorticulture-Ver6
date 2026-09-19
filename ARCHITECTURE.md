# PlantVision Architecture & Thought Process

## Purpose of This Document

This document explains both the **technical architecture** of PlantVision and the **reasoning behind the architecture**.

PlantVision is being developed as a simple MVP inside an existing repository. The immediate goal is not to claim that we can accurately measure NDVI from an RGB photograph. The immediate goal is to prove that we can wire together the major computer-vision components, process an image, extract meaningful plant/leaf information, and produce an NDVI-related output before the paired sensor dataset exists.

This document therefore serves two purposes:

1. **Architecture specification** — what components should exist, how they connect, and what contracts they expose.
2. **Thought-process record** — why those components were chosen, what assumptions are being made, what is temporary, and how the MVP is expected to evolve into the complete sensor-trained system.

The implementation should preserve this separation so that temporary MVP decisions do not become accidental long-term constraints.

---

# 1. Project Goal

The long-term goal is to build a system that can take an ordinary RGB image of a potted plant and predict an NDVI value using a model trained against real sensor measurements.

The eventual relationship is:

```text
RGB Image
    |
    v
Leaf Segmentation
    |
    v
Leaf Pixel Region
    |
    v
RGB Feature Extraction
    |
    v
Trained NDVI Regression Model
    |
    v
Predicted NDVI
```

The model will ultimately be trained using paired observations containing:

```text
Plant Image
    +
Image Metadata
    +
Actual Sensor Measurements
    |
    v
Ground-Truth NDVI
```

The important distinction is:

> **The sensor data is used to train and validate the RGB prediction model. It does not necessarily need to be present at inference time.**

---

# 2. MVP vs. Complete System

## MVP Objective

The MVP is intentionally simple.

We want to prove:

```text
Can we take an RGB image,
run computer vision on it,
identify the relevant leaf region,
extract RGB information,
and produce an NDVI-related output?
```

We can answer that question without having the final sensor dataset.

The MVP therefore focuses on the engineering pipeline rather than scientific validation.

### MVP components

- RGB image input
- Image validation
- YOLO26-seg integration
- Leaf/plant segmentation
- Combined leaf mask
- RGB feature extraction
- Greenness metrics
- NDVI proxy
- Replaceable NDVI model interface
- CLI
- Output artifacts
- Unit and integration tests

## Complete System

The complete system adds:

- Task-specific leaf segmentation training
- Plant/image metadata
- Sensor measurements
- Sensor-derived ground-truth NDVI
- Paired image/sensor training examples
- A trained RGB-to-NDVI regression model
- Quantitative validation
- Evaluation on previously unseen plants/capture sessions

The architecture is intentionally designed so that these future components can be added without replacing the entire MVP.

---

# 3. Core Thought Process

The architecture follows several principles.

## Principle 1 — Prove the pipeline before optimizing the model

There is little value in waiting for the perfect dataset before determining whether the application can:

```text
load image
    ->
segment plant/leaf region
    ->
extract features
    ->
run prediction
    ->
return result
```

The MVP lets us validate the plumbing first.

---

## Principle 2 — Separate segmentation from NDVI prediction

The segmentation model answers:

> Which pixels are relevant?

The NDVI model answers:

> Given the information extracted from those pixels, what NDVI should we predict?

These are different problems and should remain separate.

This allows us to improve segmentation without retraining the NDVI model architecture, and vice versa.

---

## Principle 3 — Preserve raw RGB information

We should not reduce the image to one simple "greenness" number too early.

Instead, extract multiple RGB-derived features.

For example:

```text
mean_r
mean_g
mean_b
median_r
median_g
median_b
green_ratio
exg
r_g_ratio
g_b_ratio
r_b_ratio
leaf_coverage
```

This gives the eventual regression model more information to learn from.

The model can determine which features are useful once real sensor data exists.

---

## Principle 4 — Treat sensor NDVI as ground truth

True NDVI is:

```text
NDVI = (NIR - Red) / (NIR + Red)
```

An RGB camera does not directly capture the NIR channel needed for conventional NDVI.

Therefore, the MVP must not represent an RGB greenness proxy as measured NDVI.

The eventual sensor dataset provides the target value against which RGB-derived features can be trained and evaluated.

---

## Principle 5 — Keep the prediction model replaceable

XGBoost is the initial planned regression model because the first approach is based on engineered RGB features.

However, the architecture should not assume that XGBoost is the final model.

The interface should make it possible to compare:

- XGBoost
- Random Forest
- LightGBM
- Neural-network regression
- CNN-based approaches
- Vision Transformer approaches
- Other future models

This keeps the application independent of the first modeling choice.

---

# 4. High-Level Architecture

```text
                    +----------------------+
                    |     RGB Image        |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |    Image Loader      |
                    |    + Validation      |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |    YOLO26-seg        |
                    |  Segmentation Model  |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |   Combined Leaf      |
                    |       Mask            |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |   RGB Feature        |
                    |     Extraction       |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |    NDVI Predictor     |
                    |    XGBoost / Proxy    |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |    NDVI Estimate      |
                    +----------------------+

Future training data:

                    +----------------------+
                    |    Plant Image       |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    | Image Metadata       |
                    | + Sensor Measurements|
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    | Sensor-derived       |
                    | Ground Truth NDVI    |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    | Train RGB -> NDVI    |
                    | Regression Model     |
                    +----------------------+
```

---

# 5. Repository Integration

PlantVision is **not intended to be a brand-new repository**.

It should be implemented as a self-contained folder that can be dropped into an existing repository.

Example:

```text
existing-repo/
├── ...existing project...
│
└── plantvision/
    ├── README.md
    ├── RUNME.md
    ├── ARCHITECTURE.md
    ├── pyproject.toml
    ├── .gitignore
    ├── .env.example
    ├── configs/
    ├── models/
    ├── data/
    ├── src/
    ├── training/
    ├── tests/
    └── outputs/
```

The PlantVision implementation should avoid overwriting unrelated files in the parent repository.

The folder should contain everything required for the PlantVision application, training utilities, tests, configuration, and documentation.

---

# 6. Directory Structure

```text
plantvision/
├── README.md
├── RUNME.md
├── ARCHITECTURE.md
├── pyproject.toml
├── .gitignore
├── .env.example
│
├── configs/
│   ├── default.yaml
│   ├── segmentation.yaml
│   └── ndvi.yaml
│
├── models/
│   ├── README.md
│   ├── segmentation/
│   │   └── .gitkeep
│   └── ndvi/
│       └── .gitkeep
│
├── data/
│   ├── README.md
│   ├── raw/
│   │   └── .gitkeep
│   ├── processed/
│   │   └── .gitkeep
│   ├── masks/
│   │   └── .gitkeep
│   ├── features/
│   │   └── .gitkeep
│   └── labels/
│       └── .gitkeep
│
├── src/
│   └── plantvision/
│       ├── __init__.py
│       │
│       ├── cli/
│       │   ├── __init__.py
│       │   ├── commands.py
│       │   └── output.py
│       │
│       ├── config/
│       │   ├── __init__.py
│       │   └── loader.py
│       │
│       ├── input/
│       │   ├── __init__.py
│       │   ├── image_loader.py
│       │   └── validators.py
│       │
│       ├── segmentation/
│       │   ├── __init__.py
│       │   ├── model.py
│       │   ├── predictor.py
│       │   ├── mask.py
│       │   └── visualization.py
│       │
│       ├── features/
│       │   ├── __init__.py
│       │   ├── rgb.py
│       │   ├── greenness.py
│       │   └── extractor.py
│       │
│       ├── ndvi/
│       │   ├── __init__.py
│       │   ├── predictor.py
│       │   ├── proxy.py
│       │   └── metrics.py
│       │
│       ├── models/
│       │   ├── __init__.py
│       │   ├── registry.py
│       │   └── interfaces.py
│       │
│       └── utils/
│           ├── __init__.py
│           ├── logging.py
│           └── paths.py
│
├── training/
│   ├── README.md
│   │
│   ├── segmentation/
│   │   ├── prepare_dataset.py
│   │   ├── train.py
│   │   ├── validate.py
│   │   └── export.py
│   │
│   └── ndvi/
│       ├── build_features.py
│       ├── train.py
│       ├── evaluate.py
│       └── export.py
│
├── tests/
│   ├── unit/
│   │   ├── test_image_loader.py
│   │   ├── test_rgb_features.py
│   │   ├── test_greenness.py
│   │   ├── test_masks.py
│   │   └── test_ndvi_proxy.py
│   │
│   └── integration/
│       └── test_pipeline.py
│
└── outputs/
    └── .gitkeep
```

---

# 7. Input Layer

Location:

```text
src/plantvision/input/
```

Responsibilities:

- Load image files.
- Validate supported image formats.
- Validate that an image is readable.
- Normalize image representation if required.
- Provide a consistent image object to downstream components.

The rest of the pipeline should not need to know whether the image came from:

- JPEG
- PNG
- another supported image format
- a local CLI path
- a future ingestion mechanism

The input layer creates a clean boundary.

---

# 8. Segmentation Architecture

Location:

```text
src/plantvision/segmentation/
```

The initial segmentation architecture assumes:

> **YOLO26-seg**

The segmentation component should be treated as a model-backed service inside the application.

## Model Strategy

The standard pretrained YOLO26-seg model may not directly provide a dedicated `leaf` class.

The intended production approach is therefore:

1. Start with `yolo26s-seg.pt` or the selected YOLO26-seg checkpoint.
2. Test the pretrained model as an initial feasibility experiment.
3. Collect representative plant images.
4. Annotate leaf regions.
5. Train a custom one-class segmentation model where:

```text
0 = leaf
```

6. Use the resulting fine-tuned model for production inference.

The application should not hard-code assumptions about the model's internal classes.

Instead, segmentation configuration should define which class or classes are considered relevant.

---

# 9. Why Leaf Segmentation?

The purpose of segmentation is primarily to identify the pixels that belong to the leaves.

We do not necessarily need to perfectly distinguish every individual leaf.

For the NDVI feature pipeline, the useful information is:

```text
Which pixels should be analyzed?
```

Therefore, the application should convert segmentation results into a combined boolean mask:

```text
True  = leaf pixel
False = non-leaf pixel
```

This simplifies downstream feature extraction.

Example:

```text
Original Image
      |
      v
YOLO26-seg detections
      |
      v
Individual segmentation masks
      |
      v
Combined Leaf Mask
      |
      v
RGB feature extraction
```

---

# 10. Segmentation Contract

The segmentation module should expose a stable interface similar to:

```python
class SegmentationModel:
    def predict(self, image) -> SegmentationResult:
        ...
```

`SegmentationResult` should contain enough information for downstream processing, such as:

- combined mask
- individual masks when available
- class IDs
- confidence scores
- bounding boxes
- optional visualization information

The downstream feature extraction code should depend primarily on the combined leaf mask.

This allows the underlying model to change without changing feature extraction.

---

# 11. Mask Processing

Location:

```text
src/plantvision/segmentation/mask.py
```

Responsibilities:

- Convert model masks into a consistent format.
- Combine masks.
- Validate dimensions.
- Remove invalid masks.
- Optionally perform simple post-processing.
- Calculate leaf coverage.

Example:

```text
leaf_coverage =
    number_of_leaf_pixels /
    total_number_of_image_pixels
```

This can become an additional feature for the NDVI model.

---

# 12. RGB Feature Extraction

Location:

```text
src/plantvision/features/
```

Once the leaf mask exists, feature extraction operates only on leaf pixels.

Conceptually:

```python
leaf_pixels = image[leaf_mask]
```

Features should include multiple representations of the RGB information.

## Basic channel statistics

```text
mean_r
mean_g
mean_b

median_r
median_g
median_b
```

## Derived features

Green ratio:

```text
G / (R + G + B)
```

Excess Green:

```text
ExG = 2G - R - B
```

Channel ratios:

```text
R / G
G / B
R / B
```

Leaf coverage:

```text
leaf_pixels / total_pixels
```

These features should be returned as a structured feature object or dictionary that can later be converted into a model-ready vector.

---

# 13. Why Not Just Use Average Green?

A simple green average could be enough to demonstrate that the pipeline works, but it throws away potentially useful information.

For example, two leaves could have similar average green values while differing substantially in:

- red intensity
- blue intensity
- saturation
- relative channel balance

Because the eventual goal is supervised learning against sensor-derived NDVI, it is better to preserve a richer feature vector.

The regression model can determine which features actually contribute to prediction quality.

---

# 14. NDVI Architecture

Location:

```text
src/plantvision/ndvi/
```

The NDVI subsystem should distinguish between:

1. True/sensor-derived NDVI.
2. MVP proxy output.
3. Learned RGB-to-NDVI prediction.

These are conceptually different things.

---

# 15. True NDVI

True NDVI is conventionally calculated from NIR and red reflectance:

```text
NDVI = (NIR - Red) / (NIR + Red)
```

This requires NIR information.

The future sensor pipeline will provide the information necessary to calculate or obtain the ground-truth NDVI value.

That value becomes the training target.

---

# 16. MVP NDVI Proxy

Until paired sensor data exists, the application can use an RGB greenness metric as a temporary proxy.

One candidate is:

```text
ExG = 2G - R - B
```

The exact proxy can be configured.

The purpose is not to claim that ExG equals NDVI.

The purpose is to make the pipeline executable:

```text
image
  ->
leaf mask
  ->
RGB features
  ->
proxy output
```

The code should clearly label this output as an estimate/proxy.

---

# 17. Future NDVI Regression Model

Once sensor data exists, the proxy can be replaced by a learned model.

Initial planned model:

```text
XGBoost
```

Input:

```text
RGB / leaf-derived features
```

Target:

```text
sensor-derived NDVI
```

Training example:

```text
Image A
    |
    v
Leaf mask
    |
    v
RGB features
    |
    +----------------------+
                           |
                           v
                    XGBoost training
                           ^
                           |
                 Ground-truth NDVI
                    from sensor
```

The deployed model then becomes:

```text
RGB image
    ->
leaf segmentation
    ->
RGB features
    ->
trained XGBoost
    ->
predicted NDVI
```

---

# 18. Model Abstraction

Location:

```text
src/plantvision/models/
```

The application should define model interfaces rather than hard-code a particular algorithm into the CLI.

Conceptually:

```python
class NDVIModel:
    def predict(self, features):
        ...
```

The first implementation can be:

```text
XGBoostNDVIModel
```

but later implementations could include:

```text
RandomForestNDVIModel
LightGBMNDVIModel
NeuralNDVIModel
ImageRegressionModel
```

This makes experimentation possible without restructuring the application.

---

# 19. Future End-to-End Model

The engineered-feature architecture is a deliberate first step.

If enough paired data becomes available, the project can investigate whether an end-to-end image model performs better.

For example:

```text
RGB Image
    |
    v
CNN / ViT
    |
    v
Predicted NDVI
```

This should be treated as a later experiment rather than a requirement for the MVP.

The feature-based approach provides:

- easier debugging
- interpretable inputs
- lower initial data requirements
- simpler training
- easier inspection of failure modes

---

# 20. Sensor Data Architecture

The future dataset is one of the most important pieces of the complete system.

Each observation should be able to associate:

```text
plant_id
image_id
capture_timestamp
sensor measurements
ground_truth NDVI
environmental metadata
```

Example conceptual record:

```json
{
  "plant_id": "plant_001",
  "image_id": "plant_001_001",
  "capture_timestamp": "2026-01-15T14:32:00",
  "sensor_ndvi": 0.67
}
```

The exact schema should be finalized when the sensor hardware and collection protocol are known.

---

# 21. Image + Metadata Relationship

The eventual training dataset should be thought of as paired observations rather than simply a directory of images.

Conceptually:

```text
plant_001_001.jpg
        |
        +---- metadata
        |       |
        |       +---- plant_id
        |       +---- timestamp
        |       +---- sensor readings
        |       +---- sensor NDVI
        |
        v
training example
```

This relationship is essential.

The RGB image supplies the model input.

The sensor measurement supplies the target.

---

# 22. Training Pipeline

The future training pipeline should be:

```text
                    Raw Dataset
                         |
              +----------+----------+
              |                     |
              v                     v
        Plant Images           Sensor Data
              |                     |
              v                     v
       Leaf Segmentation      Ground Truth NDVI
              |
              v
       RGB Feature Extraction
              |
              v
       Feature Dataset
              |
              +----------+
                         |
                         v
                 Train / Validation
                      / Test
                         |
                         v
                   XGBoost Model
                         |
                         v
                  Evaluation
                         |
                         v
                 Exported Model
```

---

# 23. Preventing Data Leakage

A major concern once the real dataset exists will be data leakage.

Suppose the same plant is photographed 20 times.

If 18 images are placed in training and 2 in testing, the test result may not represent performance on a genuinely unseen plant.

The dataset should therefore be split using an appropriate grouping strategy such as:

- Plant ID
- Capture session
- Experimental batch

For example:

```text
Training:
    plant_001
    plant_002
    plant_003
    plant_004

Validation:
    plant_005

Testing:
    plant_006
```

The exact split strategy should depend on the experiment and data collection design.

---

# 24. Evaluation

Once ground-truth sensor data exists, the NDVI prediction model should be evaluated quantitatively.

Candidate metrics:

- MAE
- RMSE
- R²
- Correlation
- Prediction error distribution

Example:

```text
Actual NDVI       Predicted NDVI
    0.65               0.63
    0.72               0.70
    0.41               0.45
```

The important point is that the final model should be evaluated against real sensor-derived measurements rather than against the MVP greenness proxy.

---

# 25. Configuration

Configuration should live in:

```text
configs/
```

Suggested files:

```text
default.yaml
segmentation.yaml
ndvi.yaml
```

Configuration should control things such as:

- model paths
- confidence thresholds
- segmentation classes
- image processing settings
- feature settings
- NDVI model path
- output locations
- logging settings

Paths should not be scattered throughout the Python source code.

---

# 26. CLI

The MVP should provide a simple command such as:

```bash
plantvision path/to/plant.jpg
```

Optional outputs:

```bash
plantvision path/to/plant.jpg --save-mask
```

```bash
plantvision path/to/plant.jpg --save-overlay
```

```bash
plantvision path/to/plant.jpg --json
```

The CLI should orchestrate the pipeline but should not contain the actual computer-vision or model logic.

Conceptually:

```text
CLI
 |
 +--> Input
 |
 +--> Segmentation
 |
 +--> Features
 |
 +--> NDVI Predictor
 |
 +--> Output
```

---

# 27. Output Artifacts

The application should support useful artifacts for debugging and development.

Potential outputs:

```text
outputs/
├── mask.png
├── overlay.png
├── prediction.json
└── features.json
```

A JSON result could contain:

```json
{
  "image": "plant.jpg",
  "segmentation": {
    "leaf_pixels": 12345,
    "leaf_coverage": 0.28,
    "detections": 1
  },
  "features": {
    "mean_r": 91.2,
    "mean_g": 134.5,
    "mean_b": 72.1,
    "exg": 105.7
  },
  "feature_order": ["mean_r", "mean_g", "mean_b", "exg"],
  "greenness": {
    "value": 105.7,
    "metric": "exg",
    "description": "average excess green (2G - R - B) over leaf pixels, 0-255 scale"
  },
  "species": {
    "label": "Digitalis purpurea",
    "confidence": 0.0944,
    "top_k": [
      {"label": "Digitalis purpurea", "confidence": 0.0944}
    ]
  },
  "ndvi": {
    "status": "unavailable",
    "reason": "No sensor-trained NDVI model is available yet."
  },
  "fertilization": {
    "status": "unavailable",
    "reason": "A fertilization recommendation requires NDVI."
  }
}
```

The exact output schema can evolve.

Until a sensor-trained model exists, the color-based result is emitted under
`greenness` (not `ndvi`) so it is never confused with true NDVI. When a
sensor-trained model is added it emits an `ndvi` block instead, keeping the two
clearly separated.

---

# 28. Error Handling

The application should fail clearly when:

- image path does not exist
- image cannot be decoded
- model weights are missing
- model configuration is invalid
- segmentation returns no usable mask
- feature extraction receives an invalid mask
- NDVI model is missing
- output path is invalid

Errors should provide actionable information rather than raw stack traces whenever possible.

---

# 29. Testing Strategy

## Unit Tests

Test individual components:

```text
test_image_loader.py
test_rgb_features.py
test_greenness.py
test_masks.py
test_ndvi_proxy.py
```

Examples:

- RGB means are calculated correctly.
- Masks have expected dimensions.
- Empty masks are handled.
- ExG calculation is correct.
- Proxy output is labeled correctly.

## Integration Test

Test the entire pipeline:

```text
image
  ->
segmentation
  ->
mask
  ->
features
  ->
NDVI predictor
  ->
output
```

The integration test should use a small fixture image/model or a mocked model where appropriate so that tests do not require expensive inference.

---

# 30. Training Structure

Segmentation training:

```text
training/segmentation/
├── prepare_dataset.py
├── train.py
├── validate.py
└── export.py
```

Responsibilities:

- prepare YOLO segmentation dataset
- train/fine-tune YOLO26-seg
- validate segmentation
- export the selected model

NDVI training:

```text
training/ndvi/
├── build_features.py
├── train.py
├── evaluate.py
└── export.py
```

Responsibilities:

- generate features from images
- join them with sensor-derived NDVI
- create dataset splits
- train regression model
- evaluate model
- export production model

---

# 31. Model File Strategy

Model files should not be committed to the source tree unless the repository intentionally stores them.

Recommended structure:

```text
models/
├── segmentation/
│   └── <model weights>
│
└── ndvi/
    └── <trained model>
```

The configuration should point to the active model.

For the MVP, the segmentation model may be a downloaded YOLO26-seg checkpoint.

For the complete system, it should eventually be the task-specific fine-tuned segmentation checkpoint.

---

# 32. Dependencies

The exact versions should be pinned or constrained in `pyproject.toml`.

Expected categories include:

- Python
- Ultralytics / YOLO
- PyTorch
- OpenCV or Pillow
- NumPy
- pandas
- scikit-learn
- XGBoost
- PyYAML
- pytest

The final dependency list should reflect what is actually used by the implementation.

---

# 33. Development Sequence

The recommended implementation order is:

## Step 1 — Project Skeleton

Create:

```text
src/
configs/
models/
data/
training/
tests/
outputs/
```

and package metadata.

## Step 2 — Input

Implement image loading and validation.

## Step 3 — Segmentation

Implement the YOLO26-seg interface and inference pipeline.

Initially test the pretrained checkpoint as a feasibility experiment.

## Step 4 — Mask

Convert segmentation output into a combined leaf mask.

## Step 5 — Features

Extract RGB and greenness features from masked pixels.

## Step 6 — MVP NDVI

Implement a clearly labeled RGB greenness/NDVI proxy.

## Step 7 — CLI

Connect all components into:

```bash
plantvision image.jpg
```

## Step 8 — Outputs

Add mask, overlay, JSON, and feature outputs.

## Step 9 — Tests

Add unit and integration tests.

## Step 10 — Sensor Dataset

When sensor data becomes available, implement metadata association and ground-truth NDVI generation.

## Step 11 — Train Segmentation

Fine-tune YOLO26-seg on representative leaf annotations.

## Step 12 — Train NDVI Model

Generate features and train XGBoost against sensor-derived NDVI.

## Step 13 — Evaluate

Measure performance using plant/session-aware dataset splits.

## Step 14 — Iterate

Compare feature sets and alternative regression models.

---

# 34. MVP Definition of Done

The MVP is considered successful when:

```text
A local RGB plant image
        |
        v
YOLO26-seg
        |
        v
Leaf region
        |
        v
RGB features
        |
        v
NDVI proxy
        |
        v
CLI output
```

works reliably.

The MVP does **not** need to establish accurate NDVI prediction.

It needs to establish that the architecture and pipeline work.

---

# 35. Complete-System Definition of Done

The complete system will require:

1. A representative plant image dataset.
2. A task-specific leaf segmentation model.
3. Paired image and sensor observations.
4. Sensor-derived ground-truth NDVI.
5. A training pipeline.
6. A trained RGB-to-NDVI model.
7. Plant-aware or session-aware evaluation.
8. Quantitative error measurements.
9. A deployable model artifact.
10. A production inference path that takes RGB imagery and produces a predicted NDVI.

---

# 36. Final Architecture

The final intended system is:

```text
                         INFERENCE
                         =========

                      RGB Plant Image
                              |
                              v
                       Image Loader
                              |
                              v
                       YOLO26-seg
                              |
                              v
                        Leaf Mask
                              |
                              v
                     RGB Feature Set
                              |
                              v
                    Trained NDVI Model
                              |
                              v
                     Predicted NDVI


                         TRAINING
                         ========

       RGB Images --------------------+
           |                          |
           v                          |
      Leaf Segmentation               |
           |                          |
           v                          |
      RGB Features                   |
           |                          |
           +------------+             |
                        |             |
                        v             |
                 Training Dataset     |
                        ^             |
                        |             |
                Sensor Measurements --+
                        |
                        v
                Ground-Truth NDVI
                        |
                        v
                 Regression Model
                        |
                        v
                Exported NDVI Model
```

The architecture deliberately separates **what we can prove today** from **what we intend to build once the real data exists**.

The MVP demonstrates the engineering path.

The future paired sensor dataset provides the supervision needed to turn that path into a trained and measurable RGB-to-NDVI system.

---

# 37. Key Takeaway

PlantVision should be viewed as an incremental system rather than a finished NDVI measurement product.

### Today

We can demonstrate:

```text
RGB image
→ computer vision
→ leaf region
→ RGB features
→ NDVI-related output
```

### Later

We will add:

```text
RGB image
+
image metadata
+
actual plant sensor data
→
ground-truth NDVI
→
trained regression model
→
validated RGB-based NDVI prediction
```

The architecture is intentionally designed around that progression so that the MVP is useful on its own while also establishing the foundation for the complete system.
