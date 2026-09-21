# Business-day calendar

`parseDate(text)` from src/date.mjs accepts exact YYYY-MM-DD dates in Gregorian
calendar, years 0001..9999. Reject impossible dates, nonstrings, whitespace, extra
characters with TypeError. Return UTC midnight milliseconds since Unix epoch,
including negative values before 1970. `formatDate(ms)` reverses that mapping;
accept only finite integer milliseconds at UTC midnight in that year range,
throw TypeError otherwise. Do not apply local timezone rules.
`BusinessCalendar(holidays=[])` from src/calendar.mjs copies a dense array of valid
date strings; duplicates allowed. Business days are Monday-Friday excluding
holidays. `isBusinessDay(date)` -> boolean. `addBusinessDays(date,offset)` -> date
string; offset must be a safe integer in [-10000,10000]. Offset zero returns the
same valid date even if closed. Nonzero offset excludes start day and walks in
sign direction, counting only business days. Out-of-supported-year results throw
TypeError. `countBusinessDays(start,end)` counts open days in [start,end) for
start<=end; reverse arguments return the negative forward count, equal returns 0.
All arguments validated even if the answer is trivially zero. No mutation or I/O.
