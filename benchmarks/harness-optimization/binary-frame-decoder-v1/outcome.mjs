import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { checksum } from "./src/checksum.mjs";
import { FrameDecoder } from "./src/decoder.mjs";
// Independent standard-library CRC oracle, also used to build wire frames.
const check = spawnSync(
  "/usr/bin/python3",
  [
    "-B",
    "-c",
    "import zlib,json; print(json.dumps([zlib.crc32(bytes(range(n))) for n in range(100)]))",
  ],
  { encoding: "utf8" },
);
assert.equal(check.status, 0);
const crcs = JSON.parse(check.stdout);
const frames = [];
for (let n = 0; n < 100; n++) {
  const payload = Uint8Array.from({ length: n }, (_, i) => i);
  assert.equal(checksum(payload), crcs[n]);
  if (n % 11 === 0) {
    const wire = Buffer.alloc(n + 8);
    wire.writeUInt32BE(n);
    wire.set(payload, 4);
    wire.writeUInt32BE(crcs[n], n + 4);
    frames.push({ wire, payload });
  }
}
const wire = Buffer.concat(frames.map((x) => x.wire));
for (const step of [1, 2, 3, 7, 31, wire.length]) {
  const d = new FrameDecoder(100),
    out = [];
  for (let i = 0; i < wire.length; i += step)
    out.push(...d.push(wire.subarray(i, i + step)));
  d.finish();
  assert.deepEqual(
    out,
    frames.map((x) => x.payload),
  );
  assert.throws(() => d.push(new Uint8Array()), TypeError);
}
for (const bad of [-1, 1.5, 1000001, "1"])
  assert.throws(() => new FrameDecoder(bad), TypeError);
assert.throws(() => checksum([]), TypeError);
const large = new FrameDecoder(0);
assert.throws(() => large.push(new Uint8Array([0, 0, 0, 1])), TypeError);
assert.throws(() => large.finish(), TypeError);
const corrupt = Buffer.from(frames[1].wire);
corrupt[5] ^= 1;
const bad = new FrameDecoder();
assert.throws(() => bad.push(corrupt), TypeError);
assert.throws(() => bad.push(new Uint8Array()), TypeError);
for (let size = 1; size < frames[1].wire.length; size++) {
  const d = new FrameDecoder();
  d.push(frames[1].wire.subarray(0, size));
  assert.throws(() => d.finish(), TypeError);
}
const own = new FrameDecoder(),
  input = Buffer.from(frames[1].wire);
own.push(input.subarray(0, 7));
input[4] = 99;
const result = own.push(input.subarray(7));
assert.equal(result[0][0], 0);
result[0][0] = 9;
assert.equal(input[4], 99);
console.log(
  "Standard CRC oracle, fragmentation, poisoning and buffer ownership passed",
);
