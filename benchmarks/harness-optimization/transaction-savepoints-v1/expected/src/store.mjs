import { cloneJson } from "./value.mjs";
const check = (x) => {
  if (typeof x !== "string" || !x.length) throw new TypeError("Invalid name");
};
const assign = (obj, key, value) =>
  Object.defineProperty(obj, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
export class TransactionStore {
  #data;
  #frames = [];
  constructor(initial = {}) {
    if (
      !initial ||
      typeof initial !== "object" ||
      Array.isArray(initial) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(initial))
    )
      throw new TypeError("Invalid initial state");
    for (const k of Object.keys(initial)) check(k);
    this.#data = cloneJson(initial);
  }
  get(key) {
    check(key);
    return Object.hasOwn(this.#data, key)
      ? { found: true, value: cloneJson(this.#data[key]) }
      : { found: false };
  }
  set(key, value) {
    check(key);
    const owned = cloneJson(value);
    assign(this.#data, key, owned);
  }
  delete(key) {
    check(key);
    const found = Object.hasOwn(this.#data, key);
    delete this.#data[key];
    return found;
  }
  snapshot() {
    return cloneJson(this.#data);
  }
  begin(name) {
    check(name);
    if (this.#frames.some((x) => x.name === name))
      throw new TypeError("Duplicate frame");
    this.#frames.push({ name, data: cloneJson(this.#data) });
  }
  commit() {
    if (!this.#frames.length) throw new TypeError("No frame");
    this.#frames.pop();
  }
  rollback(name) {
    check(name);
    const index = this.#frames.findIndex((x) => x.name === name);
    if (index < 0) throw new TypeError("Unknown frame");
    this.#data = this.#frames[index].data;
    this.#frames.length = index;
  }
  depth() {
    return this.#frames.length;
  }
}
