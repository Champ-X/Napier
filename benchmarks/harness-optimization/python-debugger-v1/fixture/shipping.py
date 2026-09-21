def shipping(subtotal, expedited=False):
    if isinstance(subtotal, bool) or not isinstance(subtotal, (int, float)) or subtotal < 0:
        raise ValueError('invalid subtotal')
    base = 0 if subtotal >= 50 else 5
    if subtotal >= 50:
        return base
    return base + (8 if expedited else 0)

if __name__ == '__main__':
    print(shipping(50, True))
