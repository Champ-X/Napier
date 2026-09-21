export type Quote = { seats: number; allowed: boolean; remaining: number; priceCents: number };

export function parseSeats(raw: string): number {
  return parseInt(raw, 10);
}

export function formatQuote(quote: Quote): string {
  if (!quote.allowed) return `Unavailable; ${quote.remaining} remaining`;
  return `Reserved ${quote.seats} seats; $${quote.priceCents}; ${quote.remaining || "unknown"} remaining`;
}
