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
