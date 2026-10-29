import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserUseLocalBackend } from "../src/browser-use-local-backend.js";
import { inspectBrowserUseLocalRuntime } from "../src/browser-use-local-setup.js";
import type { ExecutionResourceLease } from "../src/execution-resource-admission.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs/promises", async (original) => ({
  ...await original<typeof import("node:fs/promises")>(), mkdir: vi.fn(),
}));
vi.mock("../src/browser-use-local-setup.js", async (original) => ({
  ...await original<typeof import("../src/browser-use-local-setup.js")>(),
  inspectBrowserUseLocalRuntime: vi.fn(),
}));

const request = {
  task: "Inspect fixture release notes", startUrl: "https://example.com",
  model: { provider: "openai", id: "fixture-unused" }, allowedDomains: ["example.com"], maxSteps: 1,
};
const completed = {
  type: "completed", backend: "browser_use_local", status: "completed", result: "Fixture result",
  stepCount: 1, costStatus: "unknown",
};
const step = { type: "step", backend: "browser_use_local", step: 1, url: "https://example.com", title: "Fixture", actionNames: [] };

beforeEach(() => {
  vi.mocked(spawn).mockReset();
  vi.mocked(mkdir).mockReset().mockResolvedValue(undefined);
  vi.mocked(inspectBrowserUseLocalRuntime).mockReset().mockResolvedValue({
    backend: "browser_use_local", packageName: "browser-use", packageVersion: "0.13.7",
    pythonVersion: "3.12", platform: "darwin", arch: "arm64", status: "ready",
    pythonExecutable: "/fixture/python", browserExecutablePath: "/fixture/chrome",
    browserProduct: "system_chrome", browserVersion: "150.0.0.0",
  });
});

describe("Browser Use local resource cleanup evidence", () => {
  it("requires both the nonce-bound cleanup ACK and child close after a business terminal", async () => {
    const fixture = bridge();
    const observe = vi.fn();
    const running = fixture.backend.run(request, observe);
    let settled = false;
    void running.then(() => { settled = true; });
    await fixture.started;
    expect(fixture.lease.dispatched).toHaveBeenCalledOnce();
    expect(fixture.lease.bind).toHaveBeenCalledExactlyOnceWith({ resourceId: fixture.nonce() });
    expect(fixture.nonce()).toMatch(/^[a-f0-9]{32}$/u);
    fixture.emit(completed);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(fixture.lease.settle).not.toHaveBeenCalled();
    fixture.emit(fixture.ack());
    await Promise.resolve();
    expect(fixture.lease.settle).not.toHaveBeenCalled();
    fixture.close();
    await expect(running).resolves.toMatchObject(completed);
    expect(fixture.lease.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "released", scope: "browser_task" }));
    expect(observe).not.toHaveBeenCalled();
    await expect(fixture.backend.run(request, observe)).rejects.toMatchObject({ code: "browser_task_busy" });
    expect(spawn).toHaveBeenCalledOnce();
    expect(fixture.lease.settle).toHaveBeenCalledOnce();
  });

  it("keeps a completed business result separate from missing cleanup evidence", async () => {
    const fixture = bridge();
    const running = fixture.backend.run(request, () => undefined);
    await fixture.started;
    fixture.emit(completed);
    fixture.close();
    await expect(running).resolves.toMatchObject(completed);
    expect(fixture.lease.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "unknown" }));
  });

  it("quarantines an explicit failed cleanup and preserves the bridge error", async () => {
    const fixture = bridge();
    const running = fixture.backend.run(request, () => undefined);
    const failed = expect(running).rejects.toMatchObject({ code: "backend_failed", message: "Fixture cleanup failed" });
    await fixture.started;
    fixture.emit(completed, fixture.ack({ status: "unknown" }), {
      type: "error", backend: "browser_use_local", code: "backend_failed", message: "Fixture cleanup failed",
      diagnosticSha256: "a".repeat(64), recovery: "Inspect fixture",
    });
    fixture.close(1);
    await failed;
    expect(fixture.lease.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "unknown" }));
  });

  it.each([
    { runNonce: "stale_run" }, { schemaVersion: 2 }, { backend: "wrong_backend" },
    { status: "completed" }, { unexpected: true },
  ])("rejects malformed cleanup evidence %j and cannot release through a later valid ACK", async (override) => {
    const fixture = bridge();
    const running = fixture.backend.run(request, () => undefined);
    const failed = expect(running).rejects.toMatchObject({ code: "backend_protocol_invalid" });
    await fixture.started;
    fixture.emit(completed, fixture.ack(override));
    await vi.waitFor(() => expect(fixture.kill).toHaveBeenCalledWith(-731, "SIGTERM"));
    expect(fixture.lease.settle).not.toHaveBeenCalled();
    fixture.emit(fixture.ack());
    fixture.close();
    await failed;
    expect(fixture.lease.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "unknown" }));
  });

  it("retains cleanup capacity when cancellation closes the bridge without its ACK", async () => {
    const fixture = bridge();
    const controller = new AbortController();
    const running = fixture.backend.run(request, () => undefined, controller.signal);
    const failed = expect(running).rejects.toMatchObject({ code: "cancelled" });
    await fixture.started;
    fixture.emit(completed);
    controller.abort();
    expect(fixture.lease.settle).not.toHaveBeenCalled();
    fixture.close(null, "SIGTERM");
    await failed;
    expect(fixture.lease.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "unknown" }));
  });

  it("still accepts cleanup proof after an observation persistence failure", async () => {
    const fixture = bridge();
    const failure = new Error("Fixture observation persistence failed");
    const observe = vi.fn(async () => { throw failure; });
    const running = fixture.backend.run(request, observe);
    const failed = expect(running).rejects.toBe(failure);
    await fixture.started;
    fixture.emit(step);
    await vi.waitFor(() => expect(fixture.kill).toHaveBeenCalledWith(-731, "SIGTERM"));
    fixture.emit(step, fixture.ack());
    fixture.close();
    await failed;
    expect(observe).toHaveBeenCalledOnce();
    expect(fixture.lease.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "released" }));
  });

  it.each(["invalid request", "inspection failure", "pre-aborted"] as const)("settles %s as not-started without dispatch", async (kind) => {
    const fixture = bridge();
    if (kind === "inspection failure") vi.mocked(inspectBrowserUseLocalRuntime).mockRejectedValueOnce(new Error("Fixture unavailable"));
    await expect(fixture.backend.run(
      kind === "invalid request" ? { ...request, allowedDomains: ["localhost"] } : request,
      () => undefined,
      kind === "pre-aborted" ? AbortSignal.abort() : undefined,
    )).rejects.toBeDefined();
    expect(spawn).not.toHaveBeenCalled();
    expect(fixture.lease.dispatched).not.toHaveBeenCalled();
    expect(fixture.lease.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "not_started" }));
  });

  it("treats an arbitrary spawn throw as unknown but a child with no PID as not-started", async () => {
    const uncertain = bridge();
    vi.mocked(spawn).mockReset().mockImplementationOnce(() => { throw new Error("Fixture spawn outcome unknown"); });
    await expect(uncertain.backend.run(request, () => undefined)).rejects.toThrow("spawn outcome unknown");
    expect(uncertain.lease.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "unknown" }));

    const noStart = bridge();
    vi.mocked(spawn).mockReset().mockReturnValueOnce(Object.assign(new EventEmitter(), { pid: undefined }) as ChildProcessWithoutNullStreams);
    await expect(noStart.backend.run(request, () => undefined)).rejects.toThrow("did not expose an identity");
    expect(noStart.lease.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "not_started" }));
  });

  it("does not spawn if durable dispatch fails, and does not report success if durable settlement fails", async () => {
    const noDispatch = bridge();
    noDispatch.lease.dispatched.mockImplementationOnce(() => { throw new Error("Fixture dispatch persistence failed"); });
    await expect(noDispatch.backend.run(request, () => undefined)).rejects.toThrow("dispatch persistence failed");
    expect(spawn).not.toHaveBeenCalled();
    expect(noDispatch.lease.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "not_started" }));
    vi.mocked(spawn).mockReset();

    const failedRelease = bridge();
    failedRelease.lease.settle.mockImplementationOnce(() => { throw new Error("Fixture settlement persistence failed"); });
    const running = failedRelease.backend.run(request, () => undefined);
    const failed = expect(running).rejects.toThrow("resource evidence could not be saved");
    await failedRelease.started;
    failedRelease.emit(completed, failedRelease.ack());
    failedRelease.close();
    await failed;
    expect(failedRelease.lease.settle).toHaveBeenCalledOnce();
  });
});

