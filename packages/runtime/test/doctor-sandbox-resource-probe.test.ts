import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import {
  probeSandboxResourceRuntime,
  validateSandboxResourceObservation,
} from "../src/doctor-sandbox-resource-probe.js";
import {
  OCI_PROCESS_RESOURCE_POLICY,
  OCI_PROCESS_RESOURCE_POLICY_SHA256,
} from "../src/sandbox-container-policy.js";
import type {
  OsSandboxAdapter,
  SandboxedProcess,
  SandboxLaunchRequest,
} from "../src/sandbox-types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Sandbox resource Doctor probe", () => {
  it("accepts an exact dynamic OCI resource observation", () => {
    expect(
      validateSandboxResourceObservation(JSON.stringify(observation())),
    ).toEqual(
      expect.objectContaining({
        cgroupVersion: 2,
        pidsMax: 256,
        memoryMaxBytes: 1_073_741_824,
        memorySwapMaxBytes: 0,
        rootReadOnly: true,
        workspaceReadOnly: true,
        networkInterfaceCount: 1,
        resourcePolicySha256: OCI_PROCESS_RESOURCE_POLICY_SHA256,
      }),
    );
  });

  it("rejects expanded memory, swap, storage, network, or privilege authority", () => {
    for (const drift of [
      { memoryMaxBytes: 2_147_483_648 },
      { memorySwapMaxBytes: 1_073_741_824 },
      { temporaryFileSystemBytes: 134_217_728 },
      { networkInterfaces: ["eth0", "lo"] },
      { noNewPrivileges: false },
      { capabilitiesDropped: false },
    ]) {
      expect(() =>
        validateSandboxResourceObservation(
          JSON.stringify({ ...observation(), ...drift }),
        ),
      ).toThrow("does not match policy");
    }
  });

  it("executes through the production command path and returns bounded evidence", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const sandbox = new ResourceSandbox(observation());

    await expect(
      probeSandboxResourceRuntime(workspaceRoot, undefined, sandbox),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "ready",
        code: "sandbox_resources_ready",
        evidence: expect.objectContaining({
          adapter: "oci-container",
          productionCall: true,
          resourcePolicySha256: OCI_PROCESS_RESOURCE_POLICY_SHA256,
          probeSourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          commandSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          memorySwapMaxBytes: 0,
        }),
      }),
    );
    expect(sandbox.launchRequest).toEqual(
      expect.objectContaining({
        command: "/usr/local/bin/node",
        args: ["-"],
        stdinMode: "open",
        workspaceRoot,
        approvedCapabilities: ["process.spawn", "workspace.read"],
      }),
    );
    expect(sandbox.probeSource).toContain("/sys/fs/cgroup/memory.max");
    expect(sandbox.probeSource).not.toContain(workspaceRoot);
  });

  it("fails closed when the active provider cannot prove the exact limits", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const sandbox = new ResourceSandbox({
      ...observation(),
      memorySwapMaxBytes: OCI_PROCESS_RESOURCE_POLICY.memoryMaxBytes,
    });

    await expect(
      probeSandboxResourceRuntime(workspaceRoot, undefined, sandbox),
    ).resolves.toEqual({
      status: "unavailable",
      code: "sandbox_resources_unavailable",
      message: expect.stringContaining("resource-sensitive tasks fail closed"),
    });
  });
});

class ResourceSandbox implements OsSandboxAdapter {
  readonly id = "oci-container";
  launchRequest: SandboxLaunchRequest | undefined;
  probeSource = "";

  constructor(private readonly result: Record<string, unknown>) {}

  async resolveCommandRuntime() {
    return {
      runtime: "node" as const,
      executable: "/usr/local/bin/node",
      executableSha256: "a".repeat(64),
      runtimeIdentitySha256: "b".repeat(64),
    };
  }

  async launch(request: SandboxLaunchRequest): Promise<SandboxedProcess> {
    this.launchRequest = request;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const exit = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk: string) => {
        this.probeSource += chunk;
      });
      stdin.once("end", () => {
        stdout.end(JSON.stringify(this.result));
        stderr.end();
        resolve({ code: 0, signal: null });
      });
    });
    return {
      stdin,
      stdout,
      stderr,
      exit,
      terminate: async () => {
        stdin.end();
      },
    };
  }
}

function observation(): Record<string, unknown> {
  return {
    cgroupVersion: 2,
    pidsMax: OCI_PROCESS_RESOURCE_POLICY.pidsMax,
    memoryMaxBytes: OCI_PROCESS_RESOURCE_POLICY.memoryMaxBytes,
    memorySwapMaxBytes: OCI_PROCESS_RESOURCE_POLICY.memorySwapMaxBytes,
    cpuQuotaMicros: 200_000,
    cpuPeriodMicros: 100_000,
    rootReadOnly: true,
    workspaceReadOnly: true,
    temporaryFileSystemBytes:
      OCI_PROCESS_RESOURCE_POLICY.temporaryFileSystemBytes,
    homeFileSystemBytes:
      OCI_PROCESS_RESOURCE_POLICY.temporaryFileSystemBytes,
    temporaryFileSystemRestricted: true,
    homeFileSystemRestricted: true,
    capabilitiesDropped: true,
    noNewPrivileges: true,
    networkInterfaces: ["lo"],
  };
}

async function temporaryWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-resource-probe-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  return realpath(workspace);
}
