export type Quote = { seats: number; allowed: boolean; remaining: number; priceCents: number };
export function parseSeats(raw: string): number {
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw.trim())) throw new TypeError("Invalid seats");
  const seats = Number(raw.trim());
  if (!Number.isSafeInteger(seats) || seats < 1 || seats > 20) throw new TypeError("Invalid seats");
  return seats;
}
export function formatQuote(quote: Quote): string {
  if (!quote.allowed) return `Unavailable; ${quote.remaining} remaining`;
  return `Reserved ${quote.seats} seats; $${(quote.priceCents / 100).toFixed(2)}; ${quote.remaining} remaining`;
}
