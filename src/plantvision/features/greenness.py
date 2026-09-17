import numpy as np


def _as_float(r, g, b):
    return (
        np.asarray(r, dtype=float),
        np.asarray(g, dtype=float),
        np.asarray(b, dtype=float),
    )


def green_ratio(r, g, b):
    r_arr, g_arr, b_arr = _as_float(r, g, b)
    denominator = r_arr + g_arr + b_arr
    value = np.divide(
        g_arr, denominator, out=np.zeros_like(denominator), where=denominator > 0
    )
    return float(np.mean(value))


def excess_green(r, g, b):
    r_arr, g_arr, b_arr = _as_float(r, g, b)
    return float(np.mean(2 * g_arr - r_arr - b_arr))


def channel_ratio(numerator, denominator):
    num = np.asarray(numerator, dtype=float)
    den = np.asarray(denominator, dtype=float)
    value = np.divide(num, den, out=np.zeros_like(num), where=den > 0)
    return float(np.mean(value))