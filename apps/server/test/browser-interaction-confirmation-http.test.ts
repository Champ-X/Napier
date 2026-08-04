import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { LocalStore } from "@napier/runtime";
import { BrowserInteractionConfirmationManager } from "@napier/runtime/browser-interaction-confirmations";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { registerThreadControlHttp } from "../src/thread-control-http.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Browser interaction confirmation HTTP", () => {
  it("approves one pending exact request and rejects replay", async () => {
    const fixture = await createFixture();
    const app = new Hono();
    registerThreadControlHttp(app, {
      store: fixture.store,
      runtime: { browserInteractionConfirmations: fixture.confirmations },
    });
    const owner = { threadId: fixture.threadId, runId: fixture.runId };
    const waiting = fixture.confirmations.request({
      ...owner,
      callId: "call_http_click",
      action: "click",
      argumentsSha256: "a".repeat(64),
      preview: {
        targetKind: "selector",
        targetSha256: "c".repeat(64),
        crossOriginAuthorized: false,
      },
    });
    const listResponse = await app.request(
      `/api/threads/${owner.threadId}/runs/${owner.runId}/browser-interaction-confirmations`,
    );
    expect(listResponse.status).toBe(200);
    const [pending] = (await listResponse.json()) as Array<{
      id: string;
      action: string;
      requestSha256: string;
    }>;
    expect(pending).toEqual(
      expect.objectContaining({
        action: "click",
        requestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );

    const decisionPath = `/api/threads/${owner.threadId}/runs/${owner.runId}/browser-interaction-confirmations/${pending!.id}/decision`;
    const changed = await app.request(decisionPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "approve",
        expectedRequestSha256: "b".repeat(64),
      }),
    });
    expect(changed.status).toBe(409);

    const approved = await app.request(decisionPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "approve",
        expectedRequestSha256: pending!.requestSha256,
      }),
    });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual(
      expect.objectContaining({
        action: "click",
        status: "approved",
      }),
    );
    await expect(waiting).resolves.toEqual(
      expect.objectContaining({ decision: "approve" }),
    );
    const replay = await app.request(decisionPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "approve",
        expectedRequestSha256: pending!.requestSha256,
      }),
    });
    expect(replay.status).toBe(409);
    await fixture.store.close();
  });
});

async function createFixture(): Promise<{
  store: LocalStore;
  confirmations: BrowserInteractionConfirmationManager;
  threadId: string;
  runId: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-browser-http-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "state"),
  });
  await store.initialize();
  const thread = await store.createThread({
    title: "Browser confirmation HTTP",
    agentId: store.listAgents()[0]!.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: thread.agentId,
    model: { provider: "faux-browser-http", id: "faux-1" },
  });
  return {
    store,
    confirmations: new BrowserInteractionConfirmationManager(store, {
      available: true,
      timeoutMs: 5_000,
    }),
    threadId: thread.id,
    runId: run.id,
  };
}
