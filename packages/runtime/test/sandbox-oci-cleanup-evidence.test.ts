import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ExecutionResourceLaunchError } from "../src/execution-resource-admission.js";
import { OciContainerSandboxAdapter } from "../src/sandbox-oci.js";
import type { ContainerClient } from "../src/sandbox-container-runtime.js";
import type { SandboxLaunchRequest } from "../src/sandbox-types.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("OCI Sandbox cleanup evidence", () => {
  it("retains unknown dispatch despite successful named container compensation", async () => {
    const client = fixtureClient(false);
    const adapter = adapterWith(client, async () => {
      throw new Error("terminal launch response lost");
    });
    const error = await adapter
      .launch(await request())
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ExecutionResourceLaunchError);
    expect(error).toMatchObject({
      cleanup: { status: "unknown", scope: "sandbox_execution" },
      resourceIdentity: {
        resourceId: expect.stringMatching(/^napier-[a-f0-9]{32}$/),
      },
    });
    expect(
      client.mock.calls.some(
        ([, args]) => args[0] === "container" && args[1] === "rm",
      ),
    ).toBe(true);
  });

  it("does not preserve no-start classification when owned OCI cleanup fails", async () => {
    const client = fixtureClient(true);
    const adapter = adapterWith(client, async () => {
      throw new ExecutionResourceLaunchError("target rejected", {
        status: "not_started",
        scope: "sandbox_execution",
        reason: "fixture_target_not_started",
      });
    });
    const error = await adapter
      .launch(await request())
      .catch((error: unknown) => error);
    expect(error).toMatchObject({
      cleanup: { status: "unknown", reason: "oci_launch_cleanup_failed" },
    });
    expect(
      client.mock.calls.some(
        ([, args]) => args[0] === "container" && args[1] === "ls",
      ),
    ).toBe(true);
  });

  it("preserves no-start only after named OCI compensation succeeds", async () => {
    const client = fixtureClient(false);
    const adapter = adapterWith(client, async () => {
      throw new ExecutionResourceLaunchError("target rejected", {
        status: "not_started",
        scope: "sandbox_execution",
        reason: "fixture_target_not_started",
      });
    });
    const error = await adapter
      .launch(await request())
      .catch((error: unknown) => error);
    expect(error).toMatchObject({
      cleanup: { status: "not_started", reason: "fixture_target_not_started" },
    });
  });
});

function fixtureClient(cleanupFails: boolean) {
  return vi.fn<ContainerClient>(async (_executable, args) => {
    if (args[0] === "image") return `sha256:${"a".repeat(64)}\tlinux\tarm64\n`;
    if (args[0] === "container" && args[1] === "rm") {
      if (cleanupFails) throw new Error("injected removal failure");
      return "";
    }
    if (args[0] === "container" && args[1] === "ls") return "still-present\n";
    throw new Error("Unexpected fixture container call");
  });
}

function adapterWith(
  client: ContainerClient,
  terminalLauncher: () => Promise<never>,
) {
  return new OciContainerSandboxAdapter(
    "ghcr.io/example/napier-sandbox:node24",
    {
      executable: process.execPath,
      containerClient: client,
      terminalLauncher,
      userIds: { userId: 501, groupId: 20 },
      daemonEndpoint: "unix:///controlled/docker.sock",
    },
  );
}

async function request(): Promise<SandboxLaunchRequest> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-oci-cleanup-"));
  roots.push(root);
  return {
    command: process.execPath,
    args: ["--eval", "void 0"],
    cwd: root,
    env: {},
    workspaceRoot: root,
    approvedCapabilities: ["process.spawn"],
    terminal: { columns: 80, rows: 24 },
  };
}
