import { describe, expect, it } from "vitest";

import { storeCanonicalJson, storeSha256 } from "../src/store-hashing.js";

describe("Store hashing", () => {
  it("recursively orders object keys and hashes the exact projection bytes", () => {
    const projection = {
      z: 3,
      a: { d: 4, b: 2 },
      items: [{ y: true, x: null }],
    };
    const canonical = '{"a":{"b":2,"d":4},"items":[{"x":null,"y":true}],"z":3}';

    expect(storeCanonicalJson(projection)).toBe(canonical);
    expect(storeSha256(storeCanonicalJson(projection))).toBe(
      "12dc95af51411ca994aa51fb9700ebbfc3fba78b3b40d9a3bd55528ec07dcee9",
    );
  });
});
