import assert from "node:assert/strict";
import { decodeVlq } from "./src/vlq.mjs";
import { decodeMappings } from "./src/mappings.mjs";
const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
// Arithmetic encoder independent of bitwise decoder, including signed extremes.
function encode(n) {
  let value = Math.abs(n) * 2 + (n < 0 ? 1 : 0),
    text = "";
  do {
    let digit = value % 32;
    value = Math.floor(value / 32);
    if (value) digit += 32;
    text += alphabet[digit];
  } while (value);
  return text;
}
const values = [
  0, 1, -1, 15, -15, 16, -16, 123456, -123456, 2147483647, -2147483647,
];
assert.deepEqual(decodeVlq(values.map(encode).join("")), values);
for (const input of ["B", "gA", "g", "!", "A\n", encode(2147483648), null, 1])
  assert.throws(() => decodeVlq(input), TypeError);
assert.deepEqual(decodeVlq(""), []);
const segment = (ns) => ns.map(encode).join("");
const mapping =
  [segment([2, 1, 3, 4, 2]), segment([3]), segment([4, 0, 1, -2])].join(",") +
  ";;" +
  [segment([0, -1, -2, 1, -1]), segment([5])].join(",");
assert.deepEqual(decodeMappings(mapping), [
  {
    generatedLine: 0,
    generatedColumn: 2,
    source: 1,
    originalLine: 3,
    originalColumn: 4,
    name: 2,
  },
  { generatedLine: 0, generatedColumn: 5 },
  {
    generatedLine: 0,
    generatedColumn: 9,
    source: 1,
    originalLine: 4,
    originalColumn: 2,
  },
  {
    generatedLine: 2,
    generatedColumn: 0,
    source: 0,
    originalLine: 2,
    originalColumn: 3,
    name: 1,
  },
  { generatedLine: 2, generatedColumn: 5 },
]);
for (const input of [
  "A,",
  ",A",
  "AA",
  "AAA",
  "AAAAAA",
  "A,A",
  "D",
  segment([0, -1, 0, 0]),
  segment([0, 0, -1, 0]),
  segment([0, 0, 0, -1]),
  segment([0, 0, 0, 0, -1]),
  segment([2147483647]) + "," + segment([1]),
  null,
])
  assert.throws(() => decodeMappings(input), TypeError);
assert.deepEqual(decodeMappings(";;"), []);
assert.deepEqual(decodeMappings("A;A"), [
  { generatedLine: 0, generatedColumn: 0 },
  { generatedLine: 1, generatedColumn: 0 },
]);
let seed = 997;
for (let i = 0; i < 1000; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const n = (seed >>> 1) * (seed & 1 ? -1 : 1);
  assert.deepEqual(decodeVlq(encode(n)), [n]);
}
console.log(
  "Canonical VLQ, signed bounds and source-map state transitions passed",
);
