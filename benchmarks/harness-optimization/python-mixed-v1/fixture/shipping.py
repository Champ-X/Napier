import math


def shipping(subtotal, expedited=False):
    if isinstance(subtotal, bool) or not isinstance(subtotal, (int, float)) or not math.isfinite(subtotal) or subtotal < 0:
        raise ValueError("subtotal must be a finite nonnegative number")
    base = 0 if subtotal > 50 else 5
    return base + (8 if expedited else 0)
