import { checksum } from "./checksum.mjs";
export class FrameDecoder {
  constructor(maxPayload = 65536) {
    this.max = maxPayload;
  }
  push(chunk) {
    return [chunk.subarray(4, chunk.length - 4)];
  }
  finish() {}
}
