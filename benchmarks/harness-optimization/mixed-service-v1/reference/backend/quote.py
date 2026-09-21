def quote(seats, capacity, used):
    for value in (seats, capacity, used):
        if not isinstance(value, int) or isinstance(value, bool):
            raise ValueError("integer required")
    if not 1 <= seats <= 20 or not 0 <= capacity <= 100 or not 0 <= used <= capacity:
        raise ValueError("out of range")
    available = capacity - used
    allowed = seats <= available
    return {"seats": seats, "allowed": allowed,
            "remaining": available - seats if allowed else available,
            "priceCents": seats * 1250 if allowed else 0}
