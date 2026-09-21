import { tokenize } from "./tokenize.mjs";
const idCheck = (id) => {
  if (typeof id !== "string" || !id.length) throw new TypeError("Invalid ID");
};
function prepared(doc) {
  if (
    !doc ||
    typeof doc !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(doc))
  )
    throw new TypeError("Invalid document");
  idCheck(doc.id);
  return { id: doc.id, tokens: tokenize(doc.text) };
}
export class SearchIndex {
  #docs = new Map();
  constructor(documents = []) {
    if (!Array.isArray(documents)) throw new TypeError("Invalid documents");
    for (let i = 0; i < documents.length; i++) {
      if (!Object.hasOwn(documents, i)) throw new TypeError("Sparse documents");
      const doc = prepared(documents[i]);
      if (this.#docs.has(doc.id)) throw new TypeError("Duplicate ID");
      this.#docs.set(doc.id, doc.tokens);
    }
  }
  upsert(document) {
    const doc = prepared(document);
    this.#docs.set(doc.id, doc.tokens);
  }
  delete(id) {
    idCheck(id);
    return this.#docs.delete(id);
  }
  search(query, limit = 10) {
    const terms = [...new Set(tokenize(query))];
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 1000)
      throw new TypeError("Invalid limit");
    if (!terms.length || !this.#docs.size || limit === 0) return [];
    const n = this.#docs.size,
      total = [...this.#docs.values()].reduce((sum, t) => sum + t.length, 0);
    if (!total) return [];
    const avg = total / n,
      dfs = new Map(
        terms.map((term) => [
          term,
          [...this.#docs.values()].filter((tokens) => tokens.includes(term))
            .length,
        ]),
      ),
      results = [];
    for (const [id, tokens] of this.#docs) {
      let score = 0;
      for (const term of terms) {
        const tf = tokens.filter((t) => t === term).length;
        if (!tf) continue;
        const df = dfs.get(term),
          idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score +=
          (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * tokens.length) / avg));
      }
      if (score > 0) results.push({ id, score });
    }
    results.sort(
      (a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    return results.slice(0, limit);
  }
}
