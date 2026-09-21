import { test } from "node:test";
import assert from "node:assert/strict";
import { checksum } from "../src/checksum.mjs";
import { FrameDecoder } from "../src/decoder.mjs";
test("CRC32 golden vector", () =>
  assert.equal(checksum(new TextEncoder().encode("123456789")), 0xcbf43926));
test("fragmented empty frame", () => {
  const d = new FrameDecoder();
  assert.deepEqual(d.push(new Uint8Array(3)), []);
  assert.deepEqual(d.push(new Uint8Array(5)), [new Uint8Array()]);
  assert.equal(d.finish(), undefined);
});
