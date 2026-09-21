import { checkChunk } from "./chunk.mjs";
export class UploadBuffer {
  constructor(total) {
    this.total = total;
    this.data = new Uint8Array(total);
    this.count = 0;
  }
  write(offset, bytes) {
    checkChunk(this.total, offset, bytes);
    this.data.set(bytes, offset);
    this.count += bytes.length;
    return bytes.length;
  }
  missing() {
    return this.count >= this.total ? [] : [[this.count, this.total]];
  }
  complete() {
    return this.count >= this.total;
  }
  finish() {
    return this.data;
  }
}
