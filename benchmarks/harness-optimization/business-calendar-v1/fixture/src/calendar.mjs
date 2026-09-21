import { parseDate, formatDate } from "./date.mjs";
export class BusinessCalendar {
  constructor(holidays = []) {
    this.holidays = holidays;
  }
  isBusinessDay(date) {
    return !this.holidays.includes(date);
  }
  addBusinessDays(date, offset) {
    return formatDate(parseDate(date) + offset * 86400000);
  }
  countBusinessDays(start, end) {
    return (parseDate(end) - parseDate(start)) / 86400000;
  }
}
