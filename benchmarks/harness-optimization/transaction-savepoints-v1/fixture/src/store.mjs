import { cloneJson } from "./value.mjs";
export class TransactionStore {
  constructor(initial = {}) {
    this.data = cloneJson(initial);
    this.frames = [];
  }
  get(key) {
    return key in this.data
      ? { found: true, value: this.data[key] }
      : { found: false };
  }
  set(key, value) {
    this.data[key] = cloneJson(value);
  }
  delete(key) {
    const found = key in this.data;
    delete this.data[key];
    return found;
  }
  snapshot() {
    return this.data;
  }
  begin(name) {
    this.frames.push({ name, data: this.data });
  }
  commit() {
    this.frames = [];
  }
  rollback(name) {
    const frame = this.frames.find((x) => x.name === name);
    if (frame) this.data = frame.data;
    this.frames = [];
  }
  depth() {
    return this.frames.length;
  }
}
