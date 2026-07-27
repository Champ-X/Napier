import { createHash } from "node:crypto";

import type { SubagentOutcomeEvidenceVerification } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { verifySubagentOutcomeEvidence } from "../src/subagent-api";

describe("subagent evidence API", () => {
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
