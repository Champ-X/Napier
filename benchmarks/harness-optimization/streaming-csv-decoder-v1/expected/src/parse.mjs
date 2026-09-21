import { CsvDecoder } from "./decoder.mjs";
export function parseCsv(text, maxFieldLength = 100000) {
  const d = new CsvDecoder(maxFieldLength);
  return [...d.push(text), ...d.finish()];
}
