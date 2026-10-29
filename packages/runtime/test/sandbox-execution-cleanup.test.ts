import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ExecutionResourceLaunchError } from "../src/execution-resource-admission.js";
import {
  createParentGuardedTerminalLaunch,
  launchParentGuardedProcess,
} from "../src/process-guardian.js";
import { PROCESS_GUARDIAN_WORKER_SOURCE } from "../src/process-guardian-worker-source.js";
import { launchSandboxProcess } from "../src/sandbox-process-lifecycle.js";
import { launchTerminalProcess } from "../src/sandbox-terminal.js";
import { finalizeSandboxProcess } from "../src/sandbox-process-cleanup.js";
import { PassThrough } from "node:stream";
import { HostDirectSandboxAdapter } from "../src/sandbox-host-direct.js";
import { UnsupportedSandboxAdapter } from "../src/unsupported-sandbox.js";

const roots: string[] = [];
const liveTargets = new Set<number>();
const posix = process.platform === "win32" ? describe.skip : describe;

afterEach(async () => {
  for (const pid of liveTargets) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* Already reaped. */
    }
  }
  liveTargets.clear();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

posix("Sandbox execution cleanup evidence", () => {
  it("preserves a cleanup rejection whose thrown value is undefined", async () => {
    const child = finalizeSandboxProcess(
      {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exit: Promise.resolve({ code: 0, signal: null }),
        cleanup: Promise.resolve({
          status: "released",
          scope: "sandbox_execution",
          reason: "fixture_cleanup_acknowledged",
        }),
        terminate: async () => undefined,
      },
      async () => {
        throw undefined;
      },
    );
    const outcome = await child.exit.then(
      () => ({ rejected: false }),
      (error: unknown) => ({ rejected: true, error }),
    );
    expect(outcome).toEqual({ rejected: true, error: undefined });
    await expect(child.cleanup).resolves.toMatchObject({
      status: "unknown",
      reason: "sandbox_cleanup_failed",
    });
  });
  it("separates a normal Guardian target failure from acknowledged cleanup", async () => {
    const child = await launchParentGuardedProcess(
      await request("process.exit(19)"),
    );
    await expect(child.exit).resolves.toEqual({ code: 19, signal: null });
    await expect(child.cleanup).resolves.toEqual({
      status: "released",
      scope: "sandbox_execution",
      reason: "guardian_cleanup_acknowledged",
    });
    expect(child.resourceIdentity).toEqual({
      resourceId: expect.stringMatching(/^guardian:/),
      identitySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("requires a final ACK even when the Guardian itself exits zero", async () => {
    const withoutAck = ((command: string, args: string[], options: object) =>
      spawn(
        command,
        args.map((arg) =>
          arg === PROCESS_GUARDIAN_WORKER_SOURCE
            ? arg.replace(
                "function report(value, statusFd) {",
                'function report(value, statusFd) { if (value.type === "exit") return;',
              )
            : arg,
        ),
        options,
      )) as typeof spawn;
    const child = await launchParentGuardedProcess(
      await request("process.exit(0)"),
      withoutAck,
    );
    await expect(child.exit).resolves.toEqual({ code: 0, signal: null });
    await expect(child.cleanup).resolves.toEqual({
      status: "unknown",
      scope: "sandbox_execution",
      reason: "guardian_cleanup_ack_missing",
    });
  });

  it("quarantines cleanup when the Guardian is killed before target cleanup", async () => {
    const child = await launchParentGuardedProcess(
      await request("setInterval(() => {}, 1000)"),
    );
    liveTargets.add(child.targetPid);
    process.kill(child.guardianPid, "SIGKILL");
    await expect(child.exit).resolves.toEqual({
      code: null,
      signal: "SIGKILL",
    });
    await expect(child.cleanup).resolves.toMatchObject({
      status: "unknown",
      scope: "sandbox_execution",
    });
    expect(alive(child.targetPid)).toBe(true);
    process.kill(child.targetPid, "SIGKILL");
    await vi.waitFor(() => expect(alive(child.targetPid)).toBe(false));
    liveTargets.delete(child.targetPid);
  });

  it("records affirmative no-start evidence for a rejected Guardian target", async () => {
    const input = await request("void 0");
    const error = await launchParentGuardedProcess({
      ...input,
      command: path.join(input.cwd, "absent-target"),
    }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ExecutionResourceLaunchError);
    expect(error).toMatchObject({
      cleanup: { status: "not_started", scope: "sandbox_execution" },
      resourceIdentity: { resourceId: expect.stringMatching(/^guardian:/) },
    });
  });

  it("returns a nonce-bound cleanup ACK from a real Guardian PTY", async () => {
    const launch = createParentGuardedTerminalLaunch(
      await request("process.exit(0)"),
    );
    const child = await launchTerminalProcess({
      ...launch,
      columns: 80,
      rows: 24,
    });
    await expect(child.exit).resolves.toEqual({ code: 0, signal: null });
    await expect(child.cleanup).resolves.toEqual({
      status: "released",
      scope: "sandbox_execution",
      reason: "guardian_cleanup_acknowledged",
    });
  });

  it("does not release a Guardian PTY killed before its private cleanup receipt", async () => {
    const root = await temporaryRoot();
    const identityPath = path.join(root, "owned-pty.json");
    const launch = createParentGuardedTerminalLaunch(
      await request(
        `require('node:fs').writeFileSync(${JSON.stringify(identityPath)},JSON.stringify({target:process.pid,guardian:process.ppid})); setInterval(()=>{},1000);`,
      ),
    );
    const child = await launchTerminalProcess({
      ...launch,
      columns: 80,
      rows: 24,
    });
    let identity = { target: 0, guardian: 0 };
    await vi.waitFor(async () => {
      identity = JSON.parse(
        await readFile(identityPath, "utf8"),
      ) as typeof identity;
      expect(identity.target).toBeGreaterThan(1);
    });
    liveTargets.add(identity.target);
    try {
      process.kill(identity.guardian, "SIGKILL");
      await expect(child.cleanup).resolves.toMatchObject({
        status: "unknown",
        reason: "guardian_cleanup_receipt_missing",
      });
      expect(alive(identity.target)).toBe(true);
    } finally {
      try {
        process.kill(identity.target, "SIGKILL");
      } catch {
        /* Already stopped. */
      }
      await vi.waitFor(() => expect(alive(identity.target)).toBe(false));
      liveTargets.delete(identity.target);
    }
  });

  it("keeps scratch cleanup failure separate from successful target exit", async () => {
    const input = await request("process.exit(0)");
    const scratch = await temporaryRoot();
    const child = await launchSandboxProcess({
      ...input,
      sandboxHome: scratch,
      parentDeathGuard: false,
      beforeCleanup: async () => {
        throw new Error("injected projection cleanup failure");
      },
    });
    await expect(child.exit).rejects.toThrow(
      "injected projection cleanup failure",
    );
    await expect(child.cleanup).resolves.toEqual({
      status: "unknown",
      scope: "sandbox_execution",
      reason: "sandbox_cleanup_failed",
    });
    await expect(access(scratch)).rejects.toThrow();
  });

  it("acknowledges direct process exit only after observing its owned group absent", async () => {
    const child = await launchSandboxProcess({
      ...(await request("process.exit(0)")),
      sandboxHome: await temporaryRoot(),
      parentDeathGuard: false,
    });
    await expect(child.exit).resolves.toEqual({ code: 0, signal: null });
    await expect(child.cleanup).resolves.toEqual({
      status: "released",
      scope: "sandbox_execution",
      reason: "owned_process_group_absent",
    });
  });

  it("does not release a direct handle while a known group member ignores termination", async () => {
    const home = await temporaryRoot();
    const pidPath = path.join(home, "owned-child.pid");
    const source = `const {spawn}=require('node:child_process'); const {writeFileSync}=require('node:fs');
      const child=spawn(process.execPath,['--eval',"process.on('SIGTERM',()=>{}); process.stdout.write('ready'); setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
      child.stdout.once('data',()=>{writeFileSync(${JSON.stringify(pidPath)},String(child.pid)); process.exit(0);});`;
    const child = await launchSandboxProcess({
      ...(await request(source)),
      sandboxHome: await temporaryRoot(),
      parentDeathGuard: false,
    });
    let pid = 0;
    await vi.waitFor(async () => {
      pid = Number(await readFile(pidPath, "utf8"));
      expect(pid).toBeGreaterThan(1);
    });
    liveTargets.add(pid);
    await expect(child.exit).resolves.toEqual({ code: 0, signal: null });
    await expect(child.cleanup).resolves.toMatchObject({
      status: "unknown",
      reason: "owned_process_group_still_present",
    });
    expect(alive(pid)).toBe(true);
    process.kill(pid, "SIGKILL");
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
    liveTargets.delete(pid);
  });

  it("keeps unexpected injected dispatch failure unknown", async () => {
    const injected = (() => {
      throw new Error("dispatch result lost");
    }) as unknown as typeof spawn;
    const error = await launchSandboxProcess({
      ...(await request("void 0")),
      sandboxHome: await temporaryRoot(),
      parentDeathGuard: false,
      spawnProcess: injected,
    }).catch((error: unknown) => error);
    expect(error).toMatchObject({
      cleanup: { status: "unknown", reason: "process_spawn_rejected" },
    });
  });

  it("compensates a custom child whose spawn acknowledgement is lost without claiming no-start", async () => {
    let pid = 0;
    const injected = ((command: string, args: string[], options: object) => {
      const actual = spawn(command, args, options);
      pid = actual.pid!;
      liveTargets.add(pid);
      const observed = Object.assign(new EventEmitter(), {
        pid,
        stdin: actual.stdin,
        stdout: actual.stdout,
        stderr: actual.stderr,
        kill: actual.kill.bind(actual),
        exitCode: null,
        signalCode: null,
      });
      actual.once("spawn", () =>
        observed.emit("error", new Error("spawn acknowledgement lost")),
      );
      actual.once("exit", (code, signal) =>
        observed.emit("exit", code, signal),
      );
      actual.once("close", (code, signal) =>
        observed.emit("close", code, signal),
      );
      return observed as unknown as ChildProcess;
    }) as typeof spawn;
    const error = await launchSandboxProcess({
      ...(await request("setInterval(()=>{},1000)")),
      sandboxHome: await temporaryRoot(),
      parentDeathGuard: false,
      spawnProcess: injected,
    }).catch((error: unknown) => error);
    expect(error).toMatchObject({
      cleanup: { status: "unknown", reason: "process_spawn_failed" },
      resourceIdentity: { resourceId: expect.stringMatching(/^process:/) },
    });
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
    liveTargets.delete(pid);
  });

  it("does not trust a custom Guardian spawn hook before specification delivery", async () => {
    let pid = 0;
    const injected = (() => {
      const child = spawn(
        process.execPath,
        ["--eval", "setInterval(()=>{},1000)"],
        { detached: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      pid = child.pid!;
      liveTargets.add(pid);
      return child;
    }) as unknown as typeof spawn;
    const error = await launchParentGuardedProcess(
      await request("void 0"),
      injected,
    ).catch((error: unknown) => error);
    expect(error).toMatchObject({
      cleanup: { status: "unknown", reason: "guardian_target_not_dispatched" },
      resourceIdentity: { resourceId: expect.stringMatching(/^guardian:/) },
    });
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
    liveTargets.delete(pid);
  });

  it("keeps built-in OS spawn rejection before PID allocation as affirmative no-start", async () => {
    const input = await request("void 0");
    const error = await launchSandboxProcess({
      ...input,
      command: path.join(input.cwd, "absent"),
      sandboxHome: await temporaryRoot(),
      parentDeathGuard: false,
    }).catch((error: unknown) => error);
    expect(error).toMatchObject({
      cleanup: { status: "not_started", reason: "process_spawn_failed" },
    });
  });

  it("classifies explicit validation and unsupported-provider rejection before dispatch", async () => {
    const input = await request("void 0");
    const invalid = await new HostDirectSandboxAdapter()
      .launch({
        ...input,
        command: "relative",
        workspaceRoot: input.cwd,
        approvedCapabilities: ["process.spawn"],
      })
      .catch((error: unknown) => error);
    expect(invalid).toMatchObject({
      cleanup: { status: "not_started", reason: "launch_validation_failed" },
    });
    const unsupported = await new UnsupportedSandboxAdapter("test")
      .launch()
      .catch((error: unknown) => error);
    expect(unsupported).toMatchObject({
      cleanup: { status: "not_started", reason: "sandbox_unavailable" },
    });
  });
});

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-execution-cleanup-"));
  roots.push(root);
  return root;
}

async function request(source: string) {
  return {
    command: process.execPath,
    args: ["--eval", source],
    cwd: await temporaryRoot(),
    env: { LANG: "C", LC_ALL: "C" },
  };
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
