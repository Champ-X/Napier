import { access, rm } from "node:fs/promises";
import type { Browser, LaunchOptions } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PersistentBrowserSession } from "../src/browser-page-session.js";
import { abortBrowserSessionOperation, BrowserSessionCleanupError } from "../src/browser-session-cleanup.js";
import { RunBrowserSessionManager } from "../src/browser-session.js";
import type { RunBrowserSessionManagerOptions } from "../src/browser-session-model.js";
import { FakeBrowser, FakePage, FakeProxy } from "./browser-session-harness.js";

const roots = new Set<string>();
const owner = { threadId: "thread_lifetime", runId: "run_lifetime" };
const startRequest = { action: "start", url: "https://one.example/" } as const;

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
  roots.clear();
});

describe("owned Browser Session lifetime", () => {
  it("shares a close promise and waits for context, browser and proxy cleanup before removing private files", async () => {
    const fixture = createFixture();
    const session = await PersistentBrowserSession.start(fixture.options, owner);
    const gate = deferred<void>();
    const contextClose = vi.spyOn(fixture.browser.context, "close").mockImplementation(() => gate.promise);
    const browserClose = vi.spyOn(fixture.browser, "close");
    const proxyClose = vi.spyOn(fixture.proxy, "close");
    const closing = session.close();
    expect(session.close()).toBe(closing);
    expect(session.healthy).toBe(false);
    let finished = false;
    void closing.then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(browserClose).not.toHaveBeenCalled();
    await expect(access(fixture.runtimeRoot())).resolves.toBeUndefined();

    gate.resolve();
    await closing;
    expect(contextClose).toHaveBeenCalledOnce();
    expect(browserClose).toHaveBeenCalledOnce();
    expect(proxyClose).toHaveBeenCalledOnce();
    expect(session.close()).toBe(closing);
    await expect(access(fixture.runtimeRoot())).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retains every cleanup failure and the private directory instead of reporting a closed session", async () => {
    const fixture = createFixture();
    const session = await PersistentBrowserSession.start(fixture.options, owner);
    const contextError = new Error("context close failed");
    const browserError = new Error("browser close failed");
    const proxyError = new Error("proxy close failed");
    const contextClose = vi.spyOn(fixture.browser.context, "close").mockRejectedValue(contextError);
    const browserClose = vi.spyOn(fixture.browser, "close").mockRejectedValue(browserError);
    const proxyClose = vi.spyOn(fixture.proxy, "close").mockRejectedValue(proxyError);
    const closing = session.close();
    const failure = await rejection(closing);
    expect(failure).toBeInstanceOf(BrowserSessionCleanupError);
    expect((failure as AggregateError).errors).toEqual([contextError, browserError, proxyError]);
    expect(session.close()).toBe(closing);
    expect(await rejection(session.close())).toBe(failure);
    expect(session.healthy).toBe(false);
    expect([contextClose, browserClose, proxyClose].map((mock) => mock.mock.calls.length)).toEqual([1, 1, 1]);
    await expect(access(fixture.runtimeRoot())).resolves.toBeUndefined();
  });

  it("preserves the startup error when closing a partially prepared session also fails", async () => {
    const fixture = createFixture();
    const startupError = new Error("new page failed");
    const cleanupError = new Error("browser remains uncertain");
    vi.spyOn(fixture.browser.context, "newPage").mockRejectedValue(startupError);
    const browserClose = vi.spyOn(fixture.browser, "close").mockRejectedValue(cleanupError);
    const proxyClose = vi.spyOn(fixture.proxy, "close");
    const failure = await rejection(PersistentBrowserSession.start(fixture.options, owner));
    expect(failure).toBeInstanceOf(BrowserSessionCleanupError);
    expect(failure).toMatchObject({ cause: startupError, errors: [cleanupError] });
    expect(browserClose).toHaveBeenCalledOnce();
    expect(proxyClose).toHaveBeenCalledOnce();
    await expect(access(fixture.runtimeRoot())).resolves.toBeUndefined();
  });

  it("drains an admitted launch during shutdown, closes the late browser and rejects queued or new operations", async () => {
    const fixture = createFixture();
    const launched = deferred<Browser>();
    fixture.launch.mockImplementation(() => launched.promise);
    const manager = new RunBrowserSessionManager(fixture.options);
    const started = rejection(manager.execute(owner, startRequest));
    await vi.waitFor(() => expect(fixture.launch).toHaveBeenCalledOnce());
    const queued = rejection(manager.execute(owner, { action: "snapshot" }));
    const closeGate = deferred<void>();
    const browserClose = vi.spyOn(fixture.browser, "close").mockImplementation(() => closeGate.promise);
    const newContext = vi.spyOn(fixture.browser, "newContext");
    const stopping = manager.shutdown();
    expect(manager.shutdown()).toBe(stopping);
    let stopped = false;
    void stopping.then(() => { stopped = true; });
    await expect(manager.execute({ ...owner, runId: "new_run" }, startRequest)).rejects.toThrow("shutting down");
    launched.resolve(fixture.browser as unknown as Browser);
    await vi.waitFor(() => expect(browserClose).toHaveBeenCalledOnce());
    expect(stopped).toBe(false);
    expect(newContext).not.toHaveBeenCalled();
    closeGate.resolve();
    await stopping;
    expect(await started).toMatchObject({ message: expect.stringContaining("shutting down") });
    expect(await queued).toMatchObject({ message: expect.stringContaining("shutting down") });
    expect(manager.hasActiveSession(owner)).toBe(false);
    expect(fixture.proxy.closed).toBe(true);
    await expect(access(fixture.runtimeRoot())).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not dispatch a browser after shutdown interrupts runtime preparation", async () => {
    const fixture = createFixture();
    const runtime = deferred<{ executablePath: string; executableSha256: string }>();
    const resolveRuntime = vi.fn(() => runtime.promise);
    const manager = new RunBrowserSessionManager({ ...fixture.options, resolveRuntime });
    const started = rejection(manager.execute(owner, startRequest));
    await vi.waitFor(() => expect(resolveRuntime).toHaveBeenCalledOnce());
    const stopping = manager.shutdown();
    runtime.resolve({ executablePath: "/fake/chrome", executableSha256: "a".repeat(64) });
    await stopping;
    expect(await started).toMatchObject({ message: expect.stringContaining("shutting down") });
    expect(fixture.launch).not.toHaveBeenCalled();
  });

  it("waits for an admitted operation even after browser cleanup completes", async () => {
    const fixture = createFixture();
    const manager = new RunBrowserSessionManager(fixture.options);
    const initial = await manager.execute(owner, startRequest);
    const operation = deferred<typeof initial>();
    const execute = vi.spyOn(PersistentBrowserSession.prototype, "execute").mockImplementationOnce(() => operation.promise);
    const pending = manager.execute(owner, { action: "snapshot" });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    const stopping = manager.shutdown();
    let stopped = false;
    void stopping.then(() => { stopped = true; });
    await vi.waitFor(() => expect(fixture.proxy.closed).toBe(true));
    expect(stopped).toBe(false);
    operation.resolve(initial);
    await pending;
    await stopping;
    expect(stopped).toBe(true);
  });

  it("retains failed cancellation cleanup for later operations and shutdown", async () => {
    const fixture = createFixture();
    const manager = new RunBrowserSessionManager(fixture.options);
    await manager.execute(owner, startRequest);
    const cleanupError = new Error("owned browser close failed");
    const browserClose = vi.spyOn(fixture.browser, "close").mockRejectedValue(cleanupError);
    const cancelled = await rejection(manager.cancelRun(owner));
    expect((cancelled as AggregateError).errors[0]).toMatchObject({ errors: [cleanupError] });
    expect(manager.hasActiveSession(owner)).toBe(false);
    await expect(manager.execute(owner, startRequest)).rejects.toBeInstanceOf(BrowserSessionCleanupError);
    expect(fixture.launch).toHaveBeenCalledOnce();
    const stopping = manager.shutdown();
    const stopped = await rejection(stopping);
    expect((stopped as AggregateError).errors[0]).toMatchObject({ errors: [cleanupError] });
    expect(manager.shutdown()).toBe(stopping);
    expect(browserClose).toHaveBeenCalledOnce();
  });

  it("keeps uncertain startup cleanup in the local bound and rejects shutdown", async () => {
    const fixture = createFixture();
    const manager = new RunBrowserSessionManager(fixture.options);
    vi.spyOn(fixture.browser.context, "newPage").mockRejectedValue(new Error("new page failed"));
    const cleanupError = new Error("browser close failed");
    vi.spyOn(fixture.browser, "close").mockRejectedValue(cleanupError);
    for (let index = 0; index < 2; index += 1) {
      await expect(manager.execute(owner, startRequest)).rejects.toBeInstanceOf(BrowserSessionCleanupError);
    }
    await expect(manager.execute(owner, startRequest)).rejects.toThrow("active Session limit");
    expect(fixture.launch).toHaveBeenCalledTimes(2);
    const failure = await rejection(manager.shutdown());
    expect((failure as AggregateError).errors).toHaveLength(2);
  });

  it("propagates abort cleanup failure without an unhandled rejection", async () => {
    const operation = deferred<void>();
    const abort = new AbortController();
    const cleanupError = new Error("abort close failed");
    const result = abortBrowserSessionOperation(operation.promise, abort.signal, async () => { throw cleanupError; });
    const failed = rejection(result);
    abort.abort();
    expect(await failed).toBe(cleanupError);
    operation.reject(new Error("page operation stopped"));
    await Promise.resolve();
  });
});

function createFixture() {
  const proxy = new FakeProxy();
  const browser = new FakeBrowser(() => new FakePage(new Map(), "download", "body", undefined, false, undefined));
  const launches: LaunchOptions[] = [];
  const launch = vi.fn(async (_options: LaunchOptions) => browser as unknown as Browser);
  const options: RunBrowserSessionManagerOptions = {
    workspaceRoot: "/tmp",
    lookup: async () => [{ address: "1.1.1.1", family: 4 as const }],
    resolveRuntime: async () => ({ executablePath: "/fake/chrome", executableSha256: "a".repeat(64) }),
    createProxy: () => proxy,
    launchBrowser: (value) => {
      launches.push(value);
      roots.add(value.artifactsDir!);
      return launch(value);
    },
  };
  return { proxy, browser, launch, options, runtimeRoot: () => launches.at(-1)!.artifactsDir! };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function rejection(operation: Promise<unknown>): Promise<unknown> {
  return operation.then(() => { throw new Error("Expected operation to reject"); }, (error: unknown) => error);
}
