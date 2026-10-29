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
 const f=await fixture(),registry=new KernelProjectionRegistry(),service=new TaskNarrativeProjectionService(registry,f.store);
 try {
  vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(new Date("2026-10-30T00:00:00.123Z"));
  await f.produced();await f.verified("a");
  const before=await f.store.getDetail(f.thread.id);
  expect((await service.project(f.thread.id)).view.deliverables).toEqual(before.taskNarrative!.deliverables);
  const append=vi.spyOn(f.store,"appendEvent").mockRejectedValueOnce(new Error("append failed after state persisted"));
  expect((await f.verified("a")).status).toBe(500);append.mockRestore();
  const detail=await f.store.getDetail(f.thread.id),entry=detail.taskNarrative!.deliverables![0]!;
  await writeFile("/tmp/napier-g01-independent-history-20261030/observed-gap-final.json",JSON.stringify({before:before.taskNarrative!.deliverables![0],after:entry,planRevision:detail.plans[0]!.revision},null,2));
  expect(entry.currentVersion).toBeUndefined();
  expect(entry.sourceEventId).toBeUndefined();
  expect(entry.history?.reason).toBe("missing_current_event");
  expect((await service.project(f.thread.id)).view.deliverables).toEqual(detail.taskNarrative!.deliverables);
  vi.useRealTimers();await f.stop();
  const reopened=new LocalStore({workspaceRoot:f.workspaceRoot,dataRoot:f.dataRoot});
  try {await reopened.initialize();expect((await reopened.getDetail(f.thread.id)).taskNarrative!.deliverables).toEqual(detail.taskNarrative!.deliverables);}
  finally {await reopened.shutdown();}
 } finally {vi.useRealTimers();vi.restoreAllMocks();registry.shutdown();await f.close();}
});

it("does not pass HTTP verified metadata without size, then observes current bytes and rejects the old revision", async () => {
 const f=await fixture();
 try {
  await writeFile(path.join(f.workspaceRoot,"report.txt"),"abc"); await f.produced();
  expect((await f.post({status:"verified",sourceRunId:f.run.id,evidence:"digest without size",sha256:sha256("abc")})).status).toBe(200);
  const incomplete=await f.store.getDetail(f.thread.id);
  expect(incomplete.taskNarrative!.deliverables![0]).toMatchObject({verification:"unverified",accessibility:"available",observation:{status:"observed",sha256:sha256("abc"),sizeBytes:3}});
  expect(taskArtifactFacts(incomplete.plans,incomplete.taskNarrative!.deliverables).status).toBe("unknown");
  expect((await f.post({status:"verified",sourceRunId:f.run.id,evidence:"digest and size",sha256:sha256("abc"),sizeBytes:3})).status).toBe(200);
  const complete=await f.store.getDetail(f.thread.id);
  expect(taskArtifactFacts(complete.plans,complete.taskNarrative!.deliverables).status).toBe("passed");
  expect(taskArtifactFacts(complete.plans,incomplete.taskNarrative!.deliverables).status).toBe("unknown");
  const eventCount=complete.thread.eventCount;
  await writeFile(path.join(f.workspaceRoot,"report.txt"),"xyz");
  const drifted=await f.store.getDetail(f.thread.id);
  expect(drifted.thread.eventCount).toBe(eventCount);
  expect(taskArtifactFacts(drifted.plans,drifted.taskNarrative!.deliverables)).toMatchObject({status:"failed",driftedArtifactCount:1,verifiedArtifactCount:0});
 } finally {await f.close();}
});

it("does not call currently observed bytes missing because an older declaration says missing", async () => {
 const f=await fixture();
 try {
  await f.produced();
  expect((await f.post({status:"missing",sourceRunId:f.run.id,evidence:"was missing"})).status).toBe(200);
  await writeFile(path.join(f.workspaceRoot,"report.txt"),"reappeared bytes");
  const detail=await f.store.getDetail(f.thread.id),entry=detail.taskNarrative!.deliverables![0]!,facts=taskArtifactFacts(detail.plans,detail.taskNarrative!.deliverables);
  await writeFile("/tmp/napier-g01-independent-history-20261030/observed-reappeared-final.json",JSON.stringify({entry,facts},null,2));
  expect(entry).toMatchObject({artifact:{status:"missing"},accessibility:"available",verification:"unverified",observation:{status:"observed"}});
  expect(facts.missingArtifactCount).toBe(0);
  expect(facts.status).toBe("unknown");
 } finally {await f.close();}
});
