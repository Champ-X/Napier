import { test } from "node:test";
import assert from "node:assert/strict";
import { BusinessCalendar } from "../src/calendar.mjs";
import { parseDate } from "../src/date.mjs";
test("skip weekend and holiday", () => {
  const c = new BusinessCalendar(["2024-01-01"]);
  assert.equal(c.addBusinessDays("2023-12-29", 1), "2024-01-02");
  assert.equal(c.countBusinessDays("2023-12-29", "2024-01-03"), 2);
});
test("reject normalized impossible dates", () =>
  assert.throws(() => parseDate("2024-02-30"), TypeError));
