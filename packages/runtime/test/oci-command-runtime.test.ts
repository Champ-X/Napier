import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CommandRunner,
  prepareCommandExecution,
} from "../src/command-execution.js";
import {
  probeSandboxProcessRuntime,
  probeShellRuntime,
} from "../src/doctor-runtime-probes.js";
import { OciContainerSandboxAdapter } from "../src/sandbox.js";
import type { ContainerClient } from "../src/sandbox-container-runtime.js";
import { PROCESS_GUARDIAN_SPEC_ENV } from "../src/process-guardian-worker-source.js";
import { bindWorkspaceProcessIo } from "../src/workspace-process-terminal.js";

const IMAGE_ID = `sha256:${"a".repeat(64)}`;
const NODE_SHA256 = "b".repeat(64);
const SHELL_SHA256 = "c".repeat(64);
const REQUESTED_IMAGE = "ghcr.io/example/napier-sandbox:node24";
const temporaryRoots: string[] = [];
const posixIt = process.platform === "win32" ? it.skip : it;

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("OCI image-bound command runtime", () => {
  it("pins a mutable tag and runs Node argv with container runtime identity", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const client = identityClient();
    const { child, environmentFile, spawnProcess } =
      spawnedContainer("v24.16.0\n");
    const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: client,
      spawnProcess: spawnProcess as never,
    });

    const result = await new CommandRunner({ workspaceRoot, sandbox }).run({
      runtime: "node",
      args: ["--version"],
    });

    expect(result).toEqual(
      expect.objectContaining({
        stdout: "v24.16.0\n",
        details: expect.objectContaining({
          status: "succeeded",
          sandbox: "oci-container",
          executableSha256: NODE_SHA256,
          runtimeIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    const dockerArgs = spawnProcess.mock.calls[0]?.[1] as string[];
    expect(dockerArgs).toContain(IMAGE_ID);
    expect(dockerArgs).not.toContain(REQUESTED_IMAGE);
    expect(dockerArgs).not.toContain("--rm");
    expect(dockerArgs.slice(dockerArgs.indexOf(IMAGE_ID))).toEqual([
      IMAGE_ID,
      "/usr/local/bin/node",
      "--version",
    ]);
    expect(dockerArgs.join("\0")).toContain("--network\0none");
    expect(dockerArgs.join("\0")).toContain("--env-file\0");
    expect(dockerArgs.join("\0")).toContain(
      `--mount\0type=bind,source=${workspaceRoot},target=${workspaceRoot},readonly`,
    );
    const containerName = dockerArgs[dockerArgs.indexOf("--name") + 1]!;
    expect(containerName).toMatch(/^napier-[a-f0-9]{32}$/u);
    expect(client).toHaveBeenCalledTimes(3);
    expect(client.mock.calls[0]?.[1]).toEqual([
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      REQUESTED_IMAGE,
    ]);
    expect(client.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(["--network", "none", IMAGE_ID]),
    );
    expect(client.mock.calls[2]?.[1]).toEqual([
      "container",
      "rm",
      "--force",
      containerName,
    ]);
    expect(environmentFile.value).toBe(
      "CI=1\nFORCE_COLOR=0\nLANG=C\nLC_ALL=C\nNO_COLOR=1\n",
    );
    expect(environmentFile.mode).toBe(0o600);
    expect(existsSync(environmentFile.path)).toBe(false);
    const dockerEnvironment = spawnProcess.mock.calls[0]?.[2]?.env;
    expect(dockerEnvironment).not.toHaveProperty("CI");
    expect(dockerEnvironment).not.toHaveProperty("FORCE_COLOR");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("runs the production Shell PTY through a cleanup-bound guardian", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const client = identityClient();
    const { spawnProcess } = spawnedContainer("");
    const terminal = spawnedTerminal("napier_shell_probe_v1");
    const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: client,
      spawnProcess: spawnProcess as never,
      terminalLauncher: terminal.launcher,
    });

    await expect(
      probeShellRuntime(workspaceRoot, undefined, sandbox),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "ready",
        code: "shell_ready",
        evidence: expect.objectContaining({
          adapter: "oci-container",
          productionCall: true,
          pty: true,
        }),
      }),
    );
    expect(spawnProcess).not.toHaveBeenCalled();
    const specification = terminal.specification.value!;
    expect(specification.command).toBe(process.execPath);
    expect(specification.args).toEqual(
      expect.arrayContaining(["--interactive", "--tty", IMAGE_ID]),
    );
    expect(specification.args).not.toContain(REQUESTED_IMAGE);
    const containerName =
      specification.args[specification.args.indexOf("--name") + 1]!;
    expect(specification.cleanup).toEqual(
      expect.objectContaining({
        kind: "oci-container",
        command: process.execPath,
        commandSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        containerName,
      }),
    );
    expect(terminal.resize).not.toHaveBeenCalled();
  });

  it("lets Doctor verify the production Node pipe path against the pinned image", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const client = identityClient();
    const { spawnProcess } = spawnedContainer("napier_process_probe_v1");
    const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: client,
      spawnProcess: spawnProcess as never,
    });

    await expect(
      probeSandboxProcessRuntime(workspaceRoot, undefined, sandbox),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "ready",
        code: "sandbox_process_ready",
        evidence: expect.objectContaining({
          adapter: "oci-container",
          productionCall: true,
          pty: false,
        }),
      }),
    );
    const dockerArgs = spawnProcess.mock.calls[0]?.[1] as string[];
    expect(dockerArgs).toContain(IMAGE_ID);
    expect(dockerArgs).not.toContain(REQUESTED_IMAGE);
  });

  it("fails closed when image inspection does not return an immutable ID", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const client = vi.fn<ContainerClient>(async () => "latest\n");
    const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: client,
    });
    await expect(
      prepareCommandExecution(
        { workspaceRoot, sandbox },
        { runtime: "node", args: ["--version"] },
      ),
    ).rejects.toThrow("immutable ID");
  });

  it("fails closed when a stopped container resource is still present", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const client = identityClient({ cleanupFailure: true });
    const { spawnProcess } = spawnedContainer("v24.16.0\n");
    const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: client,
      spawnProcess: spawnProcess as never,
    });

    await expect(
      new CommandRunner({ workspaceRoot, sandbox }).run({
        runtime: "node",
        args: ["--version"],
      }),
    ).rejects.toThrow("OCI container resource cleanup failed");
    expect(client.mock.calls.at(-1)?.[1]).toEqual(
      expect.arrayContaining([
        "container",
        "ls",
        "--filter",
        expect.stringMatching(/^name=\^\/napier-/u),
      ]),
    );
  });

  posixIt(
    "completes the real host PTY and guardian cleanup path without an external daemon",
    async () => {
      const workspaceRoot = await temporaryWorkspace();
      const fakeRoot = await temporaryWorkspace();
      const cleanupLog = path.join(fakeRoot, "cleanup.log");
      const executable = path.join(fakeRoot, "fake-container-client");
      await writeFile(
        executable,
        [
          "#!/bin/sh",
          'if [ "$1" = "run" ]; then',
          '  printf "napier_shell_probe_v1"',
          "  exit 0",
          "fi",
          'if [ "$1" = "container" ] && [ "$2" = "rm" ]; then',
          `  printf "%s" "$4" > ${JSON.stringify(cleanupLog)}`,
          "  exit 0",
          "fi",
          'if [ "$1" = "container" ] && [ "$2" = "ls" ]; then',
          "  exit 0",
          "fi",
          "exit 64",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
        executable,
        containerClient: identityClient(),
      });

      await expect(
        probeShellRuntime(workspaceRoot, undefined, sandbox),
      ).resolves.toEqual(
        expect.objectContaining({
          status: "ready",
          code: "shell_ready",
          evidence: expect.objectContaining({
            adapter: "oci-container",
            productionCall: true,
            pty: true,
          }),
        }),
      );
      await expect(readFile(cleanupLog, "utf8")).resolves.toMatch(
        /^napier-[a-f0-9]{32}$/u,
      );
    },
    15_000,
  );

  posixIt(
    "forwards PTY resize to the guarded container client process",
    async () => {
      const workspaceRoot = await temporaryWorkspace();
      const fakeRoot = await temporaryWorkspace();
      const cleanupLog = path.join(fakeRoot, "cleanup.log");
      const executable = path.join(fakeRoot, "fake-container-client");
      await writeFile(
        executable,
        [
          "#!/usr/bin/env node",
          'const fs = require("node:fs");',
          'if (process.argv[2] === "container") {',
          `  fs.writeFileSync(${JSON.stringify(cleanupLog)}, process.argv[5]);`,
          "  process.exit(0);",
          "}",
          'if (process.argv[2] !== "run") process.exit(64);',
          "const size = () => `${process.stdout.columns}x${process.stdout.rows}`;",
          "process.stdout.write(`READY:${process.stdout.isTTY}:${size()}`);",
          'process.on("SIGWINCH", () => process.stdout.write(`:SIZE:${size()}`));',
          "setInterval(() => {}, 1000);",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
        executable,
        containerClient: identityClient(),
      });
      const prepared = await prepareCommandExecution(
        { workspaceRoot, sandbox },
        { runtime: "shell", args: ["node --version"] },
      );
      const io = bindWorkspaceProcessIo(prepared, {
        columns: 91,
        rows: 37,
      });
      const child = await sandbox.launch(io.launch);
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
      });
      await vi.waitFor(() => {
        expect(output).toContain("READY:true:91x37");
      });

      await child.resize!(111, 43);
      await vi.waitFor(() => {
        expect(output).toContain("SIZE:111x43");
      });
      await child.terminate();
      await expect(child.exit).resolves.toEqual(
        expect.objectContaining({ code: expect.any(Number) }),
      );
      await expect(readFile(cleanupLog, "utf8")).resolves.toMatch(
        /^napier-[a-f0-9]{32}$/u,
      );
    },
    15_000,
  );
});

