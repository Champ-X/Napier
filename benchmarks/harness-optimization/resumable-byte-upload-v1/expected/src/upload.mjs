import { checkChunk } from "./chunk.mjs";
export class UploadBuffer {
  #data;
  #seen;
  #count = 0;
  constructor(total) {
    if (!Number.isSafeInteger(total) || total < 1 || total > 1000000)
      throw new TypeError("Invalid total");
    this.#data = new Uint8Array(total);
    this.#seen = new Uint8Array(total);
  }
  write(offset, bytes) {
    checkChunk(this.#data.length, offset, bytes);
    for (let i = 0; i < bytes.length; i++)
      if (this.#seen[offset + i] && this.#data[offset + i] !== bytes[i])
        throw new TypeError("Conflicting chunk");
    let added = 0;
    for (let i = 0; i < bytes.length; i++)
      if (!this.#seen[offset + i]) {
        this.#seen[offset + i] = 1;
        this.#data[offset + i] = bytes[i];
        added++;
      }
    this.#count += added;
    return added;
  }
  missing() {
    const ranges = [];
    let i = 0;
    while (i < this.#seen.length) {
      if (this.#seen[i]) {
        i++;
        continue;
      }
      const start = i;
      while (i < this.#seen.length && !this.#seen[i]) i++;
      ranges.push([start, i]);
    }
    return ranges;
  }
  complete() {
    return this.#count === this.#data.length;
  }
  finish() {
    if (!this.complete()) throw new TypeError("Incomplete upload");
    return this.#data.slice();
  }
}
