import { createHash } from "node:crypto";

import {
  emptyUsage,
  type SubagentOutcomeEvidenceVerification,
  type SubagentOutcomeReview,
} from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cancelSubagentHubTask,
  reviveSubagentHubTask,
  reviewSubagentOutcome,
  steerSubagentHubTask,
  verifySubagentOutcomeEvidence,
} from "../src/subagent-api";

describe("subagent API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      action: "steer" as const,
      invoke: () =>
        steerSubagentHubTask("thread_fixture", "task_fixture", {
          kind: "napier.subagent-hub-steer-request",
          schemaVersion: 1,
          expectedTaskRevision: 2,
          messageKind: "steering",
          text: "Verify the boundary.",
        }),
    },
    {
      action: "cancel" as const,
      invoke: () =>
        cancelSubagentHubTask("thread_fixture", "task_fixture", {
          kind: "napier.subagent-hub-cancel-request",
          schemaVersion: 1,
          expectedTaskRevision: 2,
          reason: "No longer required.",
        }),
    },
    {
      action: "revive" as const,
      invoke: () =>
        reviveSubagentHubTask("thread_fixture", "task_fixture", {
          kind: "napier.subagent-hub-revive-request",
          schemaVersion: 1,
          expectedTaskRevision: 2,
        }),
    },
  ])(
    "validates the $action Hub action response before returning it",
    async ({ action, invoke }) => {
      const response = hubActionResponse(action);
      const fetchMock = vi.fn(
        async (requestPath: string, init?: RequestInit) => {
          expect(requestPath).toBe(
            `/api/threads/thread_fixture/subagents/task_fixture/${action}`,
          );
          expect(init?.method).toBe("POST");
          return hashedResponse(response);
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(invoke()).resolves.toEqual(response);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects a hash-valid action response with an unknown Hub field", async () => {
    const response = {
      ...hubActionResponse("cancel"),
      hub: {
        ...hubActionResponse("cancel").hub,
        privatePrompt: "must not cross the projection boundary",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => hashedResponse(response)),
    );

    await expect(
      cancelSubagentHubTask("thread_fixture", "task_fixture", {
        kind: "napier.subagent-hub-cancel-request",
        schemaVersion: 1,
        expectedTaskRevision: 2,
        reason: "No longer required.",
      }),
    ).rejects.toThrow("Subagent Hub action response is invalid");
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
      modelContextEnvelope: {
        kind: "napier.model-context-envelope" as const,
        schemaVersion: 1 as const,
        turnIndex: 0,
        systemPromptSha256: "1".repeat(64),
        systemPromptBytes: 120,
        messageCount: 1,
        userMessageCount: 1,
        assistantMessageCount: 0,
        toolResultMessageCount: 0,
        otherMessageCount: 0,
        messageSetSha256: "2".repeat(64),
        toolCount: 0,
        toolNameSetSha256: "3".repeat(64),
        toolDefinitionSetSha256: "4".repeat(64),
        contentSha256: "5".repeat(64),
      },
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

function hubActionResponse(action: "steer" | "cancel" | "revive") {
  const resultTaskId = action === "revive" ? "task_revived" : "task_fixture";
  return {
    kind: "napier.subagent-hub-action-response" as const,
    schemaVersion: 1 as const,
    result: {
      kind: "napier.subagent-hub-action-result" as const,
      schemaVersion: 1 as const,
      action,
      sourceTaskId: "task_fixture",
      sourceTaskRevision: 2,
      taskId: resultTaskId,
      ...(action === "steer" ? { messageId: "submsg_fixture" } : {}),
      ...(action === "revive" ? { executionId: "subexec_fixture" } : {}),
      acceptedAt: "2026-08-26T00:00:00.000Z",
    },
    hub: {
      kind: "napier.subagent-hub-projection" as const,
      schemaVersion: 1 as const,
      threadId: "thread_fixture",
      taskCount: 1,
      selectedTaskCount: 1,
      activeTaskCount: 1,
      terminalTaskCount: 0,
      orphanedTaskCount: 0,
      omittedTaskCount: 0,
      eventWatermark: 4,
      tasks: [
        {
          taskId: resultTaskId,
          runId: "run_fixture",
          role: "researcher" as const,
          description: "Verify the boundary",
          status: "running" as const,
          taskStatus: "running" as const,
          model: { provider: "napier", id: "demo" },
          stepCount: 1,
          turnCount: 1,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
          },
          revision: 3,
          createdAt: "2026-08-26T00:00:00.000Z",
          mailbox: { acceptedCount: 0, deliveredCount: 0, pendingCount: 0 },
          lineage: { childTaskIds: [] },
          transcript: [],
          worktree: { state: "none" as const },
          control: { steer: true, cancel: true, revive: false },
        },
      ],
    },
  };
}

function hashedResponse(value: unknown): Response {
  const text = JSON.stringify(value);
  return new Response(JSON.stringify(value), {
    status: 202,
    headers: {
      "Content-Type": "application/json",
      "X-Napier-Content-SHA256": createHash("sha256")
        .update(text)
        .digest("hex"),
      "X-Napier-Content-SHA256-Mode": "body",
    },
  });
}

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
