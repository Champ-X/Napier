import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export function validateReport(input, text) {
  const paid = input.invoices.filter((invoice) => invoice.status === "paid");
  const sum = (key) => paid.reduce((total, invoice) => total + invoice[key], 0);
  const expected = {
    "Paid invoices": String(paid.length),
    "Gross total": (sum("grossCents") / 100).toFixed(2),
    "Refund total": (sum("refundCents") / 100).toFixed(2),
    "Net total": ((sum("grossCents") - sum("refundCents")) / 100).toFixed(2),
  };
  const lines = text.replaceAll("*", "").replaceAll("`", "").split(/\r?\n/u);
  for (const [label, value] of Object.entries(expected)) {
    // Match a labelled value, not an earlier heading mentioning the label.
    // Require the entire numeric token; substring matches accept 19 for 9.
    const field = new RegExp(
      "^\\s*(?:[-+]\\s+|\\|\\s*)?" +
        label +
        "\\s*(?::|\\|)\\s*(.*?)\\s*(?:\\|)?\\s*$",
      "iu",
    );
    const entries = lines.flatMap((line) => {
      const match = line.match(field);
      // A later calculation paragraph may reuse the label followed by prose.
      // Numeric field values must still agree, including repeated summaries.
      return match && /^(?:[+-]?\d|[$€£¥])/u.test(match[1].trim())
        ? [match[1].trim()]
        : [];
    });
    assert.ok(entries.length, label + " missing");
    for (const entry of entries) {
      // An optional parenthetical annotation is prose outside the labelled
      // value; remove it before interpreting equality signs in calculations.
      const labelled = entry
        .replace(/[.;。]$/u, "")
        .replace(/\s+\([^()\r\n]*\)$/u, "")
        .trim();
      // Calculation lines may follow a labelled summary. Their final equality
      // is the reported total; do not mistake the first operand for that total.
      const result = labelled.includes("=")
        ? labelled.split("=").at(-1).trim()
        : labelled;
      const presented = result.replace(/[.;。]$/u, "").trim();
      const numeric =
        label === "Paid invoices"
          ? presented
          : presented.replace(/^[$€£¥]\s*/u, "");
      assert.match(
        numeric,
        /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/u,
        label + " malformed",
      );
      assert.equal(numeric.replaceAll(",", ""), value, label + " incorrect");
    }
  }
  assert.match(text, /cancelled/iu);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  validateReport(
    JSON.parse(readFileSync("input.json", "utf8")),
    readFileSync("REPORT.md", "utf8"),
  );
  console.log("Requested report calculations and exclusion explanation passed");
}
