import { access, rm } from "node:fs/promises";
import type { Browser, LaunchOptions } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ExecutionResourceAdmission,
  ExecutionResourceCleanup,
  ExecutionResourceIdentity,
} from "../src/execution-resource-admission.js";
import { RunBrowserSessionManager } from "../src/browser-session.js";
import type {
  BrowserRuntimeBinding,
  RunBrowserSessionManagerOptions,
} from "../src/browser-session-model.js";
import { FakeBrowser, FakePage, FakeProxy } from "./browser-session-harness.js";

const roots = new Set<string>();
const managers = new Set<RunBrowserSessionManager>();
const owner = { threadId: "thread_admission", runId: "run_admission" };
const start = { action: "start", url: "https://one.example/" } as const;
const runtime = { executablePath: "/fake/chrome", executableSha256: "a".repeat(64) };

afterEach(async () => {
  await Promise.allSettled([...managers].map((manager) => manager.shutdown()));
  managers.clear();
  vi.restoreAllMocks();
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
  roots.clear();
});

describe("shared Browser Session resource admission", () => {
  it.each(["runtime preparation", "browser launch"] as const)(
    "retains one shared permit through delayed %s, reuse and awaited cleanup",
    async (stage) => {
      const pool = admissionPool(1);
      const first = fixture(pool.admission);
      const second = fixture(pool.admission);
      const runtimeReady = deferred<BrowserRuntimeBinding>();
      const browserReady = deferred<Browser>();
      first.createProxy.mockImplementationOnce(() => {
        expect(pool.records[0]!.dispatched).toBe(true);
        return first.proxy;
      });
      if (stage === "runtime preparation") first.resolveRuntime.mockImplementationOnce(() => runtimeReady.promise);
      else first.launch.mockImplementationOnce(() => browserReady.promise);
      const starting = first.manager.execute(owner, start);
      try {
        await vi.waitFor(() => expect(stage === "runtime preparation" ? first.resolveRuntime : first.launch).toHaveBeenCalledOnce());
        expect(pool.active()).toBe(1);
        expect(pool.records[0]!.request).toEqual({ kind: "browser_session", backend: "playwright_chromium" });
        expect(pool.records[0]!.dispatched).toBe(stage === "browser launch");
        await expect(second.manager.execute(owner, start)).rejects.toThrow("shared browser capacity exhausted");
        expect(second.resolveRuntime).not.toHaveBeenCalled();
        expect(second.createProxy).not.toHaveBeenCalled();
        expect(second.launch).not.toHaveBeenCalled();
      } finally {
        runtimeReady.resolve(runtime);
        browserReady.resolve(first.browser as unknown as Browser);
      }
      await starting;
      expect(pool.records[0]!.identities).toHaveLength(1);
      expect(pool.records[0]!.identities[0]!.resourceId).toEqual(expect.any(String));
      const identity = structuredClone(pool.records[0]!.identities[0]);
      await first.manager.execute(owner, { ...start, url: "https://one.example/second" });
      await first.manager.execute(owner, { action: "snapshot" });
      expect(pool.records).toHaveLength(1);
      expect(pool.records[0]!.identities).toEqual([identity]);
      expect(first.launch).toHaveBeenCalledOnce();

      const closeReady = deferred<void>();
      const close = vi.spyOn(first.browser, "close").mockImplementationOnce(() => closeReady.promise);
      const closing = first.manager.cancelRun(owner);
      try {
        await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
        expect(pool.active()).toBe(1);
        expect(pool.records[0]!.settlements).toEqual([]);
        await expect(second.manager.execute(owner, start)).rejects.toThrow("shared browser capacity exhausted");
        expect(second.resolveRuntime).not.toHaveBeenCalled();
      } finally {
        closeReady.resolve();
      }
      await closing;
      expect(pool.active()).toBe(0);
      expect(first.proxy.closed).toBe(true);
      await expect(access(first.runtimeRoot())).rejects.toMatchObject({ code: "ENOENT" });
      expect(pool.records[0]!.settlements).toEqual([
        expect.objectContaining({ status: "released", scope: "browser_session" }),
      ]);
      await second.manager.execute(owner, start);
      expect(pool.active()).toBe(1);
      expect(second.launch).toHaveBeenCalledOnce();
      await second.manager.shutdown();
      expect(pool.active()).toBe(0);
    },
  );

  it("releases affirmed pre-dispatch failure without creating a proxy or launching a browser", async () => {
    const pool = admissionPool(1);
    const first = fixture(pool.admission);
    const second = fixture(pool.admission);
    const failure = new Error("fixture browser runtime unavailable");
    first.resolveRuntime.mockRejectedValueOnce(failure);
    await expect(first.manager.execute(owner, start)).rejects.toBe(failure);
    expect(first.createProxy).not.toHaveBeenCalled();
    expect(first.launch).not.toHaveBeenCalled();
    expect(pool.records[0]!.dispatched).toBe(false);
    expect(pool.records[0]!.settlements).toEqual([
      expect.objectContaining({ status: "not_started", scope: "browser_session" }),
    ]);
    expect(pool.active()).toBe(0);
    await second.manager.execute(owner, start);
    expect(pool.active()).toBe(1);
  });

  it("holds admission during URL preflight and settles no-start when that preparation is cancelled", async () => {
    const pool = admissionPool(1);
    const first = fixture(pool.admission);
    const second = fixture(pool.admission);
    const lookupReady = deferred<Array<{ address: string; family: 4 }>>();
    first.lookup.mockImplementationOnce(() => lookupReady.promise);
    const controller = new AbortController();
    const reason = new Error("fixture cancelled URL preparation");
    const starting = first.manager.execute(owner, start, controller.signal);
    const rejected = expect(starting).rejects.toBe(reason);
    try {
      await vi.waitFor(() => expect(first.lookup).toHaveBeenCalledOnce());
      expect(pool.active()).toBe(1);
      expect(pool.records[0]!.dispatched).toBe(false);
      expect(first.resolveRuntime).not.toHaveBeenCalled();
      await expect(second.manager.execute(owner, start)).rejects.toThrow("shared browser capacity exhausted");
      expect(second.lookup).not.toHaveBeenCalled();
      controller.abort(reason);
    } finally {
      lookupReady.resolve([{ address: "1.1.1.1", family: 4 }]);
    }
    await rejected;
    expect(first.resolveRuntime).not.toHaveBeenCalled();
    expect(first.createProxy).not.toHaveBeenCalled();
    expect(first.launch).not.toHaveBeenCalled();
    expect(pool.records[0]!.settlements).toEqual([
      expect.objectContaining({ status: "not_started", scope: "browser_session" }),
    ]);
    expect(pool.active()).toBe(0);
    await second.manager.execute(owner, start);
    expect(pool.active()).toBe(1);
  });

  it("quarantines an invoked launch that rejects without a browser handle", async () => {
    const pool = admissionPool(1);
    const first = fixture(pool.admission);
    const second = fixture(pool.admission);
    first.launch.mockRejectedValueOnce(new Error("fixture launch response was lost"));
    await expect(first.manager.execute(owner, start)).rejects.toBeDefined();
    expect(pool.records[0]!.dispatched).toBe(true);
    expect(pool.records[0]!.settlements).toEqual([
      expect.objectContaining({ status: "unknown", scope: "browser_session" }),
    ]);
    expect(pool.active()).toBe(1);
    await expect(access(first.runtimeRoot())).resolves.toBeUndefined();
    await expect(second.manager.execute(owner, start)).rejects.toThrow("shared browser capacity exhausted");
    expect(second.resolveRuntime).not.toHaveBeenCalled();
    await expect(first.manager.shutdown()).rejects.toBeDefined();
  });

  it("retains a session's shared capacity when owned browser cleanup fails", async () => {
    const pool = admissionPool(1);
    const first = fixture(pool.admission);
    const second = fixture(pool.admission);
    await first.manager.execute(owner, start);
    const close = vi.spyOn(first.browser, "close").mockRejectedValue(new Error("fixture browser close failed"));
    await expect(first.manager.cancelRun(owner)).rejects.toBeDefined();
    expect(first.proxy.closed).toBe(true);
    expect(pool.records[0]!.settlements).toEqual([
      expect.objectContaining({ status: "unknown", scope: "browser_session" }),
    ]);
    expect(pool.active()).toBe(1);
    await expect(access(first.runtimeRoot())).resolves.toBeUndefined();
    await expect(second.manager.execute(owner, start)).rejects.toThrow("shared browser capacity exhausted");
    await expect(first.manager.execute(owner, start)).rejects.toBeDefined();
    await expect(first.manager.shutdown()).rejects.toBeDefined();
    expect(first.launch).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(second.resolveRuntime).not.toHaveBeenCalled();
  });

  it("does not replace a physically closed session whose durable release failed", async () => {
    const pool = admissionPool(1);
    const first = fixture(pool.admission);
    const second = fixture(pool.admission);
    await first.manager.execute(owner, start);
    pool.failSettlement(new Error("fixture admission ledger failed"));
    const close = vi.spyOn(first.browser, "close");
    await expect(first.manager.cancelRun(owner)).rejects.toBeDefined();
    expect(first.browser.closed).toBe(true);
    expect(first.proxy.closed).toBe(true);
    await expect(access(first.runtimeRoot())).rejects.toMatchObject({ code: "ENOENT" });
    expect(pool.records[0]!.settlements[0]).toEqual(
      expect.objectContaining({ status: "released", scope: "browser_session" }),
    );
    expect(pool.active()).toBe(1);
    await expect(second.manager.execute(owner, start)).rejects.toThrow("shared browser capacity exhausted");
    await expect(first.manager.execute(owner, start)).rejects.toBeDefined();
    await expect(first.manager.shutdown()).rejects.toBeDefined();
    expect(first.launch).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(second.resolveRuntime).not.toHaveBeenCalled();
  });
});

function fixture(resourceAdmission: ExecutionResourceAdmission) {
  const proxy = new FakeProxy();
  const browser = new FakeBrowser(() => new FakePage(new Map(), "download", "body", undefined, false, undefined));
  const resolveRuntime = vi.fn(async (): Promise<BrowserRuntimeBinding> => runtime);
  const lookup = vi.fn(async () => [{ address: "1.1.1.1", family: 4 as const }]);
  const createProxy = vi.fn(() => proxy);
  const launch = vi.fn(async (_options: LaunchOptions) => browser as unknown as Browser);
  let runtimeRoot: string | undefined;
  const options: RunBrowserSessionManagerOptions = {
    workspaceRoot: "/tmp",
    resourceAdmission,
    lookup,
    resolveRuntime,
    createProxy,
    launchBrowser: (value) => {
      roots.add(value.artifactsDir!);
      runtimeRoot = value.artifactsDir!;
      return launch(value);
    },
  };
  const manager = new RunBrowserSessionManager(options);
  managers.add(manager);
  return { manager, browser, proxy, resolveRuntime, lookup, createProxy, launch, runtimeRoot: () => runtimeRoot! };
}

function admissionPool(capacity: number) {
  type Request = Parameters<ExecutionResourceAdmission["reserve"]>[0];
  const records: Array<{
    request: Request;
    dispatched: boolean;
    identities: ExecutionResourceIdentity[];
    settlements: ExecutionResourceCleanup[];
    released: boolean;
  }> = [];
  let settlementFailure: Error | undefined;
  const active = () => records.filter((record) => !record.released).length;
  const admission: ExecutionResourceAdmission = {
    reserve(request) {
      if (active() >= capacity) throw new Error("shared browser capacity exhausted");
      const record = { request, dispatched: false, identities: [] as ExecutionResourceIdentity[], settlements: [] as ExecutionResourceCleanup[], released: false };
      records.push(record);
      return {
        id: `fixture_lease_${records.length}`,
        dispatched: () => { record.dispatched = true; },
        bind: (identity) => { record.identities.push(structuredClone(identity)); },
        settle: (evidence) => {
          record.settlements.push(structuredClone(evidence));
          if (settlementFailure) throw settlementFailure;
          record.released = evidence.status !== "unknown";
        },
      };
    },
  };
  return { admission, records, active, failSettlement: (error: Error) => { settlementFailure = error; } };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