function identityClient(options: { cleanupFailure?: boolean } = {}) {
  return vi.fn<ContainerClient>(async (_executable, args) => {
    if (args[0] === "image") return `${IMAGE_ID}\n`;
    if (args[0] === "container") {
      if (options.cleanupFailure && args[1] === "rm") {
        throw new Error("controlled cleanup failure");
      }
      return options.cleanupFailure ? `${"f".repeat(64)}\n` : "";
    }
    return JSON.stringify({
      node: {
        executable: "/usr/local/bin/node",
        executableSha256: NODE_SHA256,
      },
      shell: {
        executable: "/bin/dash",
        executableSha256: SHELL_SHA256,
      },
    });
  });
}

function spawnedTerminal(stdoutText: string) {
  const specification = {
    value: undefined as
      | {
          command: string;
          args: string[];
          cleanup: {
            kind: string;
            command: string;
            commandSha256: string;
            containerName: string;
          };
        }
      | undefined,
  };
  const resize = vi.fn();
  const launcher = vi.fn(async (request) => {
    specification.value = JSON.parse(
      Buffer.from(request.env[PROCESS_GUARDIAN_SPEC_ENV]!, "base64").toString(
        "utf8",
      ),
    );
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const completion = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      setImmediate(() => {
        stdout.end(stdoutText);
        stderr.end();
        resolve({ code: 0, signal: null });
      });
    });
    const exit = completion.finally(() =>
      rm(request.sandboxHome, { recursive: true, force: true }),
    );
    return {
      stdin,
      stdout,
      stderr,
      exit,
      resize,
      terminate: async () => {
        await exit;
      },
    };
  });
  return { launcher, resize, specification };
}

async function temporaryWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-oci-command-"));
  temporaryRoots.push(root);
  return realpath(root);
}

function spawnedContainer(stdoutText: string) {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(emitter, {
    stdin: new PassThrough(),
    stdout,
    stderr,
    pid: 2_147_483_640,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn(() => true),
  }) as unknown as ChildProcessWithoutNullStreams;
  const environmentFile = { mode: 0, path: "", value: "" };
  const spawnProcess = vi.fn((_command, args: string[]) => {
    const environmentFileIndex = args.indexOf("--env-file");
    environmentFile.path = args[environmentFileIndex + 1]!;
    environmentFile.value = readFileSync(environmentFile.path, "utf8");
    environmentFile.mode = statSync(environmentFile.path).mode & 0o777;
    queueMicrotask(() => {
      emitter.emit("spawn");
      setImmediate(() => {
        stdout.end(stdoutText);
        stderr.end();
        child.exitCode = 0;
        emitter.emit("exit", 0, null);
      });
    });
    return child;
  });
  return { child, environmentFile, spawnProcess };
}
