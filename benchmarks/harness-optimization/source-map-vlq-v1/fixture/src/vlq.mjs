export function decodeVlq(text) {
  return [...text].map((c) =>
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(
      c,
    ),
  );
}
