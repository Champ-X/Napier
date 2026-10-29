import type { RunEvent, RunRecord, ThreadRecord } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resumeInterruptedAgentRun } from "../src/agent-run-recovery.js";
import { assessAutomaticRecovery } from "../src/automatic-recovery.js";
import { claimAutomaticRecoveryState } from "../src/automatic-recovery-store-claims.js";
import { createAutomaticRecoveryAttemptRecord } from "../src/automatic-recovery-store-records.js";
import {
  applyConversationArtifactEvent,
  createConversationArtifactEventState,
  projectConversationArtifacts,
} from "../src/conversation-artifacts-projection.js";
import {
  applyConversationPlanEvent,
  createConversationPlanEventState,
  projectConversationPlans,
} from "../src/conversation-plans-projection.js";
import {
  createExecutionPlan,
  createPlanArtifactEventPayload,
  updateArtifactManifest,
} from "../src/plans.js";
import { RunLifecycleRepository } from "../src/run-lifecycle-repository.js";
import { createRunConfigurationFingerprint } from "../src/run-config.js";
import { projectRunRecoveryCheckpoint } from "../src/run-recovery-checkpoint.js";
import { resetTerminalThreads } from "../src/run-terminal-recovery.js";
import { SerialQueue } from "../src/serial-queue.js";
import type { StoreRepositoryHost } from "../src/store-repository-host.js";
import { createThreadDetail } from "../src/thread-detail.js";
import {
  cleanupModelSessionFixtures,
  createModelSessionFixture,
} from "./subagent-model-session-fixture.js";

afterEach(cleanupModelSessionFixtures);

async function fixture() {
  const f = await createModelSessionFixture();
  const agent = f.store.getAgent(f.run.agentId);
  const parent: RunRecord = {
    ...f.run,
    source: "user",
    status: "interrupted",
    finishedAt: "2026-10-29T01:00:01.000Z",
    interruptedAt: "2026-10-29T01:00:01.000Z",
    configuration: createRunConfigurationFingerprint({
      ...agent,
      model: { provider: f.model.provider, id: f.model.id },
      automaticRecovery: {
        mode: "safe_read_only",
        maxAttempts: 2,
        backoffMs: 1_000,
      },
    }),
  };
  // The source/parent relation is the agreed child Run boundary. No future
  // checkpoint, mailbox or continuation schema is fabricated by this fixture.
  const child: RunRecord = {
    ...parent,
    id: "run_projection_child",
    source: "subagent",
    parentRunId: parent.id,
    startedAt: "2026-10-29T01:00:00.500Z",
    finishedAt: "2026-10-29T01:00:02.000Z",
  };
  const thread: ThreadRecord = {
    ...f.thread,
    status: "waiting",
    runIds: [parent.id, child.id],
  };
  delete thread.currentRunId;
  return { ...f, parentRun: parent, childRun: child, projectedThread: thread };
}

function lifecycleHost(thread: ThreadRecord, runs: RunRecord[]) {
  const persistState = vi.fn(async () => undefined);
  const host = {
    state: { threads: [thread], runs, subagents: [] },
    stateQueue: new SerialQueue(),
    assertInitialized: () => undefined,
    mutableRun: (id: string) => runs.find((run) => run.id === id)!,
    mutableThread: () => thread,
    requireLedger: () => ({ listEvents: () => [], listRunEvents: () => [] }),
    appendEventsToThread: () => [],
    persistState,
  };
  return {
    host,
    repository: new RunLifecycleRepository(
      host as unknown as StoreRepositoryHost,
    ),
    persistState,
  };
}

