import assert from "node:assert/strict";
import { tokenize } from "./src/tokenize.mjs";
import { SearchIndex } from "./src/search.mjs";
assert.deepEqual(tokenize("Ｃafé café 中文 ① + 😀"), [
  "café",
  "café",
  "中文",
  "1",
]);
assert.throws(() => tokenize(null), TypeError);
for (const docs of [
  Array(1),
  [
    { id: "a", text: "" },
    { id: "a", text: "x" },
  ],
  [{ id: "", text: "x" }],
  [{ id: "a", text: null }],
  {},
])
  assert.throws(() => new SearchIndex(docs), TypeError);
const doc = { id: "__proto__", text: "x x" },
  s = new SearchIndex([
    doc,
    { id: "a", text: "x x" },
    { id: "empty", text: "" },
  ]);
doc.text = "changed";
assert.deepEqual(
  s.search("x").map((d) => d.id),
  ["__proto__", "a"],
);
assert.deepEqual(s.search("x x"), s.search("x"));
const before = s.search("x");
assert.throws(() => s.upsert({ id: "a", text: 1 }), TypeError);
assert.deepEqual(s.search("x"), before);
for (const limit of [-1, 1.5, 1001, "2"])
  assert.throws(() => s.search("", limit), TypeError);
assert.throws(() => s.delete(""), TypeError);
assert.equal(s.delete("missing"), false);
// Independent token-frequency corpus and algebraically rearranged BM25 scorer.
let corpus = new Map(),
  seed = 772;
const index = new SearchIndex();
function expected(query) {
  const ts = [...new Set(query.split(" ").filter(Boolean))],
    n = corpus.size,
    avg = [...corpus.values()].reduce((a, b) => a + b.length, 0) / n;
  if (!avg) return [];
  const results = [];
  for (const [id, tokens] of corpus) {
    let score = 0;
    for (const term of ts) {
      const tf = tokens.reduce((sum, t) => sum + (t === term), 0);
      if (!tf) continue;
      let df = 0;
      for (const text of corpus.values()) if (new Set(text).has(term)) df++;
      score +=
        (Math.log((n + 1) / (df + 0.5)) * 2.2) /
        (1 + (1.2 / tf) * (0.25 + (0.75 * tokens.length) / avg));
    }
    if (score > 0) results.push({ id, score });
  }
  return results.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}
for (let i = 0; i < 120; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const id = "d" + (seed % 12);
  if (seed % 4 === 0) {
    assert.equal(index.delete(id), corpus.delete(id));
  } else {
    const tokens = Array.from(
      { length: (seed >>> 6) % 10 },
      (_, j) => ["red", "blue", "green"][(seed + j) % 3],
    );
    corpus.set(id, tokens);
    index.upsert({ id, text: tokens.join(" ") });
  }
  const query = i % 2 ? "red blue red" : "green",
    want = expected(query),
    got = index.search(query, 1000);
  assert.deepEqual(
    got.map((x) => x.id),
    want.map((x) => x.id),
  );
  for (let j = 0; j < got.length; j++)
    assert.ok(Math.abs(got[j].score - want[j].score) < 1e-12);
  assert.deepEqual(index.search(query, 1), got.slice(0, 1));
}
console.log(
  "Unicode terms, mutable corpus statistics and BM25 score oracle passed",
);
