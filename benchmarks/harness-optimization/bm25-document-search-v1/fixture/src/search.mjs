import { tokenize } from "./tokenize.mjs";
export class SearchIndex {
  constructor(documents = []) {
    this.docs = documents;
  }
  upsert(document) {
    this.docs.push(document);
  }
  delete(id) {
    const i = this.docs.findIndex((d) => d.id === id);
    if (i < 0) return false;
    this.docs.splice(i, 1);
    return true;
  }
  search(query, limit = 10) {
    return this.docs
      .filter((d) => tokenize(d.text).includes(query))
      .slice(0, limit)
      .map((d) => ({ id: d.id, score: 1 }));
  }
}
