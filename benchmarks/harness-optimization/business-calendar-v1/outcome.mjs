import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { parseDate, formatDate } from "./src/date.mjs";
import { BusinessCalendar } from "./src/calendar.mjs";
for (const v of [
  "0000-01-01",
  "1900-02-29",
  "2100-02-29",
  "2024-02-30",
  "2024-13-01",
  "2024-00-01",
  "2024-01-00",
  "2024-1-01",
  "2024-01-01\n",
  " 2024-01-01",
  null,
  0,
])
  assert.throws(() => parseDate(v), TypeError);
for (const v of [1, NaN, Infinity, "0", -62135683200000, 253402300800000])
  assert.throws(() => formatDate(v), TypeError);
for (const v of [
  "0001-01-01",
  "0099-12-31",
  "1600-02-29",
  "2000-02-29",
  "9999-12-31",
])
  assert.equal(formatDate(parseDate(v)), v);
const holidays = ["2024-01-01", "2024-02-29", "2024-02-29"],
  c = new BusinessCalendar(holidays);
holidays.push("2024-01-02");
assert.equal(c.isBusinessDay("2024-01-02"), true);
assert.equal(c.addBusinessDays("2024-01-06", 0), "2024-01-06");
assert.equal(c.addBusinessDays("2024-01-02", -1), "2023-12-29");
for (const n of [1.5, NaN, "1", 10001])
  assert.throws(() => c.addBusinessDays("2024-01-01", n), TypeError);
assert.throws(() => new BusinessCalendar(Array(1)), TypeError);
assert.throws(() => c.addBusinessDays("9999-12-31", 1), TypeError);
assert.throws(() => c.addBusinessDays("0001-01-01", -1), TypeError);
const oracle = spawnSync(
  "/usr/bin/python3",
  [
    "-B",
    "-c",
    String.raw`
import datetime,json
base=datetime.date(2023,12,20);holidays={datetime.date(2024,1,1),datetime.date(2024,2,29)}
rows=[]
for i in range(90):
 d=base+datetime.timedelta(days=i);n=i%15-7;x=d;left=abs(n)
 while left:
  x+=datetime.timedelta(days=1 if n>0 else -1)
  if x.weekday()<5 and x not in holidays:left-=1
 count=sum((base+datetime.timedelta(days=j)).weekday()<5 and (base+datetime.timedelta(days=j)) not in holidays for j in range(i))
 rows.append([d.isoformat(),n,x.isoformat(),count])
print(json.dumps(rows))
`,
  ],
  { encoding: "utf8" },
);
assert.equal(oracle.status, 0, oracle.stderr);
for (const [date, n, result, count] of JSON.parse(oracle.stdout)) {
  assert.equal(c.addBusinessDays(date, n), result);
  assert.equal(c.countBusinessDays("2023-12-20", date), count);
  assert.equal(
    c.countBusinessDays(date, "2023-12-20"),
    count === 0 ? 0 : -count,
  );
}
console.log(
  "Gregorian dates, UTC boundaries and independent calendar oracle passed",
);
