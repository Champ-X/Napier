import assert from "node:assert/strict";
import { parseCsv } from "./src/parse.mjs";
import { CsvDecoder } from "./src/decoder.mjs";
const samples = [
  ["", []],
  ["\n", [[""]]],
  ["\r\n", [[""]]],
  ["a,", [["a", ""]]],
  ['""', [[""]]],
  [
    '"a\r\nb",c\r\nx,y\n',
    [
      ["a\r\nb", "c"],
      ["x", "y"],
    ],
  ],
  ["a\rb\r\nc\n", [["a"], ["b"], ["c"]]],
  ['"a""b", 😀\n', [['a"b', " 😀"]]],
];
for (const [text, expected] of samples) {
  assert.deepEqual(parseCsv(text), expected);
  for (let split = 0; split <= text.length; split++) {
    const d = new CsvDecoder(),
      rows = [
        ...d.push(text.slice(0, split)),
        ...d.push(""),
        ...d.push(text.slice(split)),
        ...d.finish(),
      ];
    assert.deepEqual(rows, expected);
  }
  const d = new CsvDecoder();
  let rows = [];
  for (const char of text) rows.push(...d.push(char));
  rows.push(...d.finish());
  assert.deepEqual(rows, expected);
}
for (const text of ['a"b', '"a"b', '"a" ', '"a', 'a,"b'])
  assert.throws(() => parseCsv(text), TypeError);
for (const n of [-1, 1.2, Infinity, "3", 1000001])
  assert.throws(() => new CsvDecoder(n), TypeError);
assert.deepEqual(parseCsv('"",', 0), [["", ""]]);
assert.throws(() => parseCsv("😀", 1), TypeError);
assert.deepEqual(parseCsv('"a""b"', 3), [['a"b']]);
const d = new CsvDecoder(2);
assert.deepEqual(d.push("ab"), []);
assert.throws(() => d.push("c"), TypeError);
assert.throws(() => d.finish(), TypeError);
const invalid = new CsvDecoder();
assert.throws(() => invalid.push(null), TypeError);
assert.throws(() => invalid.push(""), TypeError);
// Independently generate CSV from arbitrary string tables; round-trip at each chunk size.
const table = Array.from({ length: 30 }, (_, i) => [
  String(i),
  ["a,b", '"x"', "a\r\nb", "", "😀"][i % 5],
]);
const csv = table
  .map((row) => row.map((s) => '"' + s.replaceAll('"', '""') + '"').join(","))
  .join("\r\n");
for (const size of [1, 2, 7, 13, 64]) {
  const decoder = new CsvDecoder(),
    rows = [];
  for (let i = 0; i < csv.length; i += size)
    rows.push(...decoder.push(csv.slice(i, i + size)));
  rows.push(...decoder.finish());
  assert.deepEqual(rows, table);
}
console.log(
  "CSV quoting, chunk boundaries, field bounds and round trips passed",
);
