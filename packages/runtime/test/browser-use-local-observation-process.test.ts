import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserUseLocalBackend } from "../src/browser-use-local-backend.js";
import { BROWSER_USE_LOCAL_BRIDGE } from "../src/browser-use-local-bridge.js";
import { inspectBrowserUseLocalRuntime } from "../src/browser-use-local-setup.js";
import type { ExecutionResourceLease } from "../src/execution-resource-admission.js";

vi.mock("node:child_process", async (original) => ({
  ...await original<typeof import("node:child_process")>(), spawn: vi.fn(),
}));
vi.mock("../src/browser-use-local-setup.js", async (original) => ({
  ...await original<typeof import("../src/browser-use-local-setup.js")>(),
  inspectBrowserUseLocalRuntime: vi.fn(),
}));

const roots: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const closed = once(child, "close");
    child.kill("SIGKILL");
    await closed;
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("Browser Use local owned child cleanup", () => {
  it.each(["malformed event", "observer rejection"] as const)(
    "waits for a real fixture process to close after %s",
    async (failureMode) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "napier-browser-observation-"));
      roots.push(root);
      vi.mocked(inspectBrowserUseLocalRuntime).mockResolvedValue({
        backend: "browser_use_local", packageName: "browser-use", packageVersion: "0.13.7",
        pythonVersion: "3.12", platform: "darwin", arch: "arm64", status: "ready",
        pythonExecutable: process.execPath, browserExecutablePath: "/fixture/not-launched",
        browserProduct: "system_chrome", browserVersion: "150.0.0.0",
      });
      const event = failureMode === "malformed event"
        ? "not json"
        : JSON.stringify({ type: "step", backend: "browser_use_local", step: 1, url: "https://example.com", title: "Fixture", actionNames: [] });
      // Replace only the Python bridge with a local Node fixture. The production
      // spawn options, streams, control and event-processing path remain active.
      // No browser, network or model process is started by this fixture.
      const original = await vi.importActual<typeof import("node:child_process")>("node:child_process");
      let child!: ChildProcessWithoutNullStreams;
      let closeObserved = false;
      vi.mocked(spawn).mockImplementationOnce((_command, _args, options) => {
        child = original.spawn(process.execPath, ["-e", `
          process.stdin.resume();
          process.stdin.once('end', () => process.stdout.write(${JSON.stringify(`${event}\n`)}));
          setInterval(() => {}, 1000);
        `], options) as ChildProcessWithoutNullStreams;
        children.push(child);
        child.once("close", () => { closeObserved = true; });
        return child;
      });
      const signals: Array<[number, NodeJS.Signals]> = [];
      const lease = resourceLease();
      const backend = new BrowserUseLocalBackend({
        dataRoot: root,
        env: { NAPIER_BROWSER_USE_CREDENTIAL: "fixture-unused" },
        resourceLease: lease,
        control: {
          platform: process.platform,
          kill: (pid, signal) => { signals.push([pid, signal]); process.kill(pid, signal); },
          // SIGTERM is sufficient for this exact fixture. Avoid a later timer
          // signalling a PID/group that the test already proved had exited.
          schedule: () => undefined,
        },
      });
      const failure = new Error("fixture observation rejected");
      const observe = vi.fn(async () => { throw failure; });
      const execution = backend.run({
        task: "Inspect fixture output", startUrl: "https://example.com",
        model: { provider: "openai", id: "fixture-unused" },
        allowedDomains: ["example.com"], maxSteps: 1,
      }, observe);
      if (failureMode === "malformed event") {
        await expect(execution).rejects.toMatchObject({ code: "backend_protocol_invalid" });
        expect(observe).not.toHaveBeenCalled();
      } else {
        await expect(execution).rejects.toBe(failure);
        expect(observe).toHaveBeenCalledOnce();
      }
      expect(closeObserved).toBe(true);
      expect(child.signalCode).toBe("SIGTERM");
      expect(signals).toEqual([[process.platform === "win32" ? child.pid! : -child.pid!, "SIGTERM"]]);
      expect(() => process.kill(child.pid!, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
      expect(lease.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "unknown", scope: "browser_task" }));
    },
  );
});

