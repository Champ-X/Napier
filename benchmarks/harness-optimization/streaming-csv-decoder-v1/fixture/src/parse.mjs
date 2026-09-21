export function parseCsv(text, maxFieldLength = 100000) {
  return text.split("\n").map((row) => row.split(","));
}
