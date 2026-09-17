import json
from pathlib import Path

from plantvision.segmentation.visualization import (
    save_mask as _save_mask_png,
    save_overlay as _save_overlay_png,
)
from plantvision.utils.paths import ensure_dir


def build_result(image_path, segmentation_result, features, ndvi_prediction):
    return {
        "image": str(image_path),
        "segmentation": {
            "leaf_pixels": int(segmentation_result.combined_mask.sum()),
            "leaf_coverage": round(float(segmentation_result.coverage), 6),
            "detections": len(segmentation_result.confidences or []),
        },
        "features": {
            key: round(float(value), 6)
            for key, value in features.to_dict().items()
        },
        "feature_order": list(features.feature_names),
        "ndvi": ndvi_prediction.as_dict(),
    }


def _write_json(data, path):
    ensure_dir(str(Path(path).parent))
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
    return str(path)


def save_outputs(
    result,
    output_dir,
    segmentation_result=None,
    image=None,
    save_mask=False,
    save_overlay=False,
):
    out_dir = ensure_dir(output_dir)
    written = {}
    mask_path = str(Path(out_dir) / "mask.png")
    overlay_path = str(Path(out_dir) / "overlay.png")
    if save_mask and segmentation_result is not None:
        _save_mask_png(segmentation_result.combined_mask, mask_path)
        written["mask"] = mask_path
    if save_overlay and segmentation_result is not None and image is not None:
        _save_overlay_png(image, segmentation_result.combined_mask, overlay_path)
        written["overlay"] = overlay_path
    written["prediction"] = _write_json(result, str(Path(out_dir) / "prediction.json"))
    written["features"] = _write_json(
        {
            "features": result["features"],
            "feature_order": result["feature_order"],
        },
        str(Path(out_dir) / "features.json"),
    )
    return written