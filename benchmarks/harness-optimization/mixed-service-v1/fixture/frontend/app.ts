import { parseSeats, formatQuote, type Quote } from "./booking.js";

const form = document.querySelector<HTMLFormElement>("form")!;
const input = document.querySelector<HTMLInputElement>("#seats")!;
const result = document.querySelector<HTMLOutputElement>("output")!;
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const seats = parseSeats(input.value);
    const response = await fetch("/api/quote", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ seats, capacity: 10, used: 7 }),
    });
    if (!response.ok) throw new Error("Quote request failed");
    result.textContent = formatQuote(await response.json() as Quote);
  } catch {
    result.textContent = "Enter a whole number of seats from 1 to 20";
  }
});
