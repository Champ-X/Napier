import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserUseLocalBackend } from "../src/browser-use-local-backend.js";
import { BrowserUseLocalProcessControl } from "../src/browser-use-local-control.js";
import { inspectBrowserUseLocalRuntime, type BrowserUseLocalInspection } from "../src/browser-use-local-setup.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs/promises", async (original) => ({
  ...await original<typeof import("node:fs/promises")>(), mkdir: vi.fn(),
}));
vi.mock("../src/browser-use-local-setup.js", async (original) => ({
  ...await original<typeof import("../src/browser-use-local-setup.js")>(),
  inspectBrowserUseLocalRuntime: vi.fn(),
}));

const roots: string[] = [];
const request = {
  task: "Inspect the fixture release notes", startUrl: "https://example.com",
  model: { provider: "openai", id: "fixture-unused" }, allowedDomains: ["example.com"], maxSteps: 1,
};
const inspection: BrowserUseLocalInspection = {
  backend: "browser_use_local", packageName: "browser-use", packageVersion: "0.13.7",
  pythonVersion: "3.12", platform: "darwin", arch: "arm64", status: "ready",
  pythonExecutable: "/fixture/python", browserExecutablePath: "/fixture/chrome",
  browserProduct: "system_chrome", browserVersion: "150.0.0.0",
};

