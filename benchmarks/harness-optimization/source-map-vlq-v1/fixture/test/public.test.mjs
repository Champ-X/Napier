import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeVlq } from "../src/vlq.mjs";
import { decodeMappings } from "../src/mappings.mjs";
test("VLQ sign and continuation", () =>
  assert.deepEqual(decodeVlq("ACDgB"), [0, 1, -1, 16]));
test("source-map fields", () =>
  assert.deepEqual(decodeMappings("AAAA;AACA"), [
    {
      generatedLine: 0,
      generatedColumn: 0,
      source: 0,
      originalLine: 0,
      originalColumn: 0,
    },
    {
      generatedLine: 1,
      generatedColumn: 0,
      source: 0,
      originalLine: 1,
      originalColumn: 0,
    },
  ]));
