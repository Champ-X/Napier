import type {
  ContextCheckpointCalibrationReport,
  ContextCheckpointSnapshot,
  UsagePriceTableCatalog,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { ContextCheckpointCard } from "../src/ContextCheckpointCard";
import { UsagePriceTableCard } from "../src/UsagePriceTableCard";
import { renderToStaticMarkup } from "./render-static-preact";

describe("Context evidence cards", () => {
  it("renders a compact provider catalog without exposing table internals", () => {
    const tree = UsagePriceTableCard({ catalog: priceCatalog() });
    const text = renderedText(tree);

    expect(text).toContain("Usage price tables");
    expect(text).toContain("openai, anthropic");
    expect(text).toContain("2 tables");
    expect(text).toContain("c".repeat(12));
    expect(text).not.toContain("TOP_SECRET_PRICE_SOURCE");
  });

  it("renders handoff groups and calibration metrics from immutable props", () => {
    const tree = ContextCheckpointCard({
      checkpoint: checkpoint(),
      calibration: calibration(),
    });
    const text = renderedText(tree);

    expect(text).toContain("Evidence checkpoint");
    expect(text).toContain("Coverage #1–#40");
    expect(text).toContain("Keep the read-only boundary.");
    expect(text).toContain("Run final verification.");
    expect(text).toContain("artifacts/report.md");
    expect(text).toContain("Coverage rate80%");
    expect(text).toContain("Compression4.0x");
    expect(text).toContain("Failed / omitted1 / 3");
    expect(text).not.toContain("TOP_SECRET_CHECKPOINT_SOURCE");
  });
});

function priceCatalog(): UsagePriceTableCatalog {
  return {
    kind: "napier.usage-price-table-catalog",
    schemaVersion: 1,
    apiVersion: "2026-07-25",
    generatedAt: "2026-08-19T00:00:00.000Z",
    tables: ["openai", "anthropic"].map((provider, index) => ({
      schemaVersion: 1,
      id: `${provider}.v1`,
      provider,
      label: provider,
      inputUsdPerMillion: index + 1,
      outputUsdPerMillion: index + 2,
      cacheReadUsdPerMillion: 0,
      cacheWriteUsdPerMillion: 0,
      effectiveAt: "2026-08-19T00:00:00.000Z",
      source: "TOP_SECRET_PRICE_SOURCE",
      tableSha256: index === 0 ? "a".repeat(64) : "b".repeat(64),
    })),
    contentSha256: "c".repeat(64),
  };
}

function checkpoint(): ContextCheckpointSnapshot {
  return {
    schemaVersion: 1,
    checkpointId: "checkpoint_1",
    fromSeq: 1,
    toSeq: 40,
    retainedFromSeq: 41,
    sourceEventCount: 24,
    sourceSha256: "d".repeat(64),
    summarySha256: "e".repeat(64),
    summary: "Continue from the verified handoff.",
    decisions: ["Keep the read-only boundary."],
    openLoops: ["Run final verification."],
    artifacts: ["artifacts/report.md"],
  };
}

function calibration(): ContextCheckpointCalibrationReport {
  return {
    kind: "napier.context-checkpoint-calibration",
    schemaVersion: 1,
    apiVersion: "2026-07-25",
    generatedAt: "2026-08-19T00:00:00.000Z",
    threadId: "thread_1",
    eventStreamSha256: "f".repeat(64),
    messageEventCount: 50,
    checkpointCount: 1,
    verifiedCheckpointCount: 1,
    driftedCheckpointCount: 0,
    malformedCheckpointCount: 0,
    failureCount: 1,
    coveredMessageCount: 40,
    coverageRate: 0.8,
    sourceCharacterCount: 4_000,
    summaryCharacterCount: 1_000,
    compressionRatio: 4,
    fallbackOmittedMessageCount: 3,
    samples: [],
    failures: [],
    contentSha256: "0".repeat(64),
  };
}

function renderedText(
  value: Parameters<typeof renderToStaticMarkup>[0],
): string {
  return renderToStaticMarkup(value).replace(/<[^>]+>/gu, "");
}
