import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { LocalStore } from "../src/store.js";
import { createPlanArtifactEventPayload } from "../src/plans.js";
import { KernelProjectionRegistry } from "../src/kernel-projections.js";
import { ConversationArtifactsProjectionService } from "../src/kernel-detail-projections.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  try { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); }
  finally { vi.useRealTimers(); }
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-artifact-event-version-"));
  const store = new LocalStore({ workspaceRoot: path.join(root, "workspace"), dataRoot: path.join(root, "state") });
  await store.initialize();
  const registry = new KernelProjectionRegistry();
  cleanups.push(async () => { registry.shutdown(); await store.shutdown(); await rm(root, { recursive: true, force: true }); });
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({ title: "Artifact event binding", agentId: agent.id });
  const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
  let plan = await store.createPlan(thread.id, {
    objective: "Retain exact artifact version identity",
    steps: [{ id: "deliver", title: "Deliver", description: "Deliver", verification: "Inspect bytes" }],
    artifacts: [{ id: "report", path: "report.txt", description: "Report" }],
  });
  plan = await store.updatePlanArtifact(plan.id, "report", {
    status: "produced", sourceRunId: run.id, evidence: "Report was declared produced",
  });
  plan = await store.updatePlanArtifact(plan.id, "report", {
    status: "verified", sourceRunId: run.id, sha256: "a".repeat(64), sizeBytes: 1, evidence: "Version A declaration",
  });
  const event = await store.appendEvent({ threadId: thread.id, runId: run.id,
    type: "plan.artifact.verified", category: "plan", visibility: "user",
    payload: createPlanArtifactEventPayload(plan, plan.artifacts[0]!),
  });
  return { store, registry, thread, run, plan, event,
    service: new ConversationArtifactsProjectionService(registry, store) };
}

it("does not join an old event to a newer manifest after a state-only update, warm or cold", async () => {
  const f = await fixture();
  expect((await f.service.project(f.thread.id)).view).toMatchObject([{ id: f.event.id, planRevision: f.plan.revision }]);
  const updated = await f.store.updatePlanArtifact(f.plan.id, "report", {
    status: "verified", sourceRunId: f.run.id, sha256: "b".repeat(64), sizeBytes: 2, evidence: "Version B declaration",
  });
  const warm = await f.service.project(f.thread.id);
  expect(warm.cacheHit).toBe(true);
  expect(warm.appliedEventCount).toBe(0);
  expect(warm.view).toEqual([]);
  expect((await f.store.getDetail(f.thread.id)).artifacts).toEqual([]);
  const coldRegistry = new KernelProjectionRegistry();
  try {
    expect((await new ConversationArtifactsProjectionService(coldRegistry, f.store).project(f.thread.id)).view).toEqual([]);
  } finally { coldRegistry.shutdown(); }
  // The declaration remains available even when no event can own its timeline card.
  expect(f.store.listPlans(f.thread.id)[0]!.artifacts[0]!.sha256).toBe("b".repeat(64));
  await f.store.appendEvent({ threadId: f.thread.id, runId: f.run.id,
    type: "plan.artifact.verified", category: "plan", visibility: "user",
    payload: createPlanArtifactEventPayload(updated, updated.artifacts[0]!),
  });
  expect((await f.service.project(f.thread.id)).view).toMatchObject([{
    planRevision: updated.revision, artifact: { sha256: "b".repeat(64), sizeBytes: 2 },
  }]);
});

it("keeps missing-current-event semantics for identical same-clock metadata at a new revision", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-30T00:00:00.000Z"));
  const f = await fixture();
  const updated = await f.store.updatePlanArtifact(f.plan.id, "report", {
    status: "verified", sourceRunId: f.run.id, sha256: "a".repeat(64), sizeBytes: 1, evidence: "Version A declaration",
  });
  expect(updated.revision).toBeGreaterThan(f.plan.revision);
  expect(updated.artifacts[0]!.updatedAt).toBe(f.plan.artifacts[0]!.updatedAt);
  expect((await f.service.project(f.thread.id)).view).toEqual([]);
});

it("rejects a latest id-only assertion instead of attaching authoritative current metadata", async () => {
  const f = await fixture();
  await f.store.appendEvent({ threadId: f.thread.id, runId: f.run.id,
    type: "plan.artifact.verified", category: "plan", visibility: "user",
    payload: { planId: f.plan.id, artifactId: "report", status: "verified" },
  });
  expect((await f.service.project(f.thread.id)).view).toEqual([]);
});