describe("Browser Use local Python cleanup acknowledgement", () => {
  it.each(["successful cleanup", "failed cleanup"] as const)(
    "runs the real bridge protocol around a stub Agent with delayed %s",
    async (mode) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "napier-browser-python-cleanup-"));
      roots.push(root);
      vi.mocked(inspectBrowserUseLocalRuntime).mockResolvedValue({
        backend: "browser_use_local", packageName: "browser-use", packageVersion: "0.13.7",
        pythonVersion: "3.12", platform: "darwin", arch: "arm64", status: "ready",
        pythonExecutable: "python3", browserExecutablePath: "/fixture/not-launched",
        browserProduct: "system_chrome", browserVersion: "150.0.0.0",
      });
      const original = await vi.importActual<typeof import("node:child_process")>("node:child_process");
      let child!: ChildProcessWithoutNullStreams;
      let artifactDirectory!: string;
      let closeObserved = false;
      const events: Array<Record<string, unknown>> = [];
      let stdout = "";
      vi.mocked(spawn).mockImplementationOnce((command, _args, options) => {
        artifactDirectory = String(options?.cwd);
        // Stub the SDK and model classes before executing the production bridge.
        // No installed BrowserUse package, browser or model is used.
        child = original.spawn(command, ["-c", `CLEANUP_FAIL = ${mode === "failed cleanup" ? "True" : "False"}\n${PYTHON_AGENT_FIXTURE}\n${BROWSER_USE_LOCAL_BRIDGE}`], options) as ChildProcessWithoutNullStreams;
        children.push(child);
        child.once("close", () => { closeObserved = true; });
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
          const lines = stdout.split("\n");
          stdout = lines.pop()!;
          for (const line of lines) events.push(JSON.parse(line) as Record<string, unknown>);
        });
        return child;
      });
      const lease = resourceLease();
      const observe = vi.fn();
      const backend = new BrowserUseLocalBackend({
        dataRoot: root, env: { PATH: process.env["PATH"], NAPIER_BROWSER_USE_CREDENTIAL: "fixture-unused" },
        resourceLease: lease,
      });
      const execution = backend.run({
        task: "Inspect fixture output", startUrl: "https://example.com",
        model: { provider: "openai", id: "fixture-unused" }, allowedDomains: ["example.com"], maxSteps: 1,
      }, observe);
      const outcome = execution.then((value) => ({ value }), (error: unknown) => ({ error }));
      let settled = false;
      void outcome.then(() => { settled = true; });
      await vi.waitFor(() => {
        expect(events.some((event) => event["type"] === "completed")).toBe(true);
        expect(existsSync(path.join(artifactDirectory, "cleanup-entered"))).toBe(true);
      });
      expect(events.some((event) => event["type"] === "cleanup")).toBe(false);
      expect(settled).toBe(false);
      expect(lease.settle).not.toHaveBeenCalled();
      expect(() => process.kill(child.pid!, 0)).not.toThrow();
      await writeFile(path.join(artifactDirectory, "release-cleanup"), "release");
      const result = await outcome;
      if (mode === "successful cleanup") expect(result).toMatchObject({ value: { status: "completed", result: "Fixture result" } });
      else expect(result).toMatchObject({ error: { code: "backend_failed" } });
      expect(closeObserved).toBe(true);
      const ackIndex = events.findIndex((event) => event["type"] === "cleanup");
      expect(ackIndex).toBeGreaterThan(events.findIndex((event) => event["type"] === "completed"));
      expect(events[ackIndex]).toEqual({
        type: "cleanup", backend: "browser_use_local", schemaVersion: 1,
        runNonce: lease.bind.mock.calls[0]![0].resourceId,
        status: mode === "successful cleanup" ? "released" : "unknown",
      });
      expect(lease.settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        status: mode === "successful cleanup" ? "released" : "unknown", scope: "browser_task",
      }));
      expect(observe.mock.calls.every(([event]) => event.type !== "cleanup")).toBe(true);
      expect(() => process.kill(child.pid!, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
    },
  );
});

function resourceLease() {
  return {
    id: "fixture_browser_resource", dispatched: vi.fn<ExecutionResourceLease["dispatched"]>(),
    bind: vi.fn<ExecutionResourceLease["bind"]>(), settle: vi.fn<ExecutionResourceLease["settle"]>(),
  };
}

const PYTHON_AGENT_FIXTURE = String.raw`
import asyncio
import sys
import types

class Profile:
    def __init__(self, **options):
        self.user_data_dir = options['user_data_dir']
class Placeholder:
    def __init__(self, **options):
        pass
class Session:
    event_bus = types.SimpleNamespace(on=lambda *args: None)
    async def start(self):
        pass
    async def navigate_to(self, target):
        pass
class History:
    usage = None
    def final_result(self):
        return 'Fixture result'
    def is_successful(self):
        return True
    def number_of_steps(self):
        return 1
class Agent:
    def __init__(self, **options):
        self.directory = options['browser_profile'].user_data_dir.parent
        self.browser_session = Session()
    async def run(self, **options):
        return History()
    async def close(self):
        (self.directory / 'cleanup-entered').write_text('entered')
        while not (self.directory / 'release-cleanup').exists():
            await asyncio.sleep(0.01)
        if CLEANUP_FAIL:
            raise RuntimeError('fixture cleanup failure')
        (self.directory / 'cleanup-finished').write_text('closed')

module = types.ModuleType('browser_use')
module.Agent = Agent
module.BrowserProfile = Profile
module.Tools = Placeholder
for name in ('ChatAnthropic', 'ChatBrowserUse', 'ChatGoogle', 'ChatOpenAI'):
    setattr(module, name, Placeholder)
llm = types.ModuleType('browser_use.llm')
llm.ChatOpenRouter = Placeholder
browser = types.ModuleType('browser_use.browser')
events = types.ModuleType('browser_use.browser.events')
events.NavigationStartedEvent = type('NavigationStartedEvent', (), {})
sys.modules.update({'browser_use': module, 'browser_use.llm': llm,
    'browser_use.browser': browser, 'browser_use.browser.events': events})
`;
