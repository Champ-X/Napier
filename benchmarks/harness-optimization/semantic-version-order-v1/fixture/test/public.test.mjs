import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVersion } from "../src/version.mjs";
import { compareVersions, sortVersions } from "../src/order.mjs";
test("prerelease precedes release and metadata is parsed", () => {
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
  assert.deepEqual(parseVersion("1.2.3-alpha.4+build.007"), {
    core: ["1", "2", "3"],
    prerelease: ["alpha", "4"],
    build: ["build", "007"],
  });
});
test("stable sorting does not mutate callers", () => {
  const a = ["1.2.0", "1.0.0+x", "1.0.0+y"];
  assert.deepEqual(sortVersions(a), ["1.0.0+x", "1.0.0+y", "1.2.0"]);
  assert.equal(a[0], "1.2.0");
});
