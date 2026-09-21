import { validateTime, deadline } from "./clock.mjs";
const keyCheck = (key) => {
  if (typeof key !== "string" || !key.length)
    throw new TypeError("Invalid key");
};
export class TtlLruCache {
  #items = new Map();
  #now = 0;
  #capacity;
  #ttl;
  constructor(capacity, ttlMs) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0)
      throw new TypeError("Invalid capacity");
    deadline(0, ttlMs);
    this.#capacity = capacity;
    this.#ttl = ttlMs;
  }
  #advance(now) {
    validateTime(now, this.#now);
    this.#now = now;
    for (const [key, item] of this.#items)
      if (item.end <= now) this.#items.delete(key);
  }
  put(key, value, now) {
    keyCheck(key);
    validateTime(now, this.#now);
    const end = deadline(now, this.#ttl);
    this.#advance(now);
    this.#items.delete(key);
    if (this.#ttl === 0) return;
    this.#items.set(key, { value, end });
    while (this.#items.size > this.#capacity)
      this.#items.delete(this.#items.keys().next().value);
  }
  get(key, now) {
    keyCheck(key);
    this.#advance(now);
    const item = this.#items.get(key);
    if (!item) return { found: false };
    this.#items.delete(key);
    this.#items.set(key, item);
    return { found: true, value: item.value };
  }
  delete(key, now) {
    keyCheck(key);
    this.#advance(now);
    return this.#items.delete(key);
  }
  keys(now) {
    this.#advance(now);
    return [...this.#items.keys()];
  }
  size(now) {
    this.#advance(now);
    return this.#items.size;
  }
}
