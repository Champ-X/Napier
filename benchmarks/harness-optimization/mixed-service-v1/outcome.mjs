import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { parseSeats, formatQuote } from "./frontend/booking.ts";
for (let seats = 1; seats <= 20; seats++) {
  assert.equal(parseSeats(` ${seats} `), seats);
  for (const remaining of [0, 1, 9]) {
    assert.equal(formatQuote({seats,allowed:true,remaining,priceCents:seats*1250}), `Reserved ${seats} seats; $${(seats*12.5).toFixed(2)}; ${remaining} remaining`);
    assert.equal(formatQuote({seats,allowed:false,remaining,priceCents:0}), `Unavailable; ${remaining} remaining`);
  }
}
for (const invalid of ["", " ", "0", "01", "21", "-1", "+1", "2.0", "2x", "1e1", "１", "1 2", "9".repeat(100), null, 3])
  assert.throws(() => parseSeats(invalid), TypeError);
const python = spawnSync("/usr/bin/python3", ["-B", "-c", `
from quote import quote
for capacity in [0, 1, 3, 10, 100]:
    for used in range(capacity + 1):
        for seats in range(1, 21):
            available = capacity - used
            allowed = seats <= available
            assert quote(seats, capacity, used) == {"seats": seats, "allowed": allowed, "remaining": available - seats if allowed else available, "priceCents": seats * 1250 if allowed else 0}
for index in range(3):
    for invalid in [True, False, None, "3", 1.0, float("nan"), float("inf"), -1]:
        args = [3, 10, 7]
        args[index] = invalid
        try: quote(*args)
        except ValueError: pass
        else: raise AssertionError(repr(args))
for args in [(0,10,0),(21,100,0),(1,101,0),(1,3,4)]:
    try: quote(*args)
    except ValueError: pass
    else: raise AssertionError(repr(args))
`], {cwd: new URL("./backend/", import.meta.url), encoding:"utf8", timeout:10000});
assert.equal(python.status, 0, python.stderr);
console.log("Independent frontend contract and Python capacity oracle passed");
