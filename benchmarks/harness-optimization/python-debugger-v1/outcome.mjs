import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const checked = spawnSync(
  "/usr/bin/python3",
  [
    "-B",
    "-c",
    `
from shipping import shipping
for subtotal, expedited, expected in [(0,False,5),(49.99,True,13),(50,False,0),(50,True,8),(80,True,8)]:
    assert shipping(subtotal, expedited) == expected, (subtotal, expedited)
for invalid in [-1, True, '50', None]:
    try: shipping(invalid)
    except (ValueError, TypeError): pass
    else: raise AssertionError('invalid subtotal accepted')
`,
  ],
  { cwd: process.cwd(), encoding: "utf8", timeout: 10000 },
);
assert.equal(checked.status, 0, checked.stderr);
assert.deepEqual(JSON.parse(readFileSync("report.json", "utf8")), {
  observed: { subtotal: 50, expedited: true, base: 0, evaluation: 8 },
  debuggerStopped: true,
});
console.log(
  "Shipping behavior and report passed; original-source DAP observations are independently checked from invocation capsules.",
);
