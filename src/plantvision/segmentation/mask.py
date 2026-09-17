import numpy as np

from plantvision import SegmentationError


def merge_masks(masks, shape=None):
    if shape is None:
        source = masks[0] if masks else None
        shape = np.asarray(source).shape if source is not None else None
    if shape is None:
        raise SegmentationError("Cannot determine mask shape.")
    combined = np.zeros(shape, dtype=bool)
    for mask in masks:
        mask_array = np.asarray(mask)
        if mask_array.shape != tuple(shape):
            continue
        combined |= mask_array.astype(bool)
    return combined


def validate_mask(mask, image_shape):
    mask_array = np.asarray(mask)
    if mask_array.ndim != 2:
        raise SegmentationError(
            f"Mask must be 2D, got {mask_array.ndim}D with shape {mask_array.shape}"
        )
    if tuple(mask_array.shape) != tuple(image_shape):
        raise SegmentationError(
            f"Mask shape {mask_array.shape} does not match image shape {tuple(image_shape)}"
        )
    return mask_array.astype(bool)


def resize_mask(mask, shape):
    from PIL import Image

    mask_array = np.asarray(mask)
    if mask_array.ndim != 2:
        raise SegmentationError(
            f"Cannot resize a non-2D mask; got shape {mask_array.shape}"
        )
    image = Image.fromarray((mask_array.astype(bool) * 255).astype(np.uint8), mode="L")
    resized = image.resize((int(shape[1]), int(shape[0])), Image.NEAREST)
    return np.asarray(resized) > 127