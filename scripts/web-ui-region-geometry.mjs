/** Rectangles may share an axis when the header uses multiple grid rows. */
export function regionsDoNotOverlap(regions, tolerance = 1) {
  return regions.every((region, index) =>
    regions
      .slice(index + 1)
      .every((other) => regionSeparation(region, other) >= -tolerance),
  );
}

/** Negative only when rectangles intersect on both axes. */
export function regionSeparation(left, right) {
  return Math.max(
    right.left - left.right,
    left.left - right.right,
    right.top - left.bottom,
    left.top - right.bottom,
  );
}
