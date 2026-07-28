import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  traceEventSummaryView,
  traceSummaryCoverageDeltaReceipt,
  traceSummaryCoverageDeltaView,
  traceSummaryCoverageReceipt,
  traceSummaryCoverageView,
  verifyTraceSummaryCoverageDeltaReceipt,
  verifyTraceSummaryCoverageReceipt,
} from "../src/trace-event-summary-view";

describe("Trace event summary view", () => {
  it("classifies bounded, fixed, category, and generic summaries", () => {
    const bounded = traceEventSummaryView(
      traceEvent("message.user", "message", {
        role: "user",
        textBytes: 24,
        text: "TOP_SECRET_USER_TEXT",
      }),
    );
    const fixed = traceEventSummaryView(
      traceEvent("message.user", "message", ["TOP_SECRET_USER_TEXT"]),
    );
    const category = traceEventSummaryView(
      traceEvent("message.future", "message", {
        text: "TOP_SECRET_FUTURE_MESSAGE",
      }),
    );
    const generic = traceEventSummaryView(
      traceEvent("custom.audit", "system", {
        summary: "TOP_SECRET_GENERIC_SUMMARY",
      }),
    );

    expect(bounded).toEqual({
      text: "message / message.user / role user / text-bytes 20",
      source: "bounded",
    });
    expect(fixed).toEqual({ text: "message receipt", source: "fixed" });
    expect(category).toEqual({ text: "message", source: "category" });
    expect(generic).toEqual({
      text: "TOP_SECRET_GENERIC_SUMMARY",
      source: "generic",
    });
  });

  it("aggregates coverage and generic event types deterministically", () => {
    const coverage = traceSummaryCoverageView([
      traceEvent("message.user", "message", {
        role: "user",
        textBytes: 24,
      }),
      traceEvent("message.user", "message", []),
      traceEvent("message.future", "message", {
        text: "TOP_SECRET_FUTURE_MESSAGE",
      }),
      traceEvent("zeta.audit", "system", {
        summary: "TOP_SECRET_ZETA",
      }),
      traceEvent("alpha.audit", "system", {
        status: "TOP_SECRET_ALPHA",
      }),
      traceEvent("alpha.audit", "system", {
        status: "TOP_SECRET_ALPHA_DUPLICATE",
      }),
    ]);

    expect(coverage).toEqual({
      total: 6,
      bounded: 1,
      fixed: 1,
      category: 1,
      generic: 3,
      genericEventTypes: ["alpha.audit", "zeta.audit"],
    });
  });

  it("hashes coverage receipts deterministically", async () => {
    const coverage = traceSummaryCoverageView([
      traceEvent("message.user", "message", {
        role: "user",
        textBytes: 24,
      }),
      traceEvent("alpha.audit", "system", {
        status: "TOP_SECRET_ALPHA",
      }),
    ]);
    const receipt = await traceSummaryCoverageReceipt(coverage);
    const repeated = await traceSummaryCoverageReceipt(coverage);
    const drifted = await traceSummaryCoverageReceipt({
      ...coverage,
      generic: coverage.generic + 1,
    });

    expect(receipt).toEqual({
      kind: "napier.trace-summary-coverage",
      schemaVersion: 1,
      total: 2,
      bounded: 1,
      fixed: 0,
      category: 0,
      generic: 1,
      genericEventTypes: ["alpha.audit"],
      contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(repeated.contentSha256).toBe(receipt.contentSha256);
    expect(drifted.contentSha256).not.toBe(receipt.contentSha256);
  });

  it("verifies coverage receipts fail-closed", async () => {
    const coverage = traceSummaryCoverageView([
      traceEvent("message.user", "message", {
        role: "user",
        textBytes: 24,
      }),
      traceEvent("alpha.audit", "system", {
        status: "TOP_SECRET_ALPHA",
      }),
    ]);
    const receipt = await traceSummaryCoverageReceipt(coverage);
    const drifted = { ...receipt, contentSha256: "0".repeat(64) };
    const malformed = { ...receipt, total: receipt.total + 1 };

    await expect(verifyTraceSummaryCoverageReceipt(receipt)).resolves.toEqual({
      status: "valid",
      diagnostics: [],
      observedContentSha256: receipt.contentSha256,
      declaredContentSha256: receipt.contentSha256,
    });
    await expect(verifyTraceSummaryCoverageReceipt(drifted)).resolves.toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: ["content_sha256_mismatch"],
        declaredContentSha256: "0".repeat(64),
      }),
    );
    await expect(verifyTraceSummaryCoverageReceipt(malformed)).resolves.toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: ["count_mismatch"],
        declaredContentSha256: receipt.contentSha256,
      }),
    );
  });

  it("compares coverage between baseline and candidate runs", () => {
    const delta = traceSummaryCoverageDeltaView(
      [
        traceEvent("message.user", "message", {
          role: "user",
          textBytes: 12,
        }),
        traceEvent("message.future", "message", {
          text: "TOP_SECRET_BASELINE_FUTURE",
        }),
      ],
      [
        traceEvent("message.user", "message", {
          role: "user",
          textBytes: 12,
        }),
        traceEvent("alpha.audit", "system", {
          summary: "TOP_SECRET_ALPHA",
        }),
        traceEvent("zeta.audit", "system", {
          status: "TOP_SECRET_ZETA",
        }),
      ],
    );

    expect(delta).toEqual({
      status: "regressed",
      left: {
        total: 2,
        bounded: 1,
        fixed: 0,
        category: 1,
        generic: 0,
        genericEventTypes: [],
      },
      right: {
        total: 3,
        bounded: 1,
        fixed: 0,
        category: 0,
        generic: 2,
        genericEventTypes: ["alpha.audit", "zeta.audit"],
      },
      boundedDelta: 0,
      fixedDelta: 0,
      categoryDelta: -1,
      genericDelta: 2,
      diagnostics: [
        "candidate_generic_summary_fallback_increased",
        "candidate_generic_summary_fallback_present",
      ],
      genericEventTypes: ["alpha.audit", "zeta.audit"],
    });
  });

  it("hashes coverage delta receipts deterministically", async () => {
    const delta = traceSummaryCoverageDeltaView(
      [
        traceEvent("message.user", "message", {
          role: "user",
          textBytes: 12,
        }),
      ],
      [
        traceEvent("message.user", "message", {
          role: "user",
          textBytes: 12,
        }),
        traceEvent("alpha.audit", "system", {
          summary: "TOP_SECRET_ALPHA",
        }),
      ],
    );

    const receipt = await traceSummaryCoverageDeltaReceipt(delta);
    const repeated = await traceSummaryCoverageDeltaReceipt(delta);

    expect(receipt).toEqual({
      kind: "napier.trace-summary-coverage-delta",
      schemaVersion: 1,
      status: "regressed",
      left: {
        total: 1,
        bounded: 1,
        fixed: 0,
        category: 0,
        generic: 0,
        genericEventTypes: [],
      },
      right: {
        total: 2,
        bounded: 1,
        fixed: 0,
        category: 0,
        generic: 1,
        genericEventTypes: ["alpha.audit"],
      },
      boundedDelta: 0,
      fixedDelta: 0,
      categoryDelta: 0,
      genericDelta: 1,
      diagnostics: [
        "candidate_generic_summary_fallback_increased",
        "candidate_generic_summary_fallback_present",
      ],
      genericEventTypes: ["alpha.audit"],
      contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(repeated.contentSha256).toBe(receipt.contentSha256);
  });

  it("verifies coverage delta receipts fail-closed", async () => {
    const delta = traceSummaryCoverageDeltaView(
      [
        traceEvent("message.user", "message", {
          role: "user",
          textBytes: 12,
        }),
      ],
      [
        traceEvent("message.user", "message", {
          role: "user",
          textBytes: 12,
        }),
        traceEvent("alpha.audit", "system", {
          summary: "TOP_SECRET_ALPHA",
        }),
      ],
    );

    const receipt = await traceSummaryCoverageDeltaReceipt(delta);
    const drifted = { ...receipt, genericDelta: receipt.genericDelta + 1 };
    const malformed = { ...receipt, status: "clean" };

    await expect(
      verifyTraceSummaryCoverageDeltaReceipt(receipt),
    ).resolves.toEqual({
      status: "valid",
      diagnostics: [],
      observedContentSha256: receipt.contentSha256,
      declaredContentSha256: receipt.contentSha256,
    });
    await expect(
      verifyTraceSummaryCoverageDeltaReceipt(drifted),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: ["generic_delta_mismatch"],
        declaredContentSha256: receipt.contentSha256,
      }),
    );
    await expect(
      verifyTraceSummaryCoverageDeltaReceipt(malformed),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "invalid",
        diagnostics: ["status_mismatch"],
        declaredContentSha256: receipt.contentSha256,
      }),
    );
  });
});

function traceEvent(
  type: string,
  category: RunEvent["category"],
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_trace",
    runId: "run_trace",
    seq: 51,
    type,
    category,
    visibility: "user",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
