import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ThreadDetail } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, createServices } from "../src/app.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Thread lifecycle trash HTTP", () => {
  it("rejects active work and hides/restores settled Threads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-server-trash-"));
    roots.push(root);
    const services = await createServices({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    const app = createApp(services);
    const created = (await (
      await app.request("/api/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Trash API" }),
      })
    ).json()) as ThreadDetail;
    const run = await services.store.createRun({
      threadId: created.thread.id,
      agentId: created.thread.agentId,
    });

    const conflict = await app.request(`/api/threads/${created.thread.id}`, {
      method: "DELETE",
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual(
      expect.objectContaining({
        error: "Thread with active work cannot be moved to trash",
      }),
    );

    await services.store.finishRun(run.id, "completed");
    const trashed = await app.request(`/api/threads/${created.thread.id}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    expect(trashed.status).toBe(200);
    expect(trashed.headers.get("preference-applied")).toBe("return=minimal");
    expect(trashed.headers.get("x-napier-content-sha256")).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(await trashed.json()).toEqual(
      expect.objectContaining({
        id: created.thread.id,
        status: "idle",
      }),
    );
    expect(await visibleThreadIds(app)).not.toContain(created.thread.id);

    const restored = await app.request(
      `/api/threads/${created.thread.id}/restore`,
      { method: "POST" },
    );
    expect(restored.status).toBe(200);
    expect(await visibleThreadIds(app)).toContain(created.thread.id);
  });
});

async function visibleThreadIds(
  app: ReturnType<typeof createApp>,
): Promise<string[]> {
  const bootstrap = (await (await app.request("/api/bootstrap")).json()) as {
    threads: Array<{ id: string }>;
  };
  return bootstrap.threads.map((thread) => thread.id);
}
