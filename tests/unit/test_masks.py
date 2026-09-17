import numpy as np
import pytest

from plantvision import SegmentationError
from plantvision.segmentation.mask import (
    merge_masks,
    resize_mask,
    validate_mask,
)


def test_merge_masks_combines():
    a = np.array([[False, True], [False, False]])
    b = np.array([[True, False], [False, True]])
    merged = merge_masks([a, b])
    assert merged.tolist() == [[True, True], [False, True]]
    assert merged.dtype == bool


def test_merge_masks_skips_wrong_shape():
    good = np.ones((2, 2), dtype=bool)
    bad = np.ones((3, 3), dtype=bool)
    merged = merge_masks([good, bad])
    assert merged.shape == (2, 2)
    assert merged.all()


def test_merge_masks_requires_shape():
    with pytest.raises(SegmentationError, match="Cannot determine mask shape"):
        merge_masks([])


def test_validate_mask_wrong_shape():
    with pytest.raises(SegmentationError, match="does not match"):
        validate_mask(np.zeros((2, 2), dtype=bool), (3, 3))


def test_validate_mask_non_2d():
    with pytest.raises(SegmentationError, match="must be 2D"):
        validate_mask(np.zeros((2, 2, 3), dtype=bool), (2, 2))


def test_resize_mask_identity():
    mask = np.zeros((5, 6), dtype=bool)
    mask[2, 3] = True
    assert np.array_equal(resize_mask(mask, (5, 6)), mask)


def test_resize_mask_upscale_to_original():
    small = np.zeros((2, 3), dtype=bool)
    small[0, 1] = True
    resized = resize_mask(small, (6, 9))
    assert resized.shape == (6, 9)
    assert resized.dtype == bool
    assert resized[0, 3] == True  # noqa: E712
    assert resized[0, 0] == False  # noqa: E712


def test_resize_mask_downscale():
    big = np.ones((16, 16), dtype=bool)
    resized = resize_mask(big, (4, 4))
    assert resized.shape == (4, 4)
    assert resized.all()


def test_mismatched_mask_is_resized_then_merged():
    target_shape = (360, 480)
    squared = np.zeros((640, 640), dtype=bool)
    squared[300:340, 300:340] = True
    resized = resize_mask(squared, target_shape)
    combined = merge_masks([resized], target_shape)
    assert combined.shape == target_shape
    assert int(combined.sum()) > 0