import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { BrowserUseLocalError, type BrowserUseLocalTaskResult } from "@napier/runtime/browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExecutionResourceAdmission, ExecutionResourceCleanup, ExecutionResourceLease } from "../../../packages/runtime/src/execution-resource-admission.js";
import { createLocalAgentRuntime } from "../../../packages/runtime/src/local-agent-runtime.js";
import { BrowserTaskJournal } from "../src/browser-task-journal.js";
import { BrowserTasks } from "../src/browser-task-integration.js";
import { BrowserTaskService } from "../src/browser-task-service.js";
import { BrowserTaskResource } from "../src/browser-task-resource.js";
import type { BrowserTaskCreateInput, BrowserTaskEvent } from "../src/browser-task-types.js";
import { WorkspaceResourceAdmission } from "../src/workspace-resource-admission.js";

const roots: string[] = [];
const services: BrowserTaskService[] = [];
const release: ExecutionResourceCleanup = { status: "released", scope: "browser_task", reason: "fixture_owned_cleanup" };
const noStart: ExecutionResourceCleanup = { status: "not_started", scope: "browser_task", reason: "fixture_no_start" };
const unknown: ExecutionResourceCleanup = { status: "unknown", scope: "browser_task", reason: "fixture_unconfirmed_cleanup" };

afterEach(async () => {
  await Promise.allSettled(services.splice(0).map((service) => service.shutdown()));
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("BrowserTask shared resource lifecycle", () => {
  it("holds one global slot through preparation and cleanup and rejects another service before credential or runner work", async () => {
    const pool = admissionPool(1);
    const credential = deferred<string>();
    const cleaned = deferred<void>();
    const resolveFirst = vi.fn(() => credential.promise);
    const resolveSecond = vi.fn(async () => "fixture-key");
    const createFirst = vi.fn(({ resourceLease }: { resourceLease?: ExecutionResourceLease }) => ({
      run: vi.fn(async () => {
        expect(pool.records[0]!.lease.dispatched).toHaveBeenCalledOnce();
        resourceLease!.dispatched();
        resourceLease!.dispatched();
        resourceLease!.bind({ resourceId: "fixture_owned_browser_a" });
        await cleaned.promise;
        resourceLease!.settle(release);
        return completed();
      }),
    }));
    const createSecond = vi.fn(({ resourceLease }: { resourceLease?: ExecutionResourceLease }) => ({
      run: async () => { resourceLease!.settle(release); return completed(); },
    }));
    const first = await fixture({ resourceAdmission: pool.admission, resolveCredential: resolveFirst, createBackend: createFirst });
    const second = await fixture({ resourceAdmission: pool.admission, resolveCredential: resolveSecond, createBackend: createSecond });
    const starting = first.service.create(request());
    try {
      expect(pool.active()).toBe(1);
      expect(first.service.hasPendingWork()).toBe(true);
      await vi.waitFor(() => expect(resolveFirst).toHaveBeenCalledOnce());
      await expect(second.service.create(request())).rejects.toThrow("shared task capacity exhausted");
      expect(resolveSecond).not.toHaveBeenCalled();
      expect(createSecond).not.toHaveBeenCalled();
      expect(pool.records[0]!.lease.dispatched).not.toHaveBeenCalled();
      credential.resolve("fixture-key");
      const created = await starting;
      expect(pool.records[0]!.request).toEqual({ kind: "browser_task", backend: "browser_use_local" });
      // The service and backend both dispatch; the durable sink sees it once.
      expect(pool.records[0]!.lease.dispatched).toHaveBeenCalledOnce();
      expect(pool.records[0]!.lease.bind).toHaveBeenCalledExactlyOnceWith({ resourceId: "fixture_owned_browser_a" });
      expect(pool.records[0]!.settlements).toEqual([]);
      await expect(second.service.create(request())).rejects.toThrow("shared task capacity exhausted");
      expect(resolveSecond).not.toHaveBeenCalled();
      cleaned.resolve();
      expect(await events(first.service, created.taskId)).toEqual([expect.objectContaining({ type: "completed", status: "completed" })]);
      expect(first.service.hasPendingWork()).toBe(false);
      expect(pool.active()).toBe(0);
      const next = await second.service.create(request());
      await events(second.service, next.taskId);
      expect(resolveSecond).toHaveBeenCalledOnce();
      expect(createSecond).toHaveBeenCalledOnce();
      expect(pool.active()).toBe(0);
    } finally {
      credential.resolve("fixture-key");
      cleaned.resolve();
      await starting.catch(() => undefined);
    }
  });

  it("shares its shutdown promise and releases pending preparation without dispatching a backend", async () => {
    const pool = admissionPool(1);
    const credential = deferred<string>();
    const resolveCredential = vi.fn(() => credential.promise);
    const createBackend = vi.fn(() => ({ run: async () => completed() }));
    const { service } = await fixture({ resourceAdmission: pool.admission, resolveCredential, createBackend });
    const starting = service.create(request());
    const rejected = expect(starting).rejects.toMatchObject({ code: "browser_task_shutting_down" });
    await vi.waitFor(() => expect(resolveCredential).toHaveBeenCalledOnce());
    const shutdown = service.shutdown();
    expect(service.shutdown()).toBe(shutdown);
    let drained = false;
    void shutdown.then(() => { drained = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(drained).toBe(false);
      expect(pool.active()).toBe(1);
      expect(service.hasPendingWork()).toBe(true);
      await expect(service.create(request())).rejects.toMatchObject({ code: "browser_task_shutting_down" });
    } finally {
      credential.resolve("fixture-key");
    }
    await rejected;
    await shutdown;
    expect(createBackend).not.toHaveBeenCalled();
    expect(pool.records[0]!.lease.dispatched).not.toHaveBeenCalled();
    expect(pool.records[0]!.settlements).toEqual([expect.objectContaining({ status: "not_started" })]);
    expect(pool.active()).toBe(0);
    expect(service.hasPendingWork()).toBe(false);
  });

  it("replaces a generic runner's business completion with unconfirmed cleanup and retains the resource", async () => {
    const pool = admissionPool(1);
    const { service, root } = await fixture({ resourceAdmission: pool.admission, createBackend: () => ({ run: async () => completed() }) });
    const created = await service.create(request());
    const observed = await events(service, created.taskId);
    expect(observed).toEqual([expect.objectContaining({ type: "error", code: "resource_cleanup_unconfirmed" })]);
    expect(pool.records[0]!.lease.dispatched).toHaveBeenCalledOnce();
    expect(pool.records[0]!.settlements).toEqual([expect.objectContaining({ status: "unknown" })]);
    expect(pool.active()).toBe(1);
    expect(service.active()).toBeUndefined();
    expect(service.hasPendingWork()).toBe(true);
    expect(await new BrowserTaskJournal(root).load()).toMatchObject({ status: "terminal", events: observed });
    await expect(service.create(request())).rejects.toMatchObject({ code: "browser_task_busy" });
    const shutdown = service.shutdown();
    expect(service.shutdown()).toBe(shutdown);
    await expect(shutdown).rejects.toThrow("resources did not drain");
  });

  it("retains a backend's business error while explicit no-start evidence releases capacity", async () => {
    const pool = admissionPool(1);
    const { service } = await fixture({
      resourceAdmission: pool.admission,
      createBackend: ({ resourceLease }) => ({
        run: async () => {
          resourceLease!.settle(noStart);
          throw new BrowserUseLocalError("Fixture runtime missing", "backend_missing", "a".repeat(64), "Install fixture runtime");
        },
      }),
    });
    const created = await service.create(request());
    expect(await events(service, created.taskId)).toEqual([expect.objectContaining({ type: "error", code: "backend_missing" })]);
    expect(pool.records[0]!.settlements).toEqual([noStart]);
    expect(pool.active()).toBe(0);
    expect(service.hasPendingWork()).toBe(false);
    await expect(service.shutdown()).resolves.toBeUndefined();
  });

  it("does not downgrade affirmed release when later observation persistence fails", async () => {
    const pool = admissionPool(1);
    const save = BrowserTaskJournal.prototype.save;
    const failure = new Error("Fixture observation journal failed");
    vi.spyOn(BrowserTaskJournal.prototype, "save").mockImplementation(async function (this: BrowserTaskJournal, record) {
      if (record.status === "running" && record.events.some((event) => event.type === "step")) throw failure;
      return save.call(this, record);
    });
    const { service } = await fixture({
      resourceAdmission: pool.admission,
      createBackend: ({ resourceLease }) => ({
        run: async (_request, observe) => {
          resourceLease!.settle(release);
          try {
            await observe({ type: "step", backend: "browser_use_local", step: 1, url: "https://example.com", title: "Fixture", actionNames: [] });
          } catch (error) {
            resourceLease!.settle(unknown);
            throw error;
          }
          return completed();
        },
      }),
    });
    const created = await service.create(request());
    const observed = await events(service, created.taskId);
    expect(observed.at(-1)).toMatchObject({ type: "error", code: "backend_failed" });
    expect(observed.some((event) => event.type === "error" && event.code === "resource_cleanup_unconfirmed")).toBe(false);
    expect(pool.records[0]!.settlements).toEqual([release]);
    expect(pool.active()).toBe(0);
    expect(service.hasPendingWork()).toBe(false);
    await expect(service.shutdown()).resolves.toBeUndefined();
  });

  it("retains failed durable settlement instead of freeing capacity or hanging shutdown", async () => {
    const pool = admissionPool(1);
    pool.failSettlement(new Error("Fixture resource ledger failed"));
    const { service } = await fixture({
      resourceAdmission: pool.admission,
      createBackend: ({ resourceLease }) => ({ run: async () => { resourceLease!.settle(release); return completed(); } }),
    });
    const created = await service.create(request());
    expect(await events(service, created.taskId)).toEqual([expect.objectContaining({ type: "error", code: "resource_cleanup_unconfirmed" })]);
    expect(pool.records[0]!.settlements).toEqual([release]);
    expect(pool.active()).toBe(1);
    expect(service.hasPendingWork()).toBe(true);
    await expect(service.shutdown()).rejects.toThrow("resources did not drain");
  });

  it("retains failed terminal persistence after physical release and reports unavailable task history", async () => {
    const pool = admissionPool(1);
    const save = BrowserTaskJournal.prototype.save;
    vi.spyOn(BrowserTaskJournal.prototype, "save").mockImplementation(async function (this: BrowserTaskJournal, record) {
      if (record.status === "terminal") throw new Error("Fixture terminal journal failed");
      return save.call(this, record);
    });
    const { service, root } = await fixture({
      resourceAdmission: pool.admission,
      createBackend: ({ resourceLease }) => ({ run: async () => { resourceLease!.settle(release); return completed(); } }),
    });
    const created = await service.create(request());
    const observed = await events(service, created.taskId);
    expect(observed.at(-1)).toMatchObject({ type: "error", code: "task_history_unavailable" });
    expect(observed.some((event) => event.type === "completed")).toBe(false);
    expect(pool.records[0]!.settlements).toEqual([release]);
    expect(pool.active()).toBe(0);
    expect(service.hasPendingWork()).toBe(true);
    expect(await new BrowserTaskJournal(root).load()).toMatchObject({ status: "running" });
    await expect(service.shutdown()).rejects.toThrow("resources did not drain");
  });

  it("publishes no terminal or new control while the final journal save is pending", async () => {
    const pool = admissionPool(1);
    const persisting = deferred<void>();
    const finishSave = deferred<void>();
    const save = BrowserTaskJournal.prototype.save;
    const persist = vi.spyOn(BrowserTaskJournal.prototype, "save").mockImplementation(async function (this: BrowserTaskJournal, record) {
      if (record.status === "terminal") { persisting.resolve(); await finishSave.promise; }
      return save.call(this, record);
    });
    const control = vi.fn(() => { throw new Error("Fixture settled backend must not be controlled"); });
    let backendSignal: AbortSignal | undefined;
    const { service } = await fixture({
      resourceAdmission: pool.admission,
      createBackend: ({ resourceLease }) => ({
        run: async (_request, _observe, signal) => {
          backendSignal = signal;
          resourceLease!.settle(release);
          return completed();
        },
        pause: control, resume: control, takeover: control,
      }),
    });
    const created = await service.create(request());
    await persisting.promise;
    const stream = service.events(created.taskId);
    const terminal = stream.next();
    let published = false;
    void terminal.then(() => { published = true; });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(published).toBe(false);
      expect(service.hasPendingWork()).toBe(true);
      expect(pool.active()).toBe(0);
      await expect(service.stop(created.taskId)).rejects.toMatchObject({ code: "browser_task_terminal" });
      for (const action of ["pause", "resume", "takeover"] as const) {
        await expect(service.control(created.taskId, action)).rejects.toMatchObject({ code: "browser_task_control_conflict" });
      }
      expect(control).not.toHaveBeenCalled();
      expect(backendSignal?.aborted).toBe(false);
      expect(persist).toHaveBeenCalledTimes(2);
    } finally {
      finishSave.resolve();
    }
    expect((await terminal).value).toMatchObject({ type: "completed", status: "completed" });
    expect((await stream.next()).done).toBe(true);
    expect(service.hasPendingWork()).toBe(false);
  });

  it("awaits task draining before local shutdown and attempts both even when they fail", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "napier-browser-shutdown-with-"));
    roots.push(root);
    const service = new BrowserTasks(root, undefined, {});
    services.push(service);
    const finishDrain = deferred<void>();
    const taskFailure = new Error("Fixture task cleanup failed");
    const localFailure = new Error("Fixture local runtime close failed");
    const order: string[] = [];
    vi.spyOn(service, "shutdown").mockImplementationOnce(async () => {
      order.push("task drain");
      await finishDrain.promise;
      throw taskFailure;
    });
    const localShutdown = vi.fn(async () => { order.push("local shutdown"); throw localFailure; });
    const stopping = service.shutdownWith(localShutdown);
    const outcome = stopping.then(() => undefined, (error: unknown) => error);
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(localShutdown).not.toHaveBeenCalled();
      expect(order).toEqual(["task drain"]);
    } finally {
      finishDrain.resolve();
    }
    const failure = await outcome;
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([taskFailure, localFailure]);
    expect(order).toEqual(["task drain", "local shutdown"]);
    expect(localShutdown).toHaveBeenCalledOnce();
  });

  it.each(["wrong scope", "invalid status"] as const)(
    "quarantines %s in the real admission ledger and rejects shutdown while preserving the real event store",
    async (kind) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "napier-browser-invalid-evidence-"));
      roots.push(root);
      const workspaceRoot = path.join(root, "workspace");
      await mkdir(workspaceRoot);
      const workspaceId = `workspace_${"c".repeat(64)}`;
      const admission = await WorkspaceResourceAdmission.open(path.join(root, "host"), { browser_task: 1 });
      const scoped = admission.forWorkspace(workspaceId);
      let rawLease: ExecutionResourceLease | undefined;
      const resourceAdmission = {
        ...scoped,
        reserve(value: Parameters<ExecutionResourceAdmission["reserve"]>[0]) {
          rawLease = scoped.reserve(value);
          return rawLease;
        },
      };
      const local = await createLocalAgentRuntime({
        workspaceRoot, dataRoot: path.join(root, "state"), resourceAdmission,
        sandbox: { id: "no-launch-fixture", async launch() { throw new Error("Unexpected fixture process launch"); } },
      });
      const thread = await local.store.createThread({ title: "Queryable after failed browser cleanup", agentId: local.store.listAgents()[0]!.id });
      const closeStore = vi.spyOn(local.store, "shutdown");
      const invalid = kind === "wrong scope"
        ? { ...release, scope: "browser_session" as const }
        : { ...release, status: "unexpected_status" as ExecutionResourceCleanup["status"] };
      const service = new BrowserTaskService({
        dataRoot: local.dataRoot, env: {}, resolveCredential: async () => "fixture-key", resourceAdmission,
        createBackend: ({ resourceLease }) => ({
          // No process/browser is created. Only production lifecycle composition
          // and both SQLite stores are exercised by this injected runner.
          run: async () => { resourceLease!.settle(invalid); return completed(); },
        }),
      });
      services.push(service);
      try {
        const created = await service.create(request());
        expect(await events(service, created.taskId)).toEqual([expect.objectContaining({ code: "resource_cleanup_unconfirmed" })]);
        expect(admission.snapshot().find((entry) => entry.kind === "browser_task")).toMatchObject({ occupied: 1, quarantined: 1 });
        expect(admission.hasPending(workspaceId)).toBe(true);
        expect(() => scoped.reserve({ kind: "browser_task", backend: "fixture_replacement" })).toThrow(expect.objectContaining({ code: "capacity" }));
        await expect(bounded(admission.drainWorkspace(workspaceId))).rejects.toMatchObject({ code: "cleanup" });
        const localShutdown = vi.fn(() => local.shutdown());
        const stopping = BrowserTasks.prototype.shutdownWith.call(service, localShutdown);
        await expect(bounded(stopping)).rejects.toBeInstanceOf(AggregateError);
        expect(localShutdown).toHaveBeenCalledOnce();
        expect(closeStore).not.toHaveBeenCalled();
        // listEvents uses SQLite rather than an already-cached Agent list.
        await expect(local.store.listEvents(thread.id)).resolves.toEqual([]);
        expect(service.hasPendingWork()).toBe(true);
        expect(admission.snapshot().find((entry) => entry.kind === "browser_task")).toMatchObject({ occupied: 1, quarantined: 1 });
      } finally {
        // The fixture never created a process/browser. Affirm no-start only
        // after assertions, so the owned coordinator can close without a leak.
        rawLease?.settle(noStart);
        await local.shutdown().catch(() => undefined);
        await local.store.shutdown();
        admission.close();
      }
    },
  );

  it.each([
    { ...release, status: "unexpected_status" as ExecutionResourceCleanup["status"] },
    { ...release, reason: "invalid diagnostic with spaces" },
  ])("sends only scoped unknown evidence to a permissive sink after invalid evidence %j", async (invalid) => {
    const pool = admissionPool(1);
    const { service } = await fixture({
      resourceAdmission: pool.admission,
      createBackend: ({ resourceLease }) => ({ run: async () => { resourceLease!.settle(invalid); return completed(); } }),
    });
    const created = await service.create(request());
    expect(await events(service, created.taskId)).toEqual([expect.objectContaining({ code: "resource_cleanup_unconfirmed" })]);
    expect(pool.records[0]!.settlements).toEqual([
      { status: "unknown", scope: "browser_task", reason: "browser_task_cleanup_evidence_invalid" },
    ]);
    expect(pool.active()).toBe(1);
    await expect(service.shutdown()).rejects.toThrow("resources did not drain");
  });

  it("preserves both invalid-evidence and fallback accounting failures", () => {
    const pool = admissionPool(1);
    const accounting = new Error("Fixture quarantine write failed");
    pool.failSettlement(accounting);
    const resource = new BrowserTaskResource(pool.admission, "browser_use_local");
    resource.enterBackend();
    let failure: unknown;
    try { resource.lease.settle({ ...release, scope: "browser_session" }); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([expect.objectContaining({ message: expect.stringContaining("invalid") }), accounting]);
    expect(pool.records[0]!.settlements).toEqual([
      { status: "unknown", scope: "browser_task", reason: "browser_task_cleanup_evidence_invalid" },
    ]);
    expect(resource.released).toBe(false);
    expect(() => resource.finish()).toThrow(failure as Error);
    expect(pool.active()).toBe(1);
  });
});

async function fixture(options: Omit<ConstructorParameters<typeof BrowserTaskService>[0], "dataRoot" | "env">) {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-browser-task-resource-"));
  roots.push(root);
  const service = new BrowserTaskService({
    dataRoot: root, env: {}, resolveCredential: async () => "fixture-key", ...options,
  });
  services.push(service);
  return { service, root };
}

function request(): BrowserTaskCreateInput {
  return {
    backend: "browser_use_local", task: "Inspect fixture release notes", startUrl: "https://example.com",
    model: { provider: "openai", id: "fixture-unused" }, credentialEnv: "", allowedDomains: ["example.com"],
    maxSteps: 1, maxCostUsd: 1,
  };
}

function completed(): BrowserUseLocalTaskResult {
  return {
    type: "completed", backend: "browser_use_local", status: "completed", result: "Fixture result",
    stepCount: 1, costStatus: "unknown", artifactDirectory: "/fixture/not-a-browser-artifact",
  };
}

async function events(service: BrowserTaskService, taskId: string) {
  const observed: BrowserTaskEvent[] = [];
  for await (const event of service.events(taskId)) observed.push(event);
  return observed;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Fixture resource drain did not settle within one second")), 1_000);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

function admissionPool(capacity: number) {
  const records: Array<{
    request: Parameters<ExecutionResourceAdmission["reserve"]>[0];
    lease: { id: string; dispatched: ReturnType<typeof vi.fn<ExecutionResourceLease["dispatched"]>>; bind: ReturnType<typeof vi.fn<ExecutionResourceLease["bind"]>>; settle: ReturnType<typeof vi.fn<ExecutionResourceLease["settle"]>> };
    settlements: ExecutionResourceCleanup[];
    released: boolean;
  }> = [];
  let failure: Error | undefined;
  const active = () => records.filter((record) => !record.released).length;
  const admission: ExecutionResourceAdmission = {
    reserve(request) {
      if (active() >= capacity) throw new Error("shared task capacity exhausted");
      const settlements: ExecutionResourceCleanup[] = [];
      const record = {
        request, settlements, released: false,
        lease: {
          id: `fixture_lease_${records.length + 1}`,
          dispatched: vi.fn<ExecutionResourceLease["dispatched"]>(), bind: vi.fn<ExecutionResourceLease["bind"]>(),
          settle: vi.fn<ExecutionResourceLease["settle"]>((evidence) => {
            settlements.push(structuredClone(evidence));
            if (failure) throw failure;
            record.released = evidence.status !== "unknown";
          }),
        },
      };
      records.push(record);
      return record.lease;
    },
  };
  return { admission, records, active, failSettlement: (error: Error) => { failure = error; } };
}
