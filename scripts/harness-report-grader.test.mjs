import { expect, it } from "vitest";
import { validateReport } from "../benchmarks/harness-optimization/requested-report-v1/outcome.mjs";

const input = {
  invoices: [
    { status: "paid", grossCents: 24489, refundCents: 945 },
    { status: "cancelled", grossCents: 10000, refundCents: 9000 },
  ],
};
const report =
  "# Invoice Report — Paid Invoices\n\n- **Paid invoices:** 1\n- **Gross total:** 244.89\n- **Refund total:** 9.45\n- **Net total:** 235.44\n\nExcluded cancelled invoices.";

it("accepts labelled Markdown values even when a heading mentions the same label", () => {
  expect(() => validateReport(input, report)).not.toThrow();
  expect(() =>
    validateReport(
      input,
      report + "\nGross total: sum of paid invoices = 24489 cents = 244.89",
    ),
  ).not.toThrow();
  expect(() =>
    validateReport(
      input,
      report.replaceAll("- **", "| ").replaceAll(":**", " |"),
    ),
  ).not.toThrow();
});

it.each([
  report.replace("invoices:** 1", "invoices:** 11"),
  report.replace("244.89", "1244.89"),
  report.replace("244.89", "244.890"),
  report.replace("244.89", "2,44.89"),
  report.replace("244.89", "344.89"),
  report.replace("235.44", "244.89"),
  report.replace("244.89", "$244.890"),
  report.replace("244.89", "$1244.89"),
  report.replace("invoices:** 1", "invoices:** $1"),
  report + "\nGross total: 100 + 144.89 = $344.89",
  report + "\nGross total: 100 + 144.89 = $244.890",
  report + "\nGross total: 100 + 144.89 = $244.890.",
  report.replace("invoices:** 1", "invoices:** 11 (invoice IDs)"),
  report.replace("244.89", "244.890 (paid records)"),
  report + "\nPaid invoices: 2",
  report.replace("- **Paid invoices:** 1", ""),
])("rejects incorrect, imprecise, contradictory or missing values", (text) => {
  expect(() => validateReport(input, text)).toThrow();
});

it("accepts currency presentation without weakening precision or numeric equality", () => {
  for (const symbol of ["$", "€", "£", "¥"]) {
    expect(() =>
      validateReport(
        input,
        report.replaceAll("total:** ", `total:** ${symbol}`),
      ),
    ).not.toThrow();
  }
});

it("checks the final total in repeated labelled calculations", () => {
  expect(() =>
    validateReport(input, report + "\nGross total: 24489 cents = `244.89`."),
  ).not.toThrow();
  expect(() =>
    validateReport(
      input,
      report +
        "\nGross total: 10000 + 14489 = 24489 cents = $244.89\nNet total: 244.89 − 9.45 = $235.44",
    ),
  ).not.toThrow();
});

it("separates parenthetical annotations from the exact labelled numeric token", () => {
  expect(() =>
    validateReport(
      input,
      report.replace("235.44", "235.44 (= gross minus refunds)"),
    ),
  ).not.toThrow();
  expect(() =>
    validateReport(
      input,
      report.replace("invoices:** 1", "invoices:** 1 (paid records)"),
    ),
  ).not.toThrow();
});
