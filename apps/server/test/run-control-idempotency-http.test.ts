import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createApp, createServices } from "../src/app.js";

it("reconciles lost queue responses over HTTP and rejects conflicting client identities", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-control-http-"));
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const services = await createServices({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
    env: {},
    startAutomation: false,
  });
  try {
    const store = services.store,
      agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Retry control submission",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux-control", id: "faux-1" },
    });
    const app = createApp(services);
    const endpoint = `/api/threads/${thread.id}/runs/${run.id}/control-messages`;
    const body = {
      clientMessageId: "browser-6caa2315-f692",
      mode: "follow_up",
      text: "Verify the result before replying.",
    };
    const request = (value = body) =>
      app.request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
      });
    const first = await request();
    expect(first.status).toBe(202);
    // Discard the first successful response, as when transport loses it after persistence.
    await first.body?.cancel();
    const retry = await request();
    expect(retry.status).toBe(202);
    const queued = await retry.json();
    expect(queued.clientMessageId).toBe(body.clientMessageId);
    expect(
      (await request({ ...body, text: "Conflicting content." })).status,
    ).toBe(409);
    expect(
      (await request({ ...body, clientMessageId: "invalid value" })).status,
    ).toBe(400);
    const cancelled = await app.request(`${endpoint}/${queued.id}/cancel`, {
      method: "POST",
    });
    expect(cancelled.status).toBe(200);
    expect((await (await request()).json()).status).toBe("cancelled");
    await store.finishRun(run.id, "completed");
    const settled = await request();
    expect(settled.status).toBe(202);
    expect((await settled.json()).id).toBe(queued.id);
    expect(
      (await store.listEvents(thread.id)).filter(
        (event) => event.type === "run.control.queued",
      ),
    ).toHaveLength(1);
    expect(
      (await store.listEvents(thread.id)).filter(
        (event) => event.type === "run.control.cancelled",
      ),
    ).toHaveLength(1);
    expect(
      (await request({ ...body, clientMessageId: "brand-new-message" })).status,
    ).toBe(409);
  } finally {
    await services.shutdownLocalRuntime();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