function bridge() {
  const lease = {
    id: "fixture_browser_task", dispatched: vi.fn<ExecutionResourceLease["dispatched"]>(),
    bind: vi.fn<ExecutionResourceLease["bind"]>(), settle: vi.fn<ExecutionResourceLease["settle"]>(),
  };
  const child = Object.assign(new EventEmitter(), {
    pid: 731, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
  }) as unknown as ChildProcessWithoutNullStreams;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  let sent: { runNonce: string };
  vi.spyOn(child.stdin, "end").mockImplementation((...args: unknown[]) => {
    sent = JSON.parse(String(args[0])) as { runNonce: string };
    ready();
    return child.stdin;
  });
  vi.mocked(spawn).mockImplementationOnce(() => {
    expect(lease.dispatched).toHaveBeenCalledOnce();
    expect(lease.bind).toHaveBeenCalledOnce();
    return child;
  });
  const kill = vi.fn<(pid: number, signal: NodeJS.Signals) => void>();
  const backend = new BrowserUseLocalBackend({
    dataRoot: "/tmp/napier-browser-resource-fixture", env: { NAPIER_BROWSER_USE_CREDENTIAL: "fixture-unused" },
    resourceLease: lease, control: { platform: "darwin", kill, schedule: () => undefined },
  });
  return {
    backend, lease, kill, started, nonce: () => sent.runNonce,
    ack: (override: Record<string, unknown> = {}) => ({
      type: "cleanup", backend: "browser_use_local", schemaVersion: 1,
      runNonce: sent.runNonce, status: "released", ...override,
    }),
    emit: (...events: unknown[]) => child.stdout.emit("data", Buffer.from(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`)),
    close: (code: number | null = 0, signal: NodeJS.Signals | null = null) => child.emit("close", code, signal),
  };
}
