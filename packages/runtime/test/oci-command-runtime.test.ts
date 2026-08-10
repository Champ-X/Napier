import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
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

const IMAGE_ID = `sha256:${"a".repeat(64)}`;
const NODE_SHA256 = "b".repeat(64);
const SHELL_SHA256 = "c".repeat(64);
const REQUESTED_IMAGE = "ghcr.io/example/napier-sandbox:node24";
const temporaryRoots: string[] = [];

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
    expect(client).toHaveBeenCalledTimes(2);
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

  it("keeps Shell unavailable until OCI PTY and parent-death handling exist", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const client = identityClient();
    const { spawnProcess } = spawnedContainer("");
    const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: client,
      spawnProcess: spawnProcess as never,
    });

    await expect(
      probeShellRuntime(workspaceRoot, undefined, sandbox),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "unavailable",
        code: "shell_provider_incompatible",
      }),
    );
    expect(spawnProcess).not.toHaveBeenCalled();
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
});

function identityClient() {
  return vi.fn<ContainerClient>(async (_executable, args) => {
    if (args[0] === "image") return `${IMAGE_ID}\n`;
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
