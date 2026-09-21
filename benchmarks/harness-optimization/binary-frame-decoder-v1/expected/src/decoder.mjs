import { checksum } from "./checksum.mjs";
export class FrameDecoder {
  #max;
  #buffer = new Uint8Array();
  #closed = false;
  constructor(maxPayload = 65536) {
    if (
      !Number.isSafeInteger(maxPayload) ||
      maxPayload < 0 ||
      maxPayload > 1000000
    )
      throw new TypeError("Invalid limit");
    this.#max = maxPayload;
  }
  push(chunk) {
    if (this.#closed) throw new TypeError("Decoder closed");
    try {
      if (!(chunk instanceof Uint8Array)) throw new TypeError("Invalid chunk");
      const bytes = new Uint8Array(this.#buffer.length + chunk.length);
      bytes.set(this.#buffer);
      bytes.set(chunk, this.#buffer.length);
      const view = new DataView(bytes.buffer),
        out = [];
      let offset = 0;
      while (bytes.length - offset >= 4) {
        const length = view.getUint32(offset, false);
        if (length > this.#max) throw new TypeError("Frame too large");
        if (bytes.length - offset < length + 8) break;
        const payload = bytes.slice(offset + 4, offset + 4 + length);
        if (checksum(payload) !== view.getUint32(offset + 4 + length, false))
          throw new TypeError("Checksum mismatch");
        out.push(payload);
        offset += length + 8;
      }
      this.#buffer = bytes.slice(offset);
      return out;
    } catch (error) {
      this.#closed = true;
      this.#buffer = new Uint8Array();
      throw error;
    }
  }
  finish() {
    if (this.#closed) throw new TypeError("Decoder closed");
    this.#closed = true;
    if (this.#buffer.length) throw new TypeError("Incomplete frame");
  }
}
