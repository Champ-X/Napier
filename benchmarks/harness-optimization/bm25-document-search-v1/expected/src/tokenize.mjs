export function tokenize(text) {
  if (typeof text !== "string") throw new TypeError("Invalid text");
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}
