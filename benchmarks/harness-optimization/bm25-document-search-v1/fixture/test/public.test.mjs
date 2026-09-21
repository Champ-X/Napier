import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/tokenize.mjs";
import { SearchIndex } from "../src/search.mjs";
test("Unicode normalization and punctuation", () =>
  assert.deepEqual(tokenize("ＦＯＯ, Bar 42"), ["foo", "bar", "42"]));
test("upsert replaces text", () => {
  const s = new SearchIndex([{ id: "a", text: "red" }]);
  s.upsert({ id: "a", text: "blue" });
  assert.deepEqual(s.search("red"), []);
  assert.equal(s.search("blue")[0].id, "a");
});
