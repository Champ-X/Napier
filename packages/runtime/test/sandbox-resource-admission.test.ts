import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { SwitchableSandboxAdapter } from "../src/sandbox-switchable.js";
import { ExecutionResourceLaunchError, type ExecutionResourceAdmission, type ExecutionResourceCleanup } from "../src/execution-resource-admission.js";
import type { OsSandboxAdapter, SandboxedProcess, SandboxLaunchRequest } from "../src/sandbox-types.js";

const request: SandboxLaunchRequest = {
  command: "fixture", args: [], cwd: "/fixture", env: {}, workspaceRoot: "/fixture", approvedCapabilities: [],
};
const released: ExecutionResourceCleanup = { status: "released", scope: "sandbox_execution", reason: "owned_cleanup" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  let occupied = false;
  const settle = vi.fn((proof: ExecutionResourceCleanup) => { if (proof.status !== "unknown") occupied = false; });
  const bind = vi.fn();
  const dispatched = vi.fn();
  const reserve = vi.fn(() => {
    if (occupied) throw new Error("capacity");
    occupied = true;
    return { id: "lease", bind, dispatched, settle };
  });
  const admission: ExecutionResourceAdmission = { reserve };
  const exit = deferred<{ code: number; signal: null }>();
  const cleanup = deferred<ExecutionResourceCleanup>();
  const terminate = vi.fn(async () => { exit.resolve({ code: 0, signal: null }); cleanup.resolve(released); });
  const child: SandboxedProcess = {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    exit: exit.promise, cleanup: cleanup.promise, resourceIdentity: { resourceId: "owned" }, terminate,
  };
  const launch = vi.fn(async () => child);
  const backend: OsSandboxAdapter = { id: "fixture", launch };
  return { admission, reserve, settle, bind, dispatched, exit, cleanup, child, backend, terminate, launch, occupied: () => occupied };
}

describe("switchable Sandbox resource lifetime", () => {
  it("holds capacity past target exit until cleanup settles, even without an exit consumer", async () => {
    const f = fixture();
    const sandbox = new SwitchableSandboxAdapter(f.backend, f.admission);
    const child = await sandbox.launch(request);
    expect(f.dispatched).toHaveBeenCalledOnce();
    expect(f.bind).toHaveBeenCalledWith({ resourceId: "owned" });
    f.exit.resolve({ code: 0, signal: null });
    await Promise.resolve();
    expect(f.occupied()).toBe(true);
    await expect(sandbox.launch(request)).rejects.toThrow("capacity");
    f.cleanup.resolve(released);
    await expect(child.exit).resolves.toEqual({ code: 0, signal: null });
    expect(f.occupied()).toBe(false);
    expect(f.settle).toHaveBeenCalledExactlyOnceWith(released);
  });

  it("requires target termination as well as a cleanup promise and survives backend replacement", async () => {
    const f = fixture();
    const sandbox = new SwitchableSandboxAdapter(f.backend, f.admission);
    const child = await sandbox.launch(request);
    f.cleanup.resolve(released);
    await Promise.resolve();
    expect(f.occupied()).toBe(true);
    const next = { id: "next", launch: vi.fn(async () => f.child) };
    sandbox.replace(next);
    await expect(sandbox.launch(request)).rejects.toThrow("capacity");
    expect(next.launch).not.toHaveBeenCalled();
    f.exit.resolve({ code: 0, signal: null });
    await child.exit;
    await sandbox.launch(request);
    expect(next.launch).toHaveBeenCalledOnce();
    expect(f.reserve.mock.calls.length).toBe(3);
  });

  it.each(["missing", "rejected", "unknown"] as const)("quarantines %s cleanup instead of trusting a zero exit", async (mode) => {
    const f = fixture();
    if (mode === "missing") delete f.child.cleanup;
    const child = await new SwitchableSandboxAdapter(f.backend, f.admission).launch(request);
    f.exit.resolve({ code: 0, signal: null });
    if (mode === "rejected") f.cleanup.reject(new Error("cleanup failed"));
    if (mode === "unknown") f.cleanup.resolve({ ...released, status: "unknown", reason: "no_ack" });
    await expect(child.exit).rejects.toThrow("cleanup is unknown");
    expect(f.occupied()).toBe(true);
    expect(f.settle).toHaveBeenCalledWith(expect.objectContaining({ status: "unknown" }));
  });

  it("distinguishes typed pre-start evidence from arbitrary launch errors", async () => {
    const f = fixture();
    f.launch.mockRejectedValueOnce(new ExecutionResourceLaunchError("prestart", { ...released, status: "not_started" }));
    const sandbox = new SwitchableSandboxAdapter(f.backend, f.admission);
    await expect(sandbox.launch(request)).rejects.toThrow("prestart");
    expect(f.occupied()).toBe(false);
    f.launch.mockRejectedValueOnce(new Error("lost post-dispatch observation"));
    await expect(sandbox.launch(request)).rejects.toThrow("lost post-dispatch observation");
    expect(f.occupied()).toBe(true);
  });

  it("stops before dispatch on cancellation or failed admission persistence", async () => {
    const f = fixture();
    const sandbox = new SwitchableSandboxAdapter(f.backend, f.admission);
    await expect(sandbox.launch({ ...request, signal: AbortSignal.abort() })).rejects.toThrow();
    expect(f.reserve).not.toHaveBeenCalled();
    f.dispatched.mockImplementationOnce(() => { throw new Error("disk failure"); });
    await expect(sandbox.launch(request)).rejects.toThrow("disk failure");
    expect(f.launch).not.toHaveBeenCalled();
    expect(f.settle).toHaveBeenCalledWith(expect.objectContaining({ status: "not_started" }));
  });

  it("terminates an owned child if identity persistence fails", async () => {
    const f = fixture();
    f.bind.mockImplementationOnce(() => { throw new Error("identity disk failure"); });
    await expect(new SwitchableSandboxAdapter(f.backend, f.admission).launch(request)).rejects.toThrow("identity disk failure");
    expect(f.terminate).toHaveBeenCalledOnce();
    expect(f.occupied()).toBe(false);
    expect(f.settle).toHaveBeenCalledWith(released);
  });

  it("surfaces accounting failure and does not free a physically finished invocation", async () => {
    const f = fixture();
    f.settle.mockImplementationOnce(() => { throw new Error("settlement disk failure"); });
    const child = await new SwitchableSandboxAdapter(f.backend, f.admission).launch(request);
    f.exit.resolve({ code: 0, signal: null }); f.cleanup.resolve(released);
    await expect(child.exit).rejects.toThrow("settlement disk failure");
    expect(f.occupied()).toBe(true);
  });
});