describe("subagent child Run primary projections", () => {
  it("keeps the parent's recovery checkpoint when a newer child is interrupted", async () => {
    const f = await fixture();
    const detail = await f.store.getDetail(f.thread.id);
    const projected = createThreadDetail(
      {
        ...detail,
        thread: f.projectedThread,
        runs: [f.parentRun, f.childRun],
        events: [],
      },
      { kernelProjections: false },
    );
    expect(projected.recoveryCheckpoint?.runId).toBe(f.parentRun.id);
  });

  it("does not offer a generic recovery checkpoint for an explicitly selected child", async () => {
    const f = await fixture();
    expect(
      projectRunRecoveryCheckpoint(f.childRun, [], [f.parentRun, f.childRun]),
    ).toBeUndefined();
  });

  it("manual recovery selects the latest primary Run rather than a newer child", async () => {
    const f = await fixture();
    const runPrompt = vi.fn(async () => f.parentRun);
    await resumeInterruptedAgentRun(
      {
        store: {
          workspaceRoot: f.store.workspaceRoot,
          dataRoot: f.store.dataRoot,
          getThread: () => f.projectedThread,
          listRuns: () => [f.parentRun, f.childRun],
          listRunEvents: async () => [],
          listPlans: () => [],
        },
        runPrompt,
      },
      { threadId: f.thread.id, runId: f.parentRun.id },
    );
    expect(runPrompt).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ parentRunId: f.parentRun.id }),
    );
  });

  it("manual recovery refuses a requested child before starting any Run", async () => {
    const f = await fixture();
    const runPrompt = vi.fn(async () => f.childRun);
    await expect(
      resumeInterruptedAgentRun(
        {
          store: {
            workspaceRoot: f.store.workspaceRoot,
            dataRoot: f.store.dataRoot,
            getThread: () => f.projectedThread,
            listRuns: () => [f.parentRun, f.childRun],
            listRunEvents: async () => [],
            listPlans: () => [],
          },
          runPrompt,
        },
        { threadId: f.thread.id, runId: f.childRun.id },
      ),
    ).rejects.toThrow();
    expect(runPrompt).not.toHaveBeenCalled();
  });

  it("automatic recovery rejects a child even when its inherited policy allows safe recovery", async () => {
    const f = await fixture();
    const assessment = assessAutomaticRecovery({ run: f.childRun, events: [] });
    expect(assessment.eligible).toBe(false);
    expect(assessment.blockReasons).toContain("subagent_managed");
  });

  it("automatic claim sweep never schedules an interrupted child", async () => {
    const f = await fixture();
    const primary: RunRecord = {
      ...f.parentRun,
      status: "completed",
      outcome: "completed",
    };
    const sweep = claimAutomaticRecoveryState({
      state: {
        automaticRecoveryAssessments: [],
        automaticRecoveryAttempts: [],
        runs: [primary, f.childRun],
        threads: [f.projectedThread],
      },
      ownerId: "projection_owner",
      leaseMs: 1_000,
      limit: 2,
      now: new Date("2026-10-29T02:00:00.000Z"),
      createToken: () => "projection-token",
      listEvents: () => [],
    });
    expect(sweep.claims).toHaveLength(0);
    expect(sweep.skipped).toHaveLength(0);
  });

  it("does not reissue an expired generic recovery claim for a child", async () => {
    const f = await fixture();
    const staleAssessment = assessAutomaticRecovery({
      run: { ...f.childRun, source: "user" },
      events: [],
    });
    const claimed = createAutomaticRecoveryAttemptRecord(
      staleAssessment,
      "old_owner",
      "old-token",
      "2026-10-29T01:00:00.000Z",
      1_000,
    );
    const sweep = claimAutomaticRecoveryState({
      state: {
        automaticRecoveryAssessments: [staleAssessment],
        automaticRecoveryAttempts: [claimed],
        runs: [f.parentRun, f.childRun],
        threads: [f.projectedThread],
      },
      ownerId: "new_owner",
      leaseMs: 1_000,
      limit: 2,
      now: new Date("2026-10-29T02:00:00.000Z"),
      createToken: () => "new-token",
      listEvents: () => [],
    });
    expect(
      sweep.claims.some((claim) => claim.assessment.runId === f.childRun.id),
    ).toBe(false);
  });

  it("keeps primary plans and artifacts current after a child Run starts", async () => {
    const f = await fixture();
    let plan = createExecutionPlan(f.thread.id, {
      objective: "Preserve parent material ownership",
      steps: [
        {
          id: "inspect",
          title: "Inspect",
          description: "Inspect",
          verification: "Retain evidence",
        },
      ],
      artifacts: [
        {
          id: "report",
          path: "ledger://report",
          kind: "other",
          description: "Parent report",
        },
      ],
    });
    plan = updateArtifactManifest(plan, "report", {
      status: "produced",
      sourceRunId: f.parentRun.id,
      evidence: "Produced parent report",
    });
    const event: RunEvent = {
      id: "event_parent_plan",
      threadId: f.thread.id,
      runId: f.parentRun.id,
      seq: 1,
      createdAt: plan.updatedAt,
      type: "plan.created",
      category: "plan",
      visibility: "user",
      payload: { planId: plan.id },
    };
    const planState = applyConversationPlanEvent(
      createConversationPlanEventState(),
      event,
    );
    const artifactState = applyConversationArtifactEvent(
      createConversationArtifactEventState(),
      {
        ...event,
        id: "event_parent_artifact",
        seq: 2,
        type: "plan.artifact.produced",
        payload: createPlanArtifactEventPayload(plan, plan.artifacts[0]!),
      },
    );
    const runs = [f.parentRun, { ...f.childRun, status: "running" as const }];
    expect
      .soft(projectConversationPlans([plan], runs, planState)[0]?.attemptScope)
      .toBe("current");
    expect
      .soft(
        projectConversationArtifacts([plan], runs, artifactState)[0]
          ?.attemptScope,
      )
      .toBe("current");
  });

  it("public Run settlement refuses to bypass atomic child Task settlement", async () => {
    const f = await fixture();
    const child: RunRecord = { ...f.childRun, status: "running" };
    const { repository, persistState } = lifecycleHost(f.projectedThread, [
      f.parentRun,
      child,
    ]);
    await expect(repository.finishRun(child.id, "completed")).rejects.toThrow(
      /subagent.*task/iu,
    );
    expect(child.status).toBe("running");
    expect(persistState).not.toHaveBeenCalled();
  });

  it("a primary terminal mutation never promotes an active child to thread.currentRunId", async () => {
    const f = await fixture();
    const parent: RunRecord = { ...f.parentRun, status: "running" };
    const child: RunRecord = { ...f.childRun, status: "running" };
    const thread: ThreadRecord = {
      ...f.projectedThread,
      status: "running",
      currentRunId: parent.id,
    };
    const { repository } = lifecycleHost(thread, [parent, child]);
    await repository.finishRun(parent.id, "completed", {
      outcome: "completed",
    });
    expect(thread.currentRunId).toBeUndefined();
    expect(thread.status).toBe("idle");
  });

  it("startup terminal repair selects primary outcomes and ignores child replacement", async () => {
    const f = await fixture();
    const parent: RunRecord = {
      ...f.parentRun,
      status: "completed",
      outcome: "completed",
    };
    const child: RunRecord = { ...f.childRun, status: "running" };
    const thread: ThreadRecord = {
      ...f.projectedThread,
      status: "running",
      currentRunId: parent.id,
    };
    const { host } = lifecycleHost(thread, [parent, child]);
    resetTerminalThreads(
      host,
      new Map([[parent.id, "completed"]]),
      [],
      "2026-10-29T02:00:00.000Z",
    );
    expect(thread.currentRunId).toBeUndefined();
    expect(thread.status).toBe("idle");
  });

  it("child-only startup repair cannot overwrite its primary thread outcome", async () => {
    const f = await fixture();
    const parent: RunRecord = {
      ...f.parentRun,
      status: "failed",
      outcome: "failed_unrecoverable",
    };
    const child: RunRecord = {
      ...f.childRun,
      status: "completed",
      outcome: "completed",
    };
    const thread: ThreadRecord = { ...f.projectedThread, status: "failed" };
    const { host } = lifecycleHost(thread, [parent, child]);
    resetTerminalThreads(
      host,
      new Map([[child.id, "completed"]]),
      [],
      "2026-10-29T02:00:00.000Z",
    );
    expect(thread.status).toBe("failed");
    expect(thread.currentRunId).toBeUndefined();
  });
});
