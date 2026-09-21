import assert from "node:assert/strict";
import { parseVersion } from "./src/version.mjs";
import { compareVersions, sortVersions } from "./src/order.mjs";
const order = [
  "1.0.0-alpha",
  "1.0.0-alpha.1",
  "1.0.0-alpha.beta",
  "1.0.0-beta",
  "1.0.0-beta.2",
  "1.0.0-beta.11",
  "1.0.0-rc.1",
  "1.0.0",
];
for (let i = 0; i < order.length; i++)
  for (let j = 0; j < order.length; j++)
    assert.equal(compareVersions(order[i], order[j]), Math.sign(i - j));
for (const v of [
  "",
  null,
  1,
  "v1.2.3",
  " 1.2.3",
  "1.2.3\n",
  "1.2",
  "1.2.3.4",
  "01.2.3",
  "1.02.3",
  "1.2.03",
  "1.2.3-",
  "1.2.3+",
  "1.2.3-a..b",
  "1.2.3+..x",
  "1.2.3-01",
  "1.2.3-a_1",
  "1.2.3-β",
  "1.2.3+x+y",
]) {
  assert.throws(() => parseVersion(v), TypeError);
  assert.throws(() => compareVersions("1.0.0", v), TypeError);
  assert.throws(() => sortVersions([v]), TypeError);
}
assert.equal(
  compareVersions("9007199254740993.0.0", "9007199254740992.0.0"),
  1,
);
assert.equal(
  compareVersions(
    "1.0.0-" + "9".repeat(100),
    "1.0.0-" + ("1" + "0".repeat(100)),
  ),
  -1,
);
assert.equal(compareVersions("1.0.0-Z", "1.0.0-a"), -1);
assert.equal(compareVersions("1.0.0-9", "1.0.0-a"), -1);
assert.equal(compareVersions("1.0.0+1", "1.0.0+2"), 0);
assert.equal(compareVersions("1.0.0--", "1.0.0-0"), 1);
assert.deepEqual(parseVersion("0.0.0-x-y.9+00.A-B"), {
  core: ["0", "0", "0"],
  prerelease: ["x-y", "9"],
  build: ["00", "A-B"],
});
const values = Object.freeze([
  "2.0.0",
  "1.0.0+b",
  "1.0.0+a",
  "1.0.0-beta",
  "1.0.0+c",
]);
assert.deepEqual(sortVersions(values), [
  "1.0.0-beta",
  "1.0.0+b",
  "1.0.0+a",
  "1.0.0+c",
  "2.0.0",
]);
assert.throws(() => sortVersions(Array(1)), TypeError);
assert.throws(() => sortVersions("1.0.0"), TypeError);
const descending = Array.from(
  { length: 80 },
  (_, i) => `${BigInt("999999999999999999999999") + BigInt(79 - i)}.2.3`,
);
assert.deepEqual(sortVersions(descending), [...descending].reverse());
console.log("Strict syntax, exact arithmetic and stable precedence passed");
