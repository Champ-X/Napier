import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSeats, formatQuote } from "./booking.ts";
test("parses whole seat counts", () => {
  assert.equal(parseSeats(" 3 "), 3);
  assert.throws(() => parseSeats("3x"), TypeError);
  assert.throws(() => parseSeats("0"), TypeError);
});
test("formats cents and zero capacity", () => {
  assert.equal(formatQuote({seats:3,allowed:true,remaining:0,priceCents:3750}), "Reserved 3 seats; $37.50; 0 remaining");
  assert.equal(formatQuote({seats:4,allowed:false,remaining:3,priceCents:0}), "Unavailable; 3 remaining");
});
