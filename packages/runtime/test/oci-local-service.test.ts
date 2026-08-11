import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createContainerServiceNetwork,
  resolveContainerLocalService,
} from "../src/sandbox-container-service.js";
import {
  resolveContainerImageIdentity,
  type ContainerClient,
} from "../src/sandbox-container-runtime.js";
import { HostDirectSandboxAdapter } from "../src/sandbox-host-direct.js";
import { validateLaunchRequest } from "../src/sandbox-launch-policy.js";
import { waitForLoopbackHttpServiceClosed } from "../src/sandbox-local-service-health.js";
import {
  buildOciContainerArgs,
  OciContainerSandboxAdapter,
} from "../src/sandbox-oci.js";
import type {
  SandboxedProcess,
  SandboxLaunchRequest,
} from "../src/sandbox-types.js";

const IMAGE = "ghcr.io/example/napier-sandbox:node24";
const IMAGE_ID = `sha256:${"a".repeat(64)}`;
const USER_IDS = { userId: 501, groupId: 20 } as const;
const DAEMON_ENDPOINT = "unix:///controlled/docker.sock";
const NETWORK_NAME = `napier-network-${"b".repeat(32)}`;
const CONTAINER_NAME = `napier-${"c".repeat(32)}`;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("OCI local service policy", () => {
  it("keeps a local service on an internal network without Docker port publishing", async () => {
    const request = await serviceRequest();
    const args = buildOciContainerArgs(
      request,
      await temporaryRoot(),
      IMAGE_ID,
      CONTAINER_NAME,
      {
        ...USER_IDS,
        mapping: "injected",
        identitySha256: "d".repeat(64),
      },
      NETWORK_NAME,
    );

    expect(args).toEqual(
      expect.arrayContaining(["--network", NETWORK_NAME, "--read-only"]),
    );
    expect(args).not.toContain("bridge");
    expect(args).not.toContain("none");
    expect(args).not.toContain("--publish");
  });

  it("rejects privileged ports, cross-origin health paths, outbound access, and PTY mode", async () => {
    const request = await serviceRequest();
    expect(() =>
      validateLaunchRequest({
        ...request,
        localService: { ...request.localService!, containerPort: 80 },
      }),
    ).toThrow("Local service request is invalid");
    expect(() =>
      validateLaunchRequest({
        ...request,
        localService: {
          ...request.localService!,
          healthPath: "//external.example/ready",
        },
      }),
    ).toThrow("health path is invalid");
    expect(() =>
      validateLaunchRequest({
        ...request,
        approvedCapabilities: [
          ...request.approvedCapabilities,
          "network.connect",
        ],
      }),
    ).toThrow("cannot combine listening with outbound network access");
    expect(() =>
      validateLaunchRequest({
        ...request,
        terminal: { columns: 80, rows: 24 },
      }),
    ).toThrow("cannot use terminal PTY mode");
  });

  it("fails closed on a non-container provider", async () => {
    await expect(
      new HostDirectSandboxAdapter().launch(await serviceRequest()),
    ).rejects.toThrow("cannot provide an egress-denied loopback local service");
  });

  it("creates an internal network and returns only a health-verified loopback binding", async () => {
    const server = createServer((request, response) => {
      response.statusCode = request.url === "/ready" ? 204 : 404;
      response.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing port");
    const calls: string[][] = [];
    const client = vi.fn<ContainerClient>(async (_executable, args) => {
      calls.push(args);
      if (args[0] === "image") return `${IMAGE_ID}\tlinux\tarm64\n`;
      if (args[0] === "network") return `${"e".repeat(64)}\n`;
      throw new Error("unexpected container call");
    });
    try {
      const identity = await resolveContainerImageIdentity(
        IMAGE,
        process.execPath,
        client,
        USER_IDS,
        DAEMON_ENDPOINT,
      );
      await createContainerServiceNetwork(
        identity,
        NETWORK_NAME,
        client,
        USER_IDS,
        DAEMON_ENDPOINT,
      );
      let projectionClosed = false;
      const service = await resolveContainerLocalService({
        identity,
        containerName: CONTAINER_NAME,
        networkName: NETWORK_NAME,
        nodeExecutable: process.execPath,
        service: {
          protocol: "http",
          containerPort: 31_879,
          healthPath: "/ready",
        },
        child: pendingChild(),
        client,
        injectedUserIds: USER_IDS,
        injectedDaemonEndpoint: DAEMON_ENDPOINT,
        createProjection: async () => ({
          hostPort: address.port,
          close: async () => {
            projectionClosed = true;
          },
        }),
      });

      expect(calls).toContainEqual([
        "network",
        "create",
        "--driver",
        "bridge",
        "--internal",
        "--label",
        "io.napier.resource=workspace-process",
        NETWORK_NAME,
      ]);
      expect(service.binding).toEqual(
        expect.objectContaining({
          protocol: "http",
          containerPort: 31_879,
          host: "127.0.0.1",
          hostPort: address.port,
          url: `http://127.0.0.1:${String(address.port)}/`,
          healthPathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          identitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          readyAt: expect.any(String),
        }),
      );
      expect(JSON.stringify(service.binding)).not.toContain("/ready");
      expect(JSON.stringify(service.binding)).not.toContain(NETWORK_NAME);
      expect(JSON.stringify(service.binding)).not.toContain(CONTAINER_NAME);
      await service.close();
      expect(projectionClosed).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("runs a real HTTP child through the OCI lifecycle and cleans up its container and network", async () => {
    const workspaceRoot = await temporaryRoot();
    const hostPort = await availableLoopbackPort();
    const calls: string[][] = [];
    const client = vi.fn<ContainerClient>(async (_executable, args) => {
      calls.push([...args]);
      if (args[0] === "image") return `${IMAGE_ID}\tlinux\tarm64\n`;
      if (args[0] === "network" && args[1] === "create") {
        return `${"e".repeat(64)}\n`;
      }
      if (
        (args[0] === "container" && args[1] === "rm") ||
        (args[0] === "network" && args[1] === "rm")
      ) {
        return "";
      }
      throw new Error(`unexpected container call: ${args.join(" ")}`);
    });
    const spawnProcess = vi.fn(() =>
      spawn(
        process.execPath,
        [
          "-e",
          `require("node:http").createServer((request,response)=>{response.statusCode=request.url==="/ready"?200:404;response.end("oci-service-ok")}).listen(${String(hostPort)},"127.0.0.1")`,
        ],
        {
          cwd: workspaceRoot,
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      ),
    );
    const sandbox = new OciContainerSandboxAdapter(IMAGE, {
      executable: process.execPath,
      containerClient: client,
      spawnProcess: spawnProcess as never,
      userIds: USER_IDS,
      daemonEndpoint: DAEMON_ENDPOINT,
      createLocalServiceProjection: async () => ({
        hostPort,
        close: async () => undefined,
      }),
    });

    const child = await sandbox.launch({
      command: "/usr/local/bin/node",
      args: ["server.mjs"],
      cwd: workspaceRoot,
      env: {},
      workspaceRoot,
      approvedCapabilities: [
        "process.spawn",
        "workspace.read",
        "network.listen",
      ],
      localService: {
        protocol: "http",
        containerPort: 31_879,
        healthPath: "/ready",
      },
    });
    expect(child.localService).toEqual(
      expect.objectContaining({
        host: "127.0.0.1",
        hostPort,
        url: `http://127.0.0.1:${String(hostPort)}/`,
      }),
    );
    await expect(
      fetch(`http://127.0.0.1:${String(hostPort)}/ready`).then((response) =>
        response.text(),
      ),
    ).resolves.toBe("oci-service-ok");
    const dockerArgs = spawnProcess.mock.calls[0]?.[1] as string[] | undefined;
    expect(dockerArgs).toEqual(
      expect.arrayContaining([
        "--network",
        expect.stringMatching(/^napier-network-[a-f0-9]{32}$/u),
        "--read-only",
      ]),
    );
    expect(dockerArgs).not.toContain("--publish");

    await child.terminate();
    await waitForLoopbackHttpServiceClosed(hostPort);
    const containerName = dockerArgs![dockerArgs!.indexOf("--name") + 1]!;
    const networkName = dockerArgs![dockerArgs!.indexOf("--network") + 1]!;
    expect(calls).toContainEqual(["container", "rm", "--force", containerName]);
    expect(calls).toContainEqual(["network", "rm", networkName]);
  }, 15_000);
});

async function serviceRequest(): Promise<SandboxLaunchRequest> {
  const workspaceRoot = await temporaryRoot();
  return {
    command: process.execPath,
    args: ["server.mjs"],
    cwd: workspaceRoot,
    env: {},
    workspaceRoot,
    approvedCapabilities: ["process.spawn", "workspace.read", "network.listen"],
    localService: {
      protocol: "http",
      containerPort: 31_879,
      healthPath: "/ready",
    },
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-oci-service-"));
  temporaryRoots.push(root);
  return root;
}

function pendingChild(): SandboxedProcess {
  return {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exit: new Promise(() => undefined),
    terminate: async () => undefined,
  };
}

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