beforeEach(() => {
  vi.mocked(spawn).mockReset();
  vi.mocked(mkdir).mockReset().mockResolvedValue(undefined);
  vi.mocked(inspectBrowserUseLocalRuntime).mockReset().mockResolvedValue(inspection);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function dataRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-browser-abort-"));
  roots.push(root); return root;
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((ready) => { resolve = ready; });
  return { promise, resolve };
}
function childProcess() {
  return Object.assign(new EventEmitter(), {
    pid: 731, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
  }) as unknown as ChildProcessWithoutNullStreams;
}

describe("Browser Use local cancellation admission", () => {
  it.each(["inspection", "artifact directory"])("never spawns after cancellation during %s preparation", async (stage) => {
    const entered = gate(), release = gate();
    if (stage === "inspection") {
      vi.mocked(inspectBrowserUseLocalRuntime).mockImplementationOnce(async () => {
        entered.resolve(); await release.promise; return inspection;
      });
    } else {
      vi.mocked(mkdir).mockImplementationOnce(async () => {
        entered.resolve(); await release.promise; return undefined;
      });
    }
    const backend = new BrowserUseLocalBackend({ dataRoot: await dataRoot(), env: { NAPIER_BROWSER_USE_CREDENTIAL: "unused" } });
    const controller = new AbortController();
    const reason = new Error("fixture cancelled preparation");
    const execution = backend.run(request, () => undefined, controller.signal);
    const rejected = expect(execution).rejects.toBe(reason);
    try {
      await entered.promise; controller.abort(reason); release.resolve(); await rejected;
      expect(spawn).not.toHaveBeenCalled();
      // The failed start also releases the backend's single-task reservation.
      await expect(backend.run(request, () => undefined, AbortSignal.abort(reason))).rejects.toBe(reason);
    } finally { release.resolve(); await execution.catch(() => undefined); }
  });

  it("terminates an abort between spawn and listener attachment without writing or settling twice", async () => {
    const child = childProcess();
    const controller = new AbortController();
    const write = vi.spyOn(child.stdin, "end");
    const detach = vi.spyOn(BrowserUseLocalProcessControl.prototype, "detach");
    vi.mocked(spawn).mockImplementationOnce(() => {
      controller.abort();
      return child;
    });
    const kill = vi.fn(() => {
      child.emit("close", null, "SIGTERM");
      child.emit("error", new Error("fixture exit race"));
    });
    const backend = new BrowserUseLocalBackend({
      dataRoot: await dataRoot(), env: { NAPIER_BROWSER_USE_CREDENTIAL: "unused" },
      control: { platform: "darwin", kill, schedule: () => undefined },
    });
    const observe = vi.fn();
    await expect(backend.run(request, observe, controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    expect(kill).toHaveBeenCalledExactlyOnceWith(-731, "SIGTERM");
    expect(detach).toHaveBeenCalledExactlyOnceWith(731);
    expect(write).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
  });

  it("drains a cancelled process when stdin also reports a broken pipe", async () => {
    const child = childProcess();
    vi.mocked(spawn).mockReturnValueOnce(child);
    const controller = new AbortController();
    const started = gate();
    const end = child.stdin.end.bind(child.stdin);
    vi.spyOn(child.stdin, "end").mockImplementation(() => { started.resolve(); return end(); });
    const kill = vi.fn();
    const backend = new BrowserUseLocalBackend({
      dataRoot: await dataRoot(), env: { NAPIER_BROWSER_USE_CREDENTIAL: "unused" },
      control: { platform: "darwin", kill, schedule: () => undefined },
    });
    const execution = backend.run(request, () => undefined, controller.signal);
    const rejected = expect(execution).rejects.toMatchObject({ code: "cancelled" });
    await started.promise; controller.abort();
    expect(() => child.stdin.emit("error", Object.assign(new Error("fixture pipe closed"), { code: "EPIPE" }))).not.toThrow();
    expect(kill).toHaveBeenCalledOnce();
    child.emit("close", null, "SIGTERM"); await rejected;
  });

  it("handles a spawn failure that has no process identity", async () => {
    const child = Object.assign(new EventEmitter(), { pid: undefined });
    vi.mocked(spawn).mockReturnValueOnce(child as ChildProcessWithoutNullStreams);
    const backend = new BrowserUseLocalBackend({ dataRoot: await dataRoot(), env: { NAPIER_BROWSER_USE_CREDENTIAL: "unused" } });
    await expect(backend.run(request, () => undefined)).rejects.toThrow("did not expose an identity");
    expect(() => child.emit("error", new Error("fixture spawn failed"))).not.toThrow();
  });
});

describe("Browser Use local observation failures", () => {
  it("stops malformed output and retains its task reservation until the child closes", async () => {
    const harness = await runningBridge();
    const observe = vi.fn();
    const execution = harness.backend.run(request, observe);
    const rejected = expect(execution).rejects.toMatchObject({ code: "backend_protocol_invalid" });
    let settled = false;
    void execution.then(() => { settled = true; }, () => { settled = true; });
    await harness.started;
    harness.child.stdout.emit("data", Buffer.from(`not json\n${JSON.stringify(step())}\n`));
    await vi.waitFor(() => expect(harness.kill).toHaveBeenCalledExactlyOnceWith(-731, "SIGTERM"));
    expect(settled).toBe(false);
    expect(observe).not.toHaveBeenCalled();
    await expect(harness.backend.run(request, observe)).rejects.toMatchObject({ code: "browser_task_busy" });
    harness.child.emit("close", null, "SIGTERM");
    await rejected;
    expect(harness.detach).toHaveBeenCalledExactlyOnceWith(731);
    // The failed observation releases the logical task only after child close.
    const reason = new Error("stopped before a second launch");
    await expect(harness.backend.run(request, observe, AbortSignal.abort(reason))).rejects.toBe(reason);
  });

  it.each(["running", "takeover"] as const)("drains an observer rejection while the agent is %s", async (state) => {
    const harness = await runningBridge();
    const failure = new Error("fixture observation persistence failed");
    const observe = vi.fn(async () => { throw failure; });
    const execution = harness.backend.run(request, observe);
    const rejected = expect(execution).rejects.toBe(failure);
    let settled = false;
    void execution.then(() => { settled = true; }, () => { settled = true; });
    await harness.started;
    if (state === "takeover") harness.backend.takeover();
    harness.child.stdout.emit("data", Buffer.from(`${JSON.stringify(step())}\n${JSON.stringify(step())}\n`));
    await vi.waitFor(() => expect(harness.kill).toHaveBeenCalledWith(-731, "SIGTERM"));
    harness.child.emit("error", new Error("fixture process error during cleanup"));
    expect(settled).toBe(false);
    expect(observe).toHaveBeenCalledOnce();
    if (state === "takeover") {
      expect(harness.kill.mock.calls).toEqual([[731, "SIGSTOP"], [731, "SIGCONT"], [-731, "SIGTERM"]]);
    }
    harness.child.emit("close", null, "SIGTERM");
    await rejected;
  });

  it("settles a late observer rejection after close without signalling the old process identity", async () => {
    const harness = await runningBridge();
    const entered = gate();
    const release = gate();
    const failure = new Error("fixture late observation failure");
    const execution = harness.backend.run(request, async () => {
      entered.resolve();
      await release.promise;
      throw failure;
    });
    const rejected = expect(execution).rejects.toBe(failure);
    await harness.started;
    harness.child.stdout.emit("data", Buffer.from(`${JSON.stringify(step())}\n`));
    await entered.promise;
    harness.child.emit("close", 0, null);
    release.resolve();
    await rejected;
    expect(harness.kill).not.toHaveBeenCalled();
    expect(harness.detach).toHaveBeenCalledExactlyOnceWith(731);
  });

  it("does not swallow failed persistence of automatic takeover", async () => {
    const harness = await runningBridge();
    const failure = new Error("fixture takeover observation failure");
    const observe = vi.fn(async (event) => {
      if (event.type === "control") throw failure;
    });
    const execution = harness.backend.run(request, observe);
    const rejected = expect(execution).rejects.toBe(failure);
    await harness.started;
    harness.child.stdout.emit("data", Buffer.from(`${JSON.stringify({ ...step(), errorCode: "captcha_handoff_required" })}\n`));
    await vi.waitFor(() => expect(harness.kill).toHaveBeenCalledWith(-731, "SIGTERM"));
    expect(harness.kill.mock.calls).toEqual([[731, "SIGSTOP"], [731, "SIGCONT"], [-731, "SIGTERM"]]);
    harness.child.emit("close", null, "SIGTERM");
    await rejected;
    expect(observe).toHaveBeenCalledTimes(2);
  });
});

async function runningBridge() {
  const child = childProcess();
  vi.mocked(spawn).mockReturnValueOnce(child);
  const started = gate();
  const end = child.stdin.end.bind(child.stdin);
  vi.spyOn(child.stdin, "end").mockImplementation(() => { started.resolve(); return end(); });
  const kill = vi.fn<(pid: number, signal: NodeJS.Signals) => void>();
  const detach = vi.spyOn(BrowserUseLocalProcessControl.prototype, "detach");
  const backend = new BrowserUseLocalBackend({
    dataRoot: await dataRoot(), env: { NAPIER_BROWSER_USE_CREDENTIAL: "unused" },
    control: { platform: "darwin", kill, schedule: () => undefined },
  });
  return { child, started: started.promise, kill, detach, backend };
}

function step() {
  return { type: "step", backend: "browser_use_local", step: 1, url: "https://example.com", title: "Fixture", actionNames: [] };
}
