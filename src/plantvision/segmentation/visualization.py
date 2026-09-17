import numpy as np

from plantvision import SegmentationError


def render_overlay(image, mask, color=(0, 255, 0), alpha=0.5):
    overlay = np.asarray(image, dtype=np.uint8).copy()
    mask_array = np.asarray(mask, dtype=bool)
    if overlay.shape[:2] != mask_array.shape:
        raise SegmentationError(
            f"Overlay requires matching dimensions; image {overlay.shape[:2]} "
            f"vs mask {mask_array.shape}."
        )
    color_arr = np.array(color, dtype=np.float64)
    overlay[mask_array] = (
        overlay.astype(np.float64)[mask_array] * (1.0 - alpha)
        + color_arr * alpha
    ).astype(np.uint8)
    return overlay


def save_mask(mask, path):
    from PIL import Image

    mask_array = np.asarray(mask, dtype=bool)
    if mask_array.ndim != 2:
        raise SegmentationError("Cannot save a non-2D mask.")
    image = Image.fromarray((mask_array * 255).astype(np.uint8), mode="L")
    image.save(path)


def save_overlay(image, mask, path, color=(0, 255, 0), alpha=0.5):
    from PIL import Image

    overlay = render_overlay(image, mask, color=color, alpha=alpha)
    Image.fromarray(overlay).save(path)