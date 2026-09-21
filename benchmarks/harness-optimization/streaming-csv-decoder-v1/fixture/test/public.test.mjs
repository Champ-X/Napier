import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/parse.mjs";
import { CsvDecoder } from "../src/decoder.mjs";
test("quoted commas and quotes", () =>
  assert.deepEqual(parseCsv('a,"b,c","d""e"\r\n'), [["a", "b,c", 'd"e']]));
test("rows are emitted before finish", () => {
  const d = new CsvDecoder();
  assert.deepEqual(d.push("a,b\n"), [["a", "b"]]);
  assert.deepEqual(d.finish(), []);
});
