import { describe, expect, it } from "vitest";

import { createWorkspaceRuntimeFetch, WORKSPACE_RUNTIME_HEADER } from "../src/workspace-runtime-http.js";
import { deferred, runtimeFixture } from "./workspace-runtime-test-fixture.js";

describe("workspace-addressed transport", () => {
  it("binds identical thread/control/artifact IDs to the addressed workspace", async () => {
    const f = await runtimeFixture();
    const requests: Array<{ workspace: string; path: string; body: string }> = [];
    const fetch = createWorkspaceRuntimeFetch({
      registry: f.registry, defaultWorkspaceId: f.a.workspaceId,
      fetch: async (runtime, request) => {
        requests.push({ workspace: runtime.name, path: new URL(request.url).pathname, body: await request.text() });
        return new Response(`${runtime.name}:same-artifact`, { headers: { "X-Evidence": "preserved" } });
      },
    });
    try {
      for (const identity of [f.a, f.b]) {
        const response = await fetch(new Request(`http://localhost/api/workspaces/${identity.workspaceId}/threads/same-thread/control`, {
          method: "POST", body: "same-control",
        }));
        expect(response.headers.get(WORKSPACE_RUNTIME_HEADER)).toBe(identity.workspaceId);
        expect(response.headers.get("X-Evidence")).toBe("preserved");
        expect(await response.text()).toBe(`${identity === f.a ? "a" : "b"}:same-artifact`);
      }
      expect(requests).toEqual([
        { workspace: "a", path: "/api/threads/same-thread/control", body: "same-control" },
        { workspace: "b", path: "/api/threads/same-thread/control", body: "same-control" },
      ]);
      const legacy = await fetch(new Request("http://localhost/api/bootstrap"));
      expect(await legacy.text()).toBe("a:same-artifact");
    } finally { await f.cleanup(); }
  });

  it("rejects invalid, conflicting, unknown and non-loopback addresses before dispatch", async () => {
    const f = await runtimeFixture();
    let calls = 0;
    const fetch = createWorkspaceRuntimeFetch({ registry: f.registry, defaultWorkspaceId: f.a.workspaceId,
      fetch: () => { calls += 1; return new Response("unexpected"); },
    });
    try {
      const cases = [
        [new Request("http://localhost/api/workspaces/bad/bootstrap"), 400],
        [new Request(`http://localhost/api/workspaces/${f.a.workspaceId}/bootstrap`, { headers: { [WORKSPACE_RUNTIME_HEADER]: f.b.workspaceId } }), 400],
        [new Request(`http://localhost/api/workspaces/workspace_${"0".repeat(64)}/bootstrap`), 404],
        [new Request(`http://attacker.invalid/api/workspaces/${f.a.workspaceId}/bootstrap`), 403],
      ] as const;
      for (const [request, status] of cases) {
        const response = await fetch(request);
        expect(response.status).toBe(status); await response.text();
      }
      expect(calls).toBe(0); expect(f.prepared).toEqual([]);
    } finally { await f.cleanup(); }
  });

  it("keeps two streams separately pinned until consumption or cancellation", async () => {
    const f = await runtimeFixture({ maxIdle: 0 });
    const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
    const encoder = new TextEncoder();
    const fetch = createWorkspaceRuntimeFetch({ registry: f.registry, defaultWorkspaceId: f.a.workspaceId,
      fetch: (runtime) => new Response(new ReadableStream<Uint8Array>({ start(controller) {
        streams.set(runtime.name, controller);
        controller.enqueue(encoder.encode(`data: ${runtime.name}\n\n`));
      } }), { headers: { "Content-Type": "text/event-stream" } }),
    });
    const a = await fetch(new Request(`http://localhost/api/workspaces/${f.a.workspaceId}/events`));
    const b = await fetch(new Request(`http://localhost/api/workspaces/${f.b.workspaceId}/events`));
    const aReader = a.body!.getReader(); const bReader = b.body!.getReader();
    try {
      expect(new TextDecoder().decode((await aReader.read()).value)).toContain("data: a");
      expect(new TextDecoder().decode((await bReader.read()).value)).toContain("data: b");
      expect(await f.registry.reclaimIdle()).toEqual([]);
      await bReader.cancel();
      expect(await f.registry.reclaimIdle()).toEqual([f.b.workspaceId]);
      streams.get("a")!.close();
      expect((await aReader.read()).done).toBe(true);
      expect(await f.registry.reclaimIdle()).toEqual([f.a.workspaceId]);
    } finally { await aReader.cancel(); await bReader.cancel(); await f.cleanup(); }
  });

  it("releases the transport pin on disconnect while active execution remains protected", async () => {
    const f = await runtimeFixture({ maxIdle: 0 });
    const controller = new AbortController();
    const cancelled = deferred<void>();
    const lease = await f.registry.acquire(f.a.workspaceId); lease.runtime.busy = true; lease.release();
    const fetch = createWorkspaceRuntimeFetch({ registry: f.registry, defaultWorkspaceId: f.a.workspaceId,
      fetch: () => new Response(new ReadableStream({ cancel: () => cancelled.resolve() })),
    });
    const response = await fetch(new Request("http://localhost/api/events", { signal: controller.signal }));
    controller.abort(); await cancelled.promise;
    try {
      expect(await response.text()).toBe("");
      expect(await f.registry.reclaimIdle()).toEqual([]);
      lease.runtime.busy = false;
      expect(await f.registry.reclaimIdle()).toEqual([f.a.workspaceId]);
    } finally { await f.cleanup(); }
  });

  it.each(["body", "request"] as const)("retains the observer pin until async cancellation settles (%s)", async (source) => {
    const f = await runtimeFixture({ maxIdle: 0 });
    const controller = new AbortController();
    const cancelling = deferred<void>();
    const cleaned = deferred<void>();
    const fetch = createWorkspaceRuntimeFetch({
      registry: f.registry, defaultWorkspaceId: f.a.workspaceId,
      fetch: () => new Response(new ReadableStream({
        async cancel() { cancelling.resolve(); await cleaned.promise; },
      })),
    });
    const response = await fetch(new Request("http://localhost/api/events", { signal: controller.signal }));
    let cancellation: Promise<void> | undefined;
    try {
      if (source === "request") controller.abort();
      else cancellation = response.body!.cancel();
      await cancelling.promise;
      expect(await f.registry.reclaimIdle()).toEqual([]);
      const shutdown = f.registry.shutdown();
      expect(f.disposed).toEqual([]);
      cleaned.resolve();
      await cancellation;
      await shutdown;
      expect(f.disposed).toEqual(["a"]);
    } finally {
      cleaned.resolve();
      await response.body!.cancel();
      await f.cleanup();
    }
  });

  it("releases leases after handler errors, empty responses, and stream errors", async () => {
    const f = await runtimeFixture({ maxIdle: 0 });
    let mode = "throw";
    const fetch = createWorkspaceRuntimeFetch({ registry: f.registry, defaultWorkspaceId: f.a.workspaceId,
      fetch: () => {
        if (mode === "throw") throw new Error("handler failed");
        if (mode === "empty") return new Response(null, { status: 204 });
        return new Response(new ReadableStream({ start(controller) { controller.error(new Error("stream failed")); } }));
      },
    });
    try {
      await expect(fetch(new Request("http://localhost/api/events"))).rejects.toThrow("handler failed");
      expect(await f.registry.reclaimIdle()).toHaveLength(1);
      mode = "empty";
      expect((await fetch(new Request("http://localhost/api/events"))).status).toBe(204);
      expect(await f.registry.reclaimIdle()).toHaveLength(1);
      mode = "stream";
      const response = await fetch(new Request("http://localhost/api/events"));
      await expect(response.text()).rejects.toThrow("stream failed");
      expect(await f.registry.reclaimIdle()).toHaveLength(1);
    } finally { await f.cleanup(); }
  });

  it("retains a disconnected execution before Run creation and drains it to settlement", async () => {
    const f = await runtimeFixture({ maxIdle: 0 });
    const controller = new AbortController();
    let producer!: ReadableStreamDefaultController<Uint8Array>;
    let cancelled = false;
    const fetch = createWorkspaceRuntimeFetch({ registry: f.registry, defaultWorkspaceId: f.a.workspaceId,
      fetch: () => new Response(new ReadableStream({
        start(value) { producer = value; }, cancel() { cancelled = true; },
      }), { headers: { "content-type": "text/event-stream" } }),
    });
    const response = await fetch(new Request("http://localhost/api/messages", { method: "POST", signal: controller.signal }));
    controller.abort();
    await response.body!.cancel();
    expect(await f.registry.reclaimIdle()).toEqual([]);
    expect(cancelled).toBe(false);
    const shutdown = f.registry.shutdown();
    producer.enqueue(new TextEncoder().encode("data: complete\n\n"));
    producer.close();
    await shutdown;
    expect(f.disposed).toEqual(["a"]);
    await f.cleanup();
  });
});
