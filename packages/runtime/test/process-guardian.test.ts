import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createParentGuardedTerminalLaunch,
  launchParentGuardedProcess,
} from "../src/process-guardian.js";
import {
  PROCESS_GUARDIAN_SPEC_ENV,
  PROCESS_GUARDIAN_WORKER_SOURCE,
} from "../src/process-guardian-worker-source.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import type { PreparedCommandExecution } from "../src/command-execution.js";
import { bindWorkspaceProcessIo } from "../src/workspace-process-terminal.js";

const temporaryRoots: string[] = [];
const livePids = new Set<number>();

afterEach(async () => {
  for (const pid of livePids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  livePids.clear();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("process guardian", () => {
  it("binds parent-loss protection into Workspace Process resource evidence", () => {
    const prepared = {
      launch: {
        command: process.execPath,
        args: ["--eval", "void 0"],
        cwd: "/workspace",
        env: { CI: "1" },
        workspaceRoot: "/workspace",
        approvedCapabilities: ["process.spawn", "workspace.read"],
      },
      receipt: {
        environmentSha256: "environment-hash",
        resourceLimitsSha256: "command-resource-hash",
      },
    } as PreparedCommandExecution;
    const pipe = bindWorkspaceProcessIo(prepared);
    const terminal = bindWorkspaceProcessIo(prepared, {
      columns: 80,
      rows: 24,
    });
    expect(pipe.launch.parentDeathGuard).toBe(true);
    expect(terminal.launch.parentDeathGuard).toBe(true);
    expect(pipe.resourceLimitsSha256).toBe(
      sha256(
        canonicalJson({
          commandResourceLimitsSha256: "command-resource-hash",
          parentDeathGuard: true,
          terminal: null,
        }),
      ),
    );
    expect(terminal.resourceLimitsSha256).not.toBe(pipe.resourceLimitsSha256);
  });

  it("proxies bounded process IO without forwarding its private specification", async () => {
    const cwd = await temporaryRoot();
    const guarded = await launchParentGuardedProcess({
      command: process.execPath,
      args: [
        "--input-type=module",
        "--eval",
        [
          "process.stdin.setEncoding('utf8');",
          "let input = '';",
          "process.stdin.on('data', (value) => input += value);",
          "process.stdin.on('end', () => {",
          `  const hidden = process.env[${JSON.stringify(PROCESS_GUARDIAN_SPEC_ENV)}] ?? 'absent';`,
          "  process.stdout.write(input.toUpperCase() + ':' + hidden);",
          "});",
        ].join("\n"),
      ],
      cwd,
      env: { LANG: "C" },
    });
    livePids.add(guarded.guardianPid);
    livePids.add(guarded.targetPid);
    const stdout = collect(guarded.stdout);
    const stderr = collect(guarded.stderr);
    guarded.stdin.end("guardian payload");
    await expect(guarded.exit).resolves.toEqual({ code: 0, signal: null });
    livePids.delete(guarded.guardianPid);
    livePids.delete(guarded.targetPid);
    await expect(stdout).resolves.toBe("GUARDIAN PAYLOAD:absent");
    await expect(stderr).resolves.toBe("");
  });

  it("keeps terminal target arguments out of the guardian command line", () => {
    const launch = createParentGuardedTerminalLaunch({
      command: process.execPath,
      args: ["--eval", "const PRIVATE_ARGUMENT = 'terminal-secret'"],
      cwd: "/tmp",
      env: { TERM: "xterm-256color", PRIVATE_ENV: "terminal-env-secret" },
    });
    const commandLine = [launch.command, ...launch.args].join("\0");
    expect(commandLine).not.toContain("terminal-secret");
    expect(commandLine).not.toContain("terminal-env-secret");
    const encoded = launch.env[PROCESS_GUARDIAN_SPEC_ENV]!;
    const specification = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8"),
    ) as {
      args: string[];
      env: Record<string, string>;
      parentPid: number;
    };
    expect(specification).toEqual(
      expect.objectContaining({
        args: ["--eval", "const PRIVATE_ARGUMENT = 'terminal-secret'"],
        env: {
          TERM: "xterm-256color",
          PRIVATE_ENV: "terminal-env-secret",
        },
        parentPid: process.pid,
      }),
    );
    expect(specification.env).not.toHaveProperty(PROCESS_GUARDIAN_SPEC_ENV);
  });

  it("fails closed without exposing a rejected target path or arguments", async () => {
    const cwd = await temporaryRoot();
    const launch = launchParentGuardedProcess({
      command: path.join(cwd, "missing-private-target"),
      args: ["private-guardian-argument"],
      cwd,
      env: { PRIVATE_GUARDIAN_ENV: "private-guardian-value" },
    });
    await expect(launch).rejects.toThrow(
      "Process guardian could not start its sandbox target",
    );
    await expect(launch).rejects.not.toThrow("missing-private-target");
    await expect(launch).rejects.not.toThrow("private-guardian");
  });

  it("preserves a fast target failure instead of reporting guardian success", async () => {
    const cwd = await temporaryRoot();
    const guarded = await launchParentGuardedProcess({
      command: process.execPath,
      args: ["--input-type=module", "--eval", "process.exit(19)"],
      cwd,
      env: { LANG: "C" },
    });
    livePids.add(guarded.guardianPid);
    livePids.add(guarded.targetPid);
    await expect(guarded.exit).resolves.toEqual({ code: 19, signal: null });
    livePids.delete(guarded.guardianPid);
    livePids.delete(guarded.targetPid);
  });

  const posixIt = process.platform === "win32" ? it.skip : it;
  posixIt(
    "terminates the complete target process group after an ungraceful parent exit",
    async () => {
      const cwd = await temporaryRoot();
      const parent = spawn(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          parentHarnessSource(PROCESS_GUARDIAN_WORKER_SOURCE),
        ],
        {
          cwd,
          env: {},
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const parentExit = childExit(parent);
      const ready = await readJsonLine(parent.stdout!);
      const guardianPid = Number(ready["guardianPid"]);
      const targetPid = Number(ready["targetPid"]);
      expect(Number.isSafeInteger(guardianPid)).toBe(true);
      expect(Number.isSafeInteger(targetPid)).toBe(true);
      livePids.add(guardianPid);
      livePids.add(targetPid);
      expect(isProcessAlive(guardianPid)).toBe(true);
      expect(isProcessAlive(targetPid)).toBe(true);

      parent.kill("SIGKILL");
      await parentExit;
      await waitForProcessesToExit([guardianPid, targetPid]);
      livePids.delete(guardianPid);
      livePids.delete(targetPid);
      expect(isProcessAlive(guardianPid)).toBe(false);
      expect(isProcessAlive(targetPid)).toBe(false);
    },
    15_000,
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-guardian-test-"));
  temporaryRoots.push(root);
  return root;
}

function collect(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let value = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      value += chunk;
    });
    stream.once("end", () => resolve(value));
  });
}

function childExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once("close", () => resolve());
  });
}

