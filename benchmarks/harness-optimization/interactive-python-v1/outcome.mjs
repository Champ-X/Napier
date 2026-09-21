import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const check = spawnSync(
  "/usr/bin/python3",
  [
    "-B",
    "-c",
    `
from shipping import shipping
for value, expected in [(0,5), (49.99,5), (50,0), (50.01,0), (100,0)]:
    assert shipping(value) == expected, value
    assert shipping(value, True) == expected + 8, value
for invalid in [-1, float('nan'), float('inf'), True, '50', None]:
    try: shipping(invalid)
    except ValueError: pass
    else: raise AssertionError(repr(invalid))
`,
  ],
  { cwd: process.cwd(), encoding: "utf8", timeout: 10000 },
);
assert.equal(check.status, 0, check.stderr);
const report = JSON.parse(readFileSync("report.json", "utf8"));
assert.deepEqual(report, {
  samples: [
    { subtotal: 50, expedited: false, shipping: 0 },
    { subtotal: 50, expedited: true, shipping: 8 },
  ],
  processStopped: true,
});
console.log(
  "Boundary, input validation and requested report checks passed; process lifecycle is independently checked from runtime receipts.",
);
