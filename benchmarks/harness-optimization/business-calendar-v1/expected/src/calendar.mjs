import { parseDate, formatDate } from "./date.mjs";
const day = 86400000;
export class BusinessCalendar {
  #holidays;
  constructor(holidays = []) {
    if (!Array.isArray(holidays)) throw new TypeError("Invalid holidays");
    this.#holidays = new Set();
    for (let i = 0; i < holidays.length; i++) {
      if (!Object.hasOwn(holidays, i)) throw new TypeError("Sparse holidays");
      parseDate(holidays[i]);
      this.#holidays.add(holidays[i]);
    }
  }
  #open(ms) {
    const weekday = new Date(ms).getUTCDay();
    return (
      weekday !== 0 && weekday !== 6 && !this.#holidays.has(formatDate(ms))
    );
  }
  isBusinessDay(date) {
    return this.#open(parseDate(date));
  }
  addBusinessDays(date, offset) {
    let ms = parseDate(date);
    if (!Number.isSafeInteger(offset) || Math.abs(offset) > 10000)
      throw new TypeError("Invalid offset");
    const direction = Math.sign(offset);
    let left = Math.abs(offset);
    while (left) {
      ms += direction * day;
      formatDate(ms);
      if (this.#open(ms)) left--;
    }
    return formatDate(ms);
  }
  countBusinessDays(start, end) {
    let a = parseDate(start),
      b = parseDate(end);
    if (a === b) return 0;
    const sign = a < b ? 1 : -1;
    if (sign < 0) [a, b] = [b, a];
    let count = 0;
    for (let ms = a; ms < b; ms += day) if (this.#open(ms)) count++;
    return sign * count;
  }
}
