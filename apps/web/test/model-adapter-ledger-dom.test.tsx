import { describe, expect, it } from "vitest";

import { ModelAdapterLedger } from "../src/ModelContextTraceLedgers";

describe("Model Adapter ledger", () => {
  it("renders policy evidence without raw provider context", () => {
    const tree = ModelAdapterLedger({
      adapters: [
        {
          eventSeq: 21,
          runId: "run_adapter",
          adapterId: "napier.anthropic-messages.v1",
          family: "anthropic",
          adapterVersion: 1,
          modelApi: "anthropic-messages",
          cacheRetention: "long",
          cacheRetentionSource: "adapter",
          contentSha256: "a".repeat(64),
        },
      ],
    });
    const text = visibleText(tree);

    expect(text).toContain("Provider request policies");
    expect(text).toContain("anthropic · v1");
    expect(text).toContain("anthropic-messages");
    expect(text).toContain("long");
    expect(text).toContain("napier.anthropic-messages.v1");
    expect(text).toContain("a".repeat(12));
    expect(text).not.toContain("TOP_SECRET");
  });
});

function visibleText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(visibleText).join("");
  if (!value || typeof value !== "object") return "";
  const props = (value as { props?: { children?: unknown } }).props;
  return props ? visibleText(props.children) : "";
}
