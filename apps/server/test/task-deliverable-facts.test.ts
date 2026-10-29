import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { LocalStore } from "../../../packages/runtime/src/store.js";
import {
  createPlanTools,
  exportWorkspaceFileArtifact,
} from "../../../packages/runtime/src/plan-tools.js";
import {
  TaskNarrativeProjectionService,
  KernelProjectionRegistry,
} from "../../../packages/runtime/src/kernel-projections.js";
import {
  projectTaskNarrative,
  taskArtifactFacts,
} from "@napier/contracts/task-narrative";
import {
  canonicalJson,
  sha256,
} from "../../../packages/runtime/src/ed25519.js";
import { registerPlanProgressHttp } from "../src/plan-progress-http.js";
import { taskValidationMatrix } from "../../web/src/task-validation-matrix.js";
import { isTaskNarrativeProjection } from "../../web/src/task-narrative-protocol.js";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-deliverable-facts-"));
  const workspaceRoot = path.join(root, "workspace"),
    dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  const store = new LocalStore({ workspaceRoot, dataRoot });
  await store.initialize();
  const agent = store.listAgents()[0]!,
    thread = await store.createThread({
      title: "Artifact facts",
      agentId: agent.id,
    });
  const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
  const plan = await store.createPlan(thread.id, {
    objective: "Deliver report",
    steps: [
      {
        id: "write",
        title: "Write report",
        description: "Produce report",
        verification: "Observed file",
      },
    ],
    artifacts: [
      { id: "report", path: "report.txt", description: "Declared report" },
    ],
  });
  const app = new Hono();
  app.onError(() => new Response("Injected append failure", { status: 500 }));
  registerPlanProgressHttp(app, store);
  const post = async (body: unknown) =>
    app.request(`/api/threads/${thread.id}/plans/${plan.id}/artifacts/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const produced = () =>
    post({ status: "produced", sourceRunId: run.id, evidence: "declared" });
  const verified = (hash: string, sizeBytes = 1) =>
    post({
      status: "verified",
      sourceRunId: run.id,
      evidence: `asserted ${hash}`,
      sha256: hash.repeat(64),
      sizeBytes,
    });
  let stopped = false;
  const stop = async () => {
    if (!stopped) {
      stopped = true;
      await store.shutdown();
    }
  };
  const close = async () => {
    await stop();
    await rm(root, { recursive: true, force: true });
  };
  return {
    store,
    workspaceRoot,
    dataRoot,
    thread,
    run,
    plan,
    post,
    produced,
    verified,
    stop,
    close,
  };
}

it("does not pass a nonexistent file from HTTP caller-supplied verified metadata", async () => {
  const f = await fixture();
  try {
    expect((await f.produced()).status).toBe(200);
    expect((await f.verified("a")).status).toBe(200);
    const detail = await f.store.getDetail(f.thread.id);
    expect(detail.taskNarrative?.deliverables?.[0]).toMatchObject({
      artifact: { status: "verified", sha256: "a".repeat(64) },
      verification: "unverified",
      accessibility: "missing",
      observation: { source: "workspace", status: "missing" },
      currentVersion: { source: "recorded_assertion" },
      history: { status: "incomplete" },
    });
    expect(
      taskValidationMatrix(
        detail.events,
        detail.plans,
        detail.taskNarrative,
      ).at(-1),
    ).toMatchObject({
      status: "failed",
      missingArtifactCount: 1,
      verifiedArtifactCount: 0,
    });
    expect(isTaskNarrativeProjection(detail.taskNarrative)).toBe(true);
    expect(detail.taskNarrative?.objective?.status).not.toBe("accepted");
  } finally {
    await f.close();
  }
});

it("retains emitted versions of one artifact through warm/cold projection, replay and restart", async () => {
  const f = await fixture(),
    registry = new KernelProjectionRegistry(),
    service = new TaskNarrativeProjectionService(registry, f.store);
  try {
    await f.produced();
    await f.verified("a");
    await service.project(f.thread.id);
    await f.verified("b", 2);
    await f.store.finishRun(f.run.id, "completed");
    const detail = await f.store.getDetail(f.thread.id),
      projected = detail.taskNarrative!.deliverables![0]!;
    const verifiedEvents = detail.events.filter(
      (e) => e.type === "plan.artifact.verified",
    );
    expect(projected.previousVersions).toContainEqual(
      expect.objectContaining({
        sha256: "a".repeat(64),
        eventId: verifiedEvents[0]!.id,
        eventSeq: verifiedEvents[0]!.seq,
        planRevision: 3,
        artifactId: "report",
        planId: f.plan.id,
        source: "recorded_assertion",
      }),
    );
    expect(projected.currentVersion).toMatchObject({
      sha256: "b".repeat(64),
      planRevision: 4,
      eventId: verifiedEvents[1]!.id,
      source: "recorded_assertion",
    });
    expect((await service.project(f.thread.id)).view).toEqual(
      detail.taskNarrative,
    );
    expect(
      projectTaskNarrative(detail, detail.events).deliverables![0]!
        .previousVersions,
    ).toEqual(projected.previousVersions);
    await f.stop();
    const reopened = new LocalStore({
      workspaceRoot: f.workspaceRoot,
      dataRoot: f.dataRoot,
    });
    try {
      await reopened.initialize();
      expect((await reopened.getDetail(f.thread.id)).taskNarrative).toEqual(
        detail.taskNarrative,
      );
    } finally {
      await reopened.shutdown();
    }
  } finally {
    registry.shutdown();
    await f.close();
  }
});

it("rechecks native verified bytes without new events and never attributes creation to the verifying Run", async () => {
  const f = await fixture(),
    registry = new KernelProjectionRegistry(),
    service = new TaskNarrativeProjectionService(registry, f.store);
  try {
    const file = path.join(f.workspaceRoot, "report.txt");
    await writeFile(file, "preexisting report");
    const update = createPlanTools(f.store, f.run).find(
      (t) => t.name === "update_plan_artifact",
    )!;
    await update.execute("produce", {
      planId: f.plan.id,
      artifactId: "report",
      action: "produced",
      evidence: "preexisting",
    });
    await update.execute("verify", {
      planId: f.plan.id,
      artifactId: "report",
      action: "verify",
      evidence: "observed",
    });
    const before = await service.project(f.thread.id),
      entry = before.view.deliverables![0]!;
    expect(entry).toMatchObject({
      verification: "integrity_observed",
      observation: { status: "matched", source: "workspace" },
      currentVersion: { source: "recorded_assertion", runId: f.run.id },
    });
    expect(entry).not.toHaveProperty("createdByRunId");
    expect(
      taskArtifactFacts(
        f.store.listPlans(f.thread.id),
        before.view.deliverables,
      ).status,
    ).toBe("passed");
    await f.store.transitionPlanStep(f.plan.id, "write", {
      action: "start",
      runId: f.run.id,
    });
    const revised = (await service.project(f.thread.id)).view;
    expect(revised.deliverables![0]!.currentVersion).toBeUndefined();
    expect(revised.deliverables![0]!.history?.reason).toBe(
      "missing_current_event",
    );
    expect(
      taskArtifactFacts(f.store.listPlans(f.thread.id), revised.deliverables)
        .status,
    ).toBe("passed");
    const eventCount = f.store.getThread(f.thread.id).eventCount;
    await writeFile(file, "changed report");
    const after = await service.project(f.thread.id),
      detail = await f.store.getDetail(f.thread.id);
    expect(after.view).toEqual(detail.taskNarrative);
    expect(after.view.deliverables![0]).toMatchObject({
      verification: "unverified",
      accessibility: "drifted",
      observation: { status: "mismatched" },
      artifact: { sha256: entry.artifact.sha256 },
    });
    expect(
      taskValidationMatrix(detail.events, detail.plans, after.view).at(-1),
    ).toMatchObject({
      status: "failed",
      driftedArtifactCount: 1,
      missingArtifactCount: 0,
    });
    expect(detail.thread.eventCount).toBe(eventCount);
    await expect(
      exportWorkspaceFileArtifact(
        f.workspaceRoot,
        detail.plans[0]!.artifacts[0]!,
      ),
    ).rejects.toThrow("digest drifted");
    await rm(file);
    expect(
      (await service.project(f.thread.id)).view.deliverables![0]!.observation
        ?.status,
    ).toBe("missing");
  } finally {
    registry.shutdown();
    await f.close();
  }
});

it("exposes the real state-to-event commit gap without borrowing the earlier event binding", async () => {
  const f = await fixture();
  try {
    await f.produced();
    await f.verified("a");
    const append = vi
      .spyOn(f.store, "appendEvent")
      .mockRejectedValueOnce(new Error("append failed after state persisted"));
    expect((await f.verified("b")).status).toBe(500);
    append.mockRestore();
    const detail = await f.store.getDetail(f.thread.id),
      entry = detail.taskNarrative!.deliverables![0]!;
    expect(entry.artifact.sha256).toBe("b".repeat(64));
    expect(entry.currentVersion).toBeUndefined();
    expect(entry.sourceEventId).toBeUndefined();
    expect(entry.history).toEqual({
      status: "incomplete",
      reason: "missing_current_event",
    });
    expect(entry.previousVersions).toContainEqual(
      expect.objectContaining({
        sha256: "a".repeat(64),
        source: "recorded_assertion",
      }),
    );
  } finally {
    await f.close();
  }
});

it("does not reuse a missing declaration after the file reappears without any event", async () => {
  const f = await fixture(),
    registry = new KernelProjectionRegistry(),
    service = new TaskNarrativeProjectionService(registry, f.store);
  try {
    await f.produced();
    expect(
      (
        await f.post({
          status: "missing",
          sourceRunId: f.run.id,
          evidence: "declared missing",
        })
      ).status,
    ).toBe(200);
    const missing = (await service.project(f.thread.id)).view;
    expect(
      taskArtifactFacts(f.store.listPlans(f.thread.id), missing.deliverables),
    ).toMatchObject({ status: "failed", missingArtifactCount: 1 });
    const count = f.store.getThread(f.thread.id).eventCount;
    await writeFile(path.join(f.workspaceRoot, "report.txt"), "reappeared");
    const detail = await f.store.getDetail(f.thread.id),
      warm = (await service.project(f.thread.id)).view;
    expect(detail.thread.eventCount).toBe(count);
    expect(warm).toEqual(detail.taskNarrative);
    expect(warm.deliverables![0]).toMatchObject({
      artifact: { status: "missing" },
      accessibility: "available",
      verification: "unverified",
      observation: { status: "observed" },
    });
    expect(
      taskValidationMatrix(detail.events, detail.plans, warm).at(-1),
    ).toMatchObject({
      status: "unknown",
      missingArtifactCount: 0,
      verifiedArtifactCount: 0,
    });
    expect(taskArtifactFacts(detail.plans).status).toBe("unknown");
    expect(
      projectTaskNarrative(detail, detail.events).deliverables![0]!
        .accessibility,
    ).toBe("unchecked");
  } finally {
    registry.shutdown();
    await f.close();
  }
});

it("keeps the newer same-path generation when an older plan is reasserted later, even with tied creation clocks", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-30T00:00:00.123Z"));
  let f: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    f = await fixture();
    await f.produced();
    await f.verified("a");
    await f.store.transitionPlanStep(f.plan.id, "write", {
      action: "start",
      runId: f.run.id,
    });
    await f.store.transitionPlanStep(f.plan.id, "write", {
      action: "complete",
      evidence: "recorded done",
    });
    const next = await f.store.createPlan(f.thread.id, {
      objective: "Continuation report",
      steps: [
        {
          id: "new-write",
          title: "New report",
          description: "Continue",
          verification: "Inspect",
        },
      ],
      artifacts: [
        {
          id: "new-report",
          path: "./report.txt",
          description: "New generation",
        },
      ],
    });
    await f.store.updatePlanArtifact(next.id, "new-report", {
      status: "produced",
      sourceRunId: f.run.id,
      evidence: "new declaration",
    });
    vi.setSystemTime(new Date("2026-10-30T00:00:01.123Z"));
    expect((await f.verified("b")).status).toBe(200);
    const detail = await f.store.getDetail(f.thread.id);
    expect(detail.taskNarrative!.deliverables).toHaveLength(1);
    expect(detail.taskNarrative!.deliverables![0]).toMatchObject({
      planId: next.id,
      artifact: { id: "new-report", status: "produced" },
    });
    await f.store.updatePlanArtifact(next.id, "new-report", {
      status: "missing",
      sourceRunId: f.run.id,
      evidence: "new generation unavailable",
    });
    const missing = (await f.store.getDetail(f.thread.id)).taskNarrative!
      .deliverables![0]!;
    expect(missing).toMatchObject({
      planId: next.id,
      artifact: { id: "new-report", status: "missing" },
      observation: { status: "missing" },
    });
    expect(missing.previousVersions).toContainEqual(
      expect.objectContaining({
        planId: f.plan.id,
        artifactId: "report",
        sha256: "b".repeat(64),
      }),
    );
  } finally {
    vi.useRealTimers();
    await f?.close();
  }
});

it("does not borrow a same-tick prior event after identical metadata persists without its event", async () => {
  const f = await fixture();
  try {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-30T00:00:00.123Z"));
    await f.produced();
    await f.verified("a");
    const before = (await f.store.getDetail(f.thread.id)).taskNarrative!
      .deliverables![0]!;
    const append = vi
      .spyOn(f.store, "appendEvent")
      .mockRejectedValueOnce(new Error("append failed"));
    expect((await f.verified("a")).status).toBe(500);
    append.mockRestore();
    const entry = (await f.store.getDetail(f.thread.id)).taskNarrative!
      .deliverables![0]!;
    expect(entry.artifact.updatedAt).toBe(before.artifact.updatedAt);
    expect(entry.artifact.sha256).toBe(before.artifact.sha256);
    expect(entry.planRevision).toBe(before.planRevision! + 1);
    expect(entry.currentVersion).toBeUndefined();
    expect(entry.sourceEventId).toBeUndefined();
    expect(entry.history?.reason).toBe("missing_current_event");
    expect(entry.previousVersions).toContainEqual(before.currentVersion);
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await f.close();
  }
});

it("rejects mismatched event identities and snapshot bindings even with recomputed snapshot hashes", async () => {
  const f = await fixture();
  try {
    await f.produced();
    await f.verified("a");
    const detail = await f.store.getDetail(f.thread.id);
    for (const mutation of [
      "path",
      "run",
      "thread",
      "revision",
      "plan",
    ] as const) {
      const events = structuredClone(detail.events),
        event = events.findLast((e) => e.type === "plan.artifact.verified")!;
      const p = event.payload as Record<string, unknown>,
        snapshot = p["runProgressSnapshot"] as Record<string, unknown>;
      if (mutation === "path") p["path"] = "other.txt";
      if (mutation === "run") event.runId = "run_other";
      if (mutation === "thread") event.threadId = "thread_other";
      if (mutation === "revision") snapshot["revision"] = 999;
      if (mutation === "plan") snapshot["planIdSha256"] = sha256("other_plan");
      const { contentSha256: _digest, ...content } = snapshot;
      snapshot["contentSha256"] = sha256(canonicalJson(content));
      const entry = projectTaskNarrative(detail, events).deliverables![0]!;
      expect(entry.currentVersion, mutation).toBeUndefined();
      expect(entry.history?.reason, mutation).toBe("invalid_event");
      expect(entry.verification).toBe("unverified");
    }
  } finally {
    await f.close();
  }
});