function readJsonLine(
  stream: NodeJS.ReadableStream,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let value = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      value += chunk;
      const newline = value.indexOf("\n");
      if (newline < 0) return;
      try {
        resolve(JSON.parse(value.slice(0, newline)) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    stream.once("end", () =>
      reject(new Error("Parent harness exited before guardian readiness")),
    );
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessesToExit(pids: number[]): Promise<void> {
  const deadline = Date.now() + 6_000;
  while (pids.some(isProcessAlive) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function parentHarnessSource(workerSource: string): string {
  return `
    import { spawn } from "node:child_process";
    const workerSource = ${JSON.stringify(workerSource)};
    const guardian = spawn(
      process.execPath,
      ["--input-type=module", "--eval", workerSource],
      {
        cwd: process.cwd(),
        env: { LANG: "C", LC_ALL: "C", NO_COLOR: "1" },
        detached: true,
        shell: false,
        stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
      },
    );
    guardian.once("spawn", () => {
      guardian.stdio[3].end(JSON.stringify({
        parentPid: process.pid,
        command: process.execPath,
        args: ["--input-type=module", "--eval", "setInterval(() => {}, 1000)"],
        cwd: process.cwd(),
        env: { LANG: "C" },
        statusFd: 4,
      }));
    });
    let status = "";
    guardian.stdio[4].setEncoding("utf8");
    guardian.stdio[4].on("data", (chunk) => {
      status += chunk;
      const newline = status.indexOf("\\n");
      if (newline < 0) return;
      const message = JSON.parse(status.slice(0, newline));
      if (message.type !== "ready") process.exit(73);
      process.stdout.write(JSON.stringify({
        guardianPid: guardian.pid,
        targetPid: message.pid,
      }) + "\\n");
      setInterval(() => {}, 1000);
    });
  `;
}
