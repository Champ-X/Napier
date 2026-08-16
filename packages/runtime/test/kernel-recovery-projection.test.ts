import type {
  AutomaticRecoveryAssessment,
  AutomaticRecoveryAttempt,
  RunEvent,
  ThreadRecord,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { KernelProjectionRegistry } from "../src/kernel-projections.js";
import { ConversationRecoveriesProjectionService } from "../src/kernel-recovery-projection.js";

describe("Kernel Recovery projection", () => {
  it("reuses event state while joining current authoritative recovery state", async () => {
    const registry = new KernelProjectionRegistry();
    const thread = projectionThread();
    const assessments = [recoveryAssessment()];
    const attempts = [recoveryAttempt("claimed")];
    const events = [
      event(1, "run.recovery.auto.claimed", {
        attemptId: attempts[0]!.id,
        assessmentSha256: assessments[0]!.contentSha256,
      }),
    ];
    thread.eventCount = 1;
    const service = new ConversationRecoveriesProjectionService(registry, {
      getThread: () => structuredClone(thread),
      listAutomaticRecoveryAssessments: () => structuredClone(assessments),
      listAutomaticRecoveryAttempts: () => structuredClone(attempts),
      listEvents: async (_threadId, afterSeq = 0) =>
        events.filter((event) => event.seq > afterSeq),
    });

    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({
        cacheHit: false,
        appliedEventCount: 1,
        view: [
          expect.objectContaining({
            status: "claimed",
            attempt: expect.objectContaining({
              id: "recovery_fixture0001",
            }),
          }),
        ],
      }),
    );

    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({
        cacheHit: true,
        appliedEventCount: 0,
        view: [expect.objectContaining({ status: "claimed" })],
      }),
    );

    attempts[0] = recoveryAttempt("running");
    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({
        cacheHit: true,
        appliedEventCount: 0,
        view: [
          expect.objectContaining({
            status: "running",
            eventIds: ["event_1"],
          }),
        ],
      }),
    );

    events.push(
      event(2, "run.recovery.auto.started", {
        attemptId: attempts[0]!.id,
        assessmentSha256: assessments[0]!.contentSha256,
      }),
    );
    thread.eventCount = 2;
    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({
        cacheHit: true,
        appliedEventCount: 1,
        view: [
          expect.objectContaining({
            status: "running",
            attempt: expect.objectContaining({
              id: "recovery_fixture0001",
              recoveryRunId: "run_recovery0001",
            }),
          }),
        ],
      }),
    );
  });
});

function projectionThread(): ThreadRecord {
  return {
    id: "thread_recovery",
    title: "Recovery projection",
    agentId: "agent_recovery",
    status: "idle",
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
    lastMessage: "",
    eventCount: 0,
    runIds: [],
  };
}

function recoveryAssessment(): AutomaticRecoveryAssessment {
  return {
    schemaVersion: 1,
    threadId: "thread_recovery",
    runId: "run_interrupted0001",
    rootRunId: "run_interrupted0001",
    agentId: "agent_recovery",
    policy: { mode: "safe_read_only", maxAttempts: 2, backoffMs: 1_000 },
    eligible: true,
    blockReasons: [],
    toolCalls: {
      total: 1,
      readOnly: 1,
      unsafe: 0,
      unknownEffect: 0,
      unresolved: 0,
    },
    unsafeToolNames: [],
    unknownEffectToolNames: [],
    unresolvedToolNames: [],
    eventRange: {
      fromSeq: 1,
      toSeq: 1,
      eventCount: 1,
      eventStreamSha256: "a".repeat(64),
    },
    priorAttempts: 0,
    eligibleAt: "2026-08-16T00:00:01.000Z",
    assessedAt: "2026-08-16T00:00:02.000Z",
    contentSha256: "b".repeat(64),
  };
}

function recoveryAttempt(
  status: "claimed" | "running",
): AutomaticRecoveryAttempt {
  return {
    id: "recovery_fixture0001",
    threadId: "thread_recovery",
    agentId: "agent_recovery",
    rootRunId: "run_interrupted0001",
    interruptedRunId: "run_interrupted0001",
    attempt: 1,
    maxAttempts: 2,
    triggerId: "automatic-recovery:run_interrupted0001:1",
    assessmentSha256: "b".repeat(64),
    status,
    ...(status === "claimed"
      ? {
          claim: {
            ownerId: "owner_recovery",
            acquiredAt: "2026-08-16T00:00:02.000Z",
            heartbeatAt: "2026-08-16T00:00:02.000Z",
            expiresAt: "2026-08-16T00:01:02.000Z",
            revision: 1,
          },
        }
      : {
          recoveryRunId: "run_recovery0001",
          startedAt: "2026-08-16T00:00:03.000Z",
        }),
    createdAt: "2026-08-16T00:00:02.000Z",
    updatedAt: "2026-08-16T00:00:03.000Z",
    revision: 2,
    contentSha256: "c".repeat(64),
  };
}

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_recovery",
    runId: "runctl_recovery",
    seq,
    type,
    category: "automation",
    visibility: "user",
    createdAt: "2026-08-16T00:00:03.000Z",
    payload,
  };
}
