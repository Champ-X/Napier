import { describe, expect, it, vi } from "vitest";

import { prepareNetworkSourceContinuity } from "../src/research-source-recovery-context.js";

describe("Source continuity preparation", () => {
  it("fails before model use when an explicit pin has no enabled private state", async () => {
    const record = vi.fn();

    await expect(
      prepareNetworkSourceContinuity({
        threadId: "thread_continuity",
        runId: "run_continuity",
        invocationSource: "user",
        automaticRecovery: false,
        sourceContinuityRequired: true,
        enabledTools: ["web_fetch", "research_source"],
        prepare: vi.fn(async () => ({
          research: undefined,
          webFetch: undefined,
        })),
        record,
      }),
    ).rejects.toThrow(
      "Pinned Source continuity Run has no enabled private Source state",
    );
    expect(record).not.toHaveBeenCalled();
  });

  it("keeps empty implicit continuity as a normal no-op", async () => {
    await expect(
      prepareNetworkSourceContinuity({
        threadId: "thread_continuity",
        runId: "run_continuity",
        invocationSource: "user",
        automaticRecovery: false,
        sourceContinuityRequired: false,
        enabledTools: ["web_fetch"],
        prepare: vi.fn(async () => ({
          research: undefined,
          webFetch: undefined,
        })),
        record: vi.fn(),
      }),
    ).resolves.toBe("");
  });
});
