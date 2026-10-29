import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { LocalStore } from "/private/tmp/napier-artifact-facts-verify-20261030/packages/runtime/src/store.ts";
import {
  createPlanTools,
  exportWorkspaceFileArtifact,
} from "/private/tmp/napier-artifact-facts-verify-20261030/packages/runtime/src/plan-tools.ts";
import {
  TaskNarrativeProjectionService,
  KernelProjectionRegistry,
} from "/private/tmp/napier-artifact-facts-verify-20261030/packages/runtime/src/kernel-projections.ts";
import {
  projectTaskNarrative,
  taskArtifactFacts,
} from "@napier/contracts/task-narrative";
import {
  canonicalJson,
  sha256,
} from "/private/tmp/napier-artifact-facts-verify-20261030/packages/runtime/src/ed25519.ts";
import { registerPlanProgressHttp } from "/private/tmp/napier-artifact-facts-verify-20261030/apps/server/src/plan-progress-http.ts";
import { taskValidationMatrix } from "/private/tmp/napier-artifact-facts-verify-20261030/apps/web/src/task-validation-matrix.ts";
import { isTaskNarrativeProjection } from "/private/tmp/napier-artifact-facts-verify-20261030/apps/web/src/task-narrative-protocol.ts";

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


it("does not borrow previous event when identical metadata is reasserted in the same clock tick but append fails", async () => {
 const f=await fixture();
 try {
  vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(new Date("2026-10-30T00:00:00.123Z"));
  await f.produced();await f.verified("a");
  const before=await f.store.getDetail(f.thread.id);
  const append=vi.spyOn(f.store,"appendEvent").mockRejectedValueOnce(new Error("append failed after state persisted"));
  expect((await f.verified("a")).status).toBe(500);append.mockRestore();
  const detail=await f.store.getDetail(f.thread.id),entry=detail.taskNarrative!.deliverables![0]!;
  await writeFile("/tmp/napier-g01-independent-history-20261030/observed-gap.json",JSON.stringify({before:before.taskNarrative!.deliverables![0],after:entry,planRevision:detail.plans[0]!.revision},null,2));
  expect(entry.currentVersion).toBeUndefined();
  expect(entry.sourceEventId).toBeUndefined();
  expect(entry.history?.reason).toBe("missing_current_event");
 } finally {vi.useRealTimers();vi.restoreAllMocks();await f.close();}
});

