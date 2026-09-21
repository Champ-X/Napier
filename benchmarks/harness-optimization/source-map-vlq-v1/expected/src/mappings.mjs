import { decodeVlq } from "./vlq.mjs";
const valid = (n) => {
  if (!Number.isInteger(n) || n < 0 || n > 2147483647)
    throw new TypeError("Invalid index");
  return n;
};
export function decodeMappings(text) {
  if (typeof text !== "string") throw new TypeError("Invalid mappings");
  const out = [];
  let source = 0,
    originalLine = 0,
    originalColumn = 0,
    name = 0;
  for (const [generatedLine, line] of text.split(";").entries()) {
    if (!line) continue;
    let column = 0,
      previous = -1;
    for (const segment of line.split(",")) {
      const values = decodeVlq(segment);
      if (![1, 4, 5].includes(values.length))
        throw new TypeError("Invalid segment");
      column = valid(column + values[0]);
      if (column <= previous) throw new TypeError("Unordered columns");
      previous = column;
      const item = { generatedLine, generatedColumn: column };
      if (values.length > 1) {
        source = valid(source + values[1]);
        originalLine = valid(originalLine + values[2]);
        originalColumn = valid(originalColumn + values[3]);
        Object.assign(item, { source, originalLine, originalColumn });
      }
      if (values.length === 5) {
        name = valid(name + values[4]);
        item.name = name;
      }
      out.push(item);
    }
  }
  return out;
}
