import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";
import { createApprovalFixture } from "../../../packages/runtime/test/fixtures/workflow-approval-recovery-setup.js";
import { registerWorkflowRecoveryHttp } from "../src/workflow-recovery-http.js";
import {
  getWorkflowRecovery,
  recoverWorkflow,
} from "../../web/src/workflow-recovery-api.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const close of cleanup.splice(0)) await close();
});
async function create() {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-workflow-http-checkpoint-"),
  );
  const fixture = await createApprovalFixture(root);
  cleanup.push(async () => {
    fixture.store.close();
    await rm(root, { force: true, recursive: true });
  });
  const app = new Hono();
  registerWorkflowRecoveryHttp(app, fixture);
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    app.request(url, init),
  );
  const { threadId, planId } = fixture.request;
  const url = `/api/threads/${threadId}/workflows/${planId}/recovery`;
  return { ...fixture, app, root, threadId, planId, url };
}

it("binds recovery to the original manifest and re-queries a lost successful response", async () => {
  const fixture = await create();
  const { threadId, planId, request, app } = fixture;
  expect((await getWorkflowRecovery(threadId, planId)).status).toBe(
    "waiting_answer",
  );
  await fixture.store.answerOperatorDecision(
    threadId,
    request.decisionId,
    request.answer,
  );
  const checkpoint = await getWorkflowRecovery(threadId, planId);
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const response = await app.request(url, init);
    if (init?.method === "POST")
      throw new TypeError("response lost after commit");
    return response;
  });
  await expect(recoverWorkflow(checkpoint)).rejects.toThrow("response lost");
  expect((await getWorkflowRecovery(threadId, planId)).status).toBe(
    "completed",
  );
  const file = path.join(fixture.root, "workspace/approved.txt");
  const before = await stat(file);
  const replay = await app.request(fixture.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkpointSha256: checkpoint.checkpointSha256 }),
  });
  expect(replay.status).toBe(409);
  const after = await stat(file);
  expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
  expect(await readFile(file, "utf8")).toBe(request.answer.customText);
});

it("rejects caller-supplied manifests, malformed and oversized actions without execution", async () => {
  const fixture = await create();
  const before = await fixture.store.listEvents(fixture.threadId);
  for (const body of [
    "{}",
    JSON.stringify({
      checkpointSha256: "a".repeat(64),
      manifest: fixture.request.manifest,
    }),
    JSON.stringify({ checkpointSha256: "x" }),
    "x".repeat(1100),
  ]) {
    expect([400, 413]).toContain(
      (await fixture.app.request(fixture.url, { method: "POST", body })).status,
    );
  }
  expect(await fixture.store.listEvents(fixture.threadId)).toEqual(before);
});

it("validates the result digest and rejects a mismatched returned checkpoint", async () => {
  const fixture = await create();
  await fixture.store.answerOperatorDecision(
    fixture.threadId,
    fixture.request.decisionId,
    fixture.request.answer,
  );
  const checkpoint = await getWorkflowRecovery(
    fixture.threadId,
    fixture.planId,
  );
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const response = await fixture.app.request(url, init);
    const body = await response.json();
    return Response.json({ ...body, checkpointSha256: "0".repeat(64) });
  });
  await expect(recoverWorkflow(checkpoint)).rejects.toThrow(
    "result binding is invalid",
  );
});
