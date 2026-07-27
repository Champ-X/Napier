import { createHash } from "node:crypto";

import {
  emptyUsage,
  type SubagentOutcomeEvidenceVerification,
  type SubagentOutcomeReview,
} from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  reviewSubagentOutcome,
  verifySubagentOutcomeEvidence,
} from "../src/subagent-api";

describe("subagent API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("verifies stored outcome evidence through the task-scoped no-store route", async () => {
    const content = {
      kind: "napier.subagent-outcome-evidence-verification" as const,
      schemaVersion: 1 as const,
      status: "aligned" as const,
      taskId: "task_fixture",
      outcomeSha256: "a".repeat(64),
      evidenceCount: 1,
      alignedCount: 1,
      divergentCount: 0,
      missingCount: 0,
      items: [
        {
          path: "src/example.ts",
          lineStart: 1,
          lineEnd: 2,
          status: "aligned" as const,
          expectedFileSha256: "b".repeat(64),
          observedFileSha256: "b".repeat(64),
          expectedRangeSha256: "c".repeat(64),
          observedRangeSha256: "c".repeat(64),
        },
      ],
    };
    const verification: SubagentOutcomeEvidenceVerification = {
      ...content,
      contentSha256: sha256Canonical(content),
    };
    const fetchMock = vi.fn(async (requestPath: string, init?: RequestInit) => {
      expect(requestPath).toBe(
        "/api/threads/thread_fixture/subagents/task_fixture/outcome/verify",
      );
      expect(init).toEqual({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      return new Response(JSON.stringify(verification), {
        headers: {
          "Content-Type": "application/json",
          "X-Napier-Content-SHA256": verification.contentSha256,
          "X-Napier-Content-SHA256-Mode": "stable",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifySubagentOutcomeEvidence("thread_fixture", "task_fixture"),
    ).resolves.toEqual(verification);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reviews a stored outcome with the selected independent model", async () => {
    const model = { provider: "reviewer", id: "reviewer-1" };
    const content = {
      kind: "napier.subagent-outcome-review" as const,
      schemaVersion: 1 as const,
      policyId: "napier.subagent-outcome-review.v1" as const,
      taskId: "task_fixture",
      role: "reviewer" as const,
      outcomeSha256: "a".repeat(64),
      workerModel: { provider: "worker", id: "worker-1" },
      reviewerModel: model,
      verdict: "accept" as const,
      score: 91,
      risk: "low" as const,
      reason: "The outcome is grounded.",
      concerns: [],
      criteria: [
        "task_alignment",
        "evidence_grounding",
        "uncertainty_honesty",
        "actionability",
      ],
      itemCount: 1,
      unknownCount: 0,
      evidenceCount: 1,
      usage: emptyUsage(),
      criteriaSha256: "b".repeat(64),
      inputSha256: "c".repeat(64),
      promptSha256: "d".repeat(64),
      responseSha256: "e".repeat(64),
      reviewSchemaSha256: "f".repeat(64),
      createdAt: "2026-07-28T00:00:00.000Z",
    };
    const review: SubagentOutcomeReview = {
      ...content,
      reviewSha256: sha256Canonical(content),
    };
    const fetchMock = vi.fn(async (requestPath: string, init?: RequestInit) => {
      expect(requestPath).toBe(
        "/api/threads/thread_fixture/subagents/task_fixture/outcome/review",
      );
      expect(init).toEqual({
        method: "POST",
        body: JSON.stringify({ model }),
        headers: { "Content-Type": "application/json" },
      });
      return new Response(JSON.stringify(review), {
        headers: {
          "Content-Type": "application/json",
          "X-Napier-Content-SHA256": review.reviewSha256,
          "X-Napier-Content-SHA256-Mode": "stable",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      reviewSubagentOutcome("thread_fixture", "task_fixture", model),
    ).resolves.toEqual(review);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
