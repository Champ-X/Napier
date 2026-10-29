import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserUseCloudBackend } from "../src/browser-use-cloud-backend.js";
import type {
  ExecutionResourceCleanup,
  ExecutionResourceLease,
} from "../src/execution-resource-admission.js";

const roots: string[] = [];
const request = {
  task: "Read the public release notes",
  startUrl: "https://example.com/releases",
  model: { provider: "browser-use", id: "fixture" },
  allowedDomains: ["example.com"],
  maxSteps: 3,
  maxCostUsd: 0.5,
};
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Browser Use Cloud remote task resource lifetime", () => {
  it("retains capacity after stop acknowledgement until a matching provider terminal is observed", async () => {
    const terminal = deferred<Response>();
    const receipt = lease();
    const methods: string[] = [];
    const backend = await fixture(receipt.value, async (_input, init) => {
      methods.push(init!.method!);
      if (init?.method === "POST") {
        expect(receipt.dispatch).toHaveBeenCalledOnce();
        return json({ id: "provider_task" });
      }
      expect(receipt.bind).toHaveBeenCalledWith({
        resourceId: "provider_task",
      });
      if (init?.method === "PATCH") return json({ accepted: true });
      if (methods.length === 2)
        return json({
          id: "provider_task",
          status: "started",
          cost: 1,
          steps: [],
        });
      return terminal.promise;
    });
    const running = backend.run(request, () => undefined);
    await vi.waitFor(() =>
      expect(methods).toEqual(["POST", "GET", "PATCH", "GET"]),
    );
    expect(receipt.settle).not.toHaveBeenCalled();
    terminal.resolve(
      json({ id: "provider_task", status: "stopped", steps: [] }),
    );
    await expect(running).resolves.toMatchObject({ status: "failed" });
    expect(receipt.settle).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "released",
        reason: "cloud_task_terminal_confirmed",
      }),
    );
  });

  it.each(["still running", "stop failed"] as const)(
    "quarantines when stop was %s instead of claiming cleanup",
    async (failure) => {
      const receipt = lease();
      const methods: string[] = [];
      const backend = await fixture(
        receipt.value,
        async (_input, init) => {
          methods.push(init!.method!);
          if (init?.method === "POST") return json({ id: "provider_task" });
          if (init?.method === "PATCH")
            return json(
              { accepted: true },
              failure === "stop failed" ? 500 : 200,
            );
          return json({
            id: "provider_task",
            status: "started",
            cost: 1,
            steps: [],
          });
        },
        25,
      );
      await expect(backend.run(request, () => undefined)).rejects.toMatchObject(
        { code: "resource_cleanup_unconfirmed" },
      );
      expect(receipt.settle).toHaveBeenCalledWith(
        expect.objectContaining({ status: "unknown" }),
      );
      expect(methods.filter((method) => method === "PATCH")).toHaveLength(1);
      if (failure === "stop failed")
        expect(methods).toEqual(["POST", "GET", "PATCH"]);
      else
        expect(
          methods.filter((method) => method === "GET").length,
        ).toBeGreaterThan(1);
    },
  );

  it("retains an unknown task after the POST response is lost", async () => {
    const receipt = lease();
    const fetch = vi.fn(async () => {
      throw new Error("fixture lost create response");
    });
    const backend = await fixture(receipt.value, fetch);
    await expect(backend.run(request, () => undefined)).rejects.toMatchObject({
      code: "resource_cleanup_unconfirmed",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(receipt.bind).not.toHaveBeenCalled();
    expect(receipt.settle).toHaveBeenCalledWith(
      expect.objectContaining({ status: "unknown" }),
    );
  });

  it("preserves confirmed terminal cleanup when observation persistence subsequently fails", async () => {
    const receipt = lease();
    const failure = new Error("fixture observation journal failed");
    const methods: string[] = [];
    const backend = await fixture(receipt.value, async (_input, init) => {
      methods.push(init!.method!);
      if (init?.method === "POST") return json({ id: "provider_task" });
      return json({
        id: "provider_task",
        status: "finished",
        steps: [{ number: 1, url: request.startUrl, actions: [] }],
      });
    });
    await expect(
      backend.run(request, (event) => {
        if (event.type === "step") throw failure;
      }),
    ).rejects.toBe(failure);
    expect(methods).toEqual(["POST", "GET"]);
    expect(receipt.settle).toHaveBeenCalledOnce();
    expect(receipt.settle).toHaveBeenCalledWith(
      expect.objectContaining({ status: "released" }),
    );
  });

  it("stops and confirms a known task when its initial observation fails", async () => {
    const receipt = lease();
    const failure = new Error("fixture started observation failed");
    const methods: string[] = [];
    const backend = await fixture(receipt.value, async (_input, init) => {
      methods.push(init!.method!);
      return json(
        init?.method === "POST"
          ? { id: "provider_task" }
          : init?.method === "PATCH"
            ? { accepted: true }
            : { id: "provider_task", status: "stopped", steps: [] },
      );
    });
    await expect(
      backend.run(request, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(methods).toEqual(["POST", "PATCH", "GET"]);
    expect(receipt.settle).toHaveBeenCalledWith(
      expect.objectContaining({ status: "released" }),
    );
  });

  it("uses a separate bounded cleanup signal after cancellation", async () => {
    const receipt = lease();
    const controller = new AbortController();
    const backend = await fixture(receipt.value, async (_input, init) => {
      if (init?.method === "POST") return json({ id: "provider_task" });
      expect(init?.signal).not.toBe(controller.signal);
      expect(init?.signal?.aborted).toBe(false);
      return json(
        init?.method === "PATCH"
          ? { accepted: true }
          : { id: "provider_task", status: "stopped", steps: [] },
      );
    });
    await expect(
      backend.run(request, () => controller.abort(), controller.signal),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(receipt.settle).toHaveBeenCalledWith(
      expect.objectContaining({ status: "released" }),
    );
  });

  it("settles validation failure without dispatch and rejects reuse of a supplied lease", async () => {
    const receipt = lease();
    const fetch = vi.fn();
    const backend = await fixture(receipt.value, fetch);
    await expect(
      backend.run({ ...request, task: "" }, () => undefined),
    ).rejects.toThrow("1-8000");
    expect(fetch).not.toHaveBeenCalled();
    expect(receipt.dispatch).not.toHaveBeenCalled();
    expect(receipt.settle).toHaveBeenCalledWith(
      expect.objectContaining({ status: "not_started" }),
    );
    await expect(backend.run(request, () => undefined)).rejects.toThrow(
      "already used",
    );
    expect(receipt.settle).toHaveBeenCalledOnce();
  });

  it("does not accept a different task's terminal status as cleanup evidence", async () => {
    const receipt = lease();
    const methods: string[] = [];
    const backend = await fixture(receipt.value, async (_input, init) => {
      methods.push(init!.method!);
      if (init?.method === "POST") return json({ id: "provider_task" });
      if (init?.method === "PATCH") return json({ accepted: true });
      return json({
        id: methods.length === 2 ? "unrelated_task" : "provider_task",
        status: "finished",
        steps: [],
      });
    });
    await expect(backend.run(request, () => undefined)).rejects.toMatchObject({
      code: "provider_protocol_invalid",
    });
    expect(methods).toEqual(["POST", "GET", "PATCH", "GET"]);
    expect(receipt.settle).toHaveBeenCalledWith(
      expect.objectContaining({ status: "released" }),
    );
  });

  it("propagates failed resource accounting after a verified provider terminal", async () => {
    const receipt = lease();
    receipt.settle.mockImplementation(() => {
      throw new Error("fixture ledger failed");
    });
    const backend = await fixture(receipt.value, async (_input, init) =>
      json(
        init?.method === "POST"
          ? { id: "provider_task" }
          : { id: "provider_task", status: "finished", steps: [] },
      ),
    );
    await expect(backend.run(request, () => undefined)).rejects.toMatchObject({
      code: "resource_accounting_failed",
    });
    expect(receipt.settle).toHaveBeenCalledWith(
      expect.objectContaining({ status: "released" }),
    );
  });
});

async function fixture(
  resourceLease: ExecutionResourceLease,
  fetchImpl: typeof fetch,
  cleanupTimeoutMs = 500,
) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-cloud-resource-"));
  roots.push(root);
  return new BrowserUseCloudBackend({
    dataRoot: root,
    apiKey: "fixture-key",
    resourceLease,
    fetch: fetchImpl,
    pollIntervalMs: 1,
    cleanupTimeoutMs,
  });
}
function lease() {
  const dispatch = vi.fn(),
    bind = vi.fn();
  const settle = vi.fn((_evidence: ExecutionResourceCleanup) => undefined);
  return {
    dispatch,
    bind,
    settle,
    value: {
      id: "fixture_lease",
      dispatched: dispatch,
      bind,
      settle,
    } satisfies ExecutionResourceLease,
  };
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
