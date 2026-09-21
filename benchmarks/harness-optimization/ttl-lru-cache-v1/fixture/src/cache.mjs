import { validateTime, deadline } from "./clock.mjs";
export class TtlLruCache {
  constructor(capacity, ttlMs) {
    this.capacity = capacity;
    this.ttlMs = ttlMs;
    this.items = new Map();
    this.time = 0;
  }
  put(key, value, now) {
    this.time = validateTime(now, this.time);
    this.items.set(key, { value, end: deadline(now, this.ttlMs) });
    if (this.items.size > this.capacity) this.items.delete(key);
  }
  get(key, now) {
    this.time = validateTime(now, this.time);
    const item = this.items.get(key);
    return item ? { found: true, value: item.value } : { found: false };
  }
  delete(key, now) {
    this.time = validateTime(now, this.time);
    return this.items.delete(key);
  }
  keys(now) {
    this.time = validateTime(now, this.time);
    return [...this.items.keys()];
  }
  size(now) {
    return this.keys(now).length;
  }
}
