import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server, type Socket } from "node:net";

import type { SandboxedProcess } from "./sandbox-types.js";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertContainerImageIdentityStable,
  type ContainerClient,
  type ContainerImageIdentity,
  type ContainerUserIds,
  runContainerClient,
  validateOciContainerName,
} from "./sandbox-container-runtime.js";
import { containerClientEnvironment } from "./sandbox-container.js";
import { waitForLoopbackHttpService } from "./sandbox-local-service-health.js";
import { validateSandboxLocalServiceRequest } from "./sandbox-local-service-policy.js";
import type {
  SandboxLocalServiceBinding,
  SandboxLocalServiceRequest,
} from "./sandbox-types.js";

const NETWORK_ID = /^[a-f0-9]{12,64}$/u;
const NETWORK_NAME = /^napier-network-[a-f0-9]{32}$/u;
const MAX_PROXY_CONNECTIONS = 32;
const PROXY_SOURCE = String.raw`
const net = require("node:net");
const port = Number(process.argv[1]);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) process.exit(64);
const socket = net.connect({ host: "127.0.0.1", port });
socket.once("error", () => process.exit(65));
process.stdin.pipe(socket);
socket.pipe(process.stdout);
`;

export interface ContainerLocalServiceProjection {
  binding: SandboxLocalServiceBinding;
  close(): Promise<void>;
}

export interface ContainerHostProjection {
  hostPort: number;
  close(): Promise<void>;
}

export async function createContainerServiceNetwork(
  identity: ContainerImageIdentity,
  networkName: string,
  client: ContainerClient = runContainerClient,
  injectedUserIds?: ContainerUserIds,
  injectedDaemonEndpoint?: string,
): Promise<void> {
  validateContainerServiceNetworkName(networkName);
  await assertContainerImageIdentityStable(
    identity,
    client,
    injectedUserIds,
    injectedDaemonEndpoint,
  );
  const networkId = (
    await client(identity.clientExecutable, [
      "network",
      "create",
      "--driver",
      "bridge",
      "--internal",
      "--label",
      "io.napier.resource=workspace-process",
      networkName,
    ])
  ).trim();
  if (!NETWORK_ID.test(networkId)) {
    throw new Error("OCI local service internal network creation failed");
  }
}

export async function resolveContainerLocalService(input: {
  identity: ContainerImageIdentity;
  containerName: string;
  networkName: string;
  nodeExecutable: string;
  service: SandboxLocalServiceRequest;
  child: SandboxedProcess;
  client?: ContainerClient;
  injectedUserIds?: ContainerUserIds;
  injectedDaemonEndpoint?: string;
  signal?: AbortSignal;
  createProjection?: typeof createHostProjection;
}): Promise<ContainerLocalServiceProjection> {
  const client = input.client ?? runContainerClient;
  validateOciContainerName(input.containerName);
  validateContainerServiceNetworkName(input.networkName);
  validateSandboxLocalServiceRequest(input.service);
  await assertContainerImageIdentityStable(
    input.identity,
    client,
    input.injectedUserIds,
    input.injectedDaemonEndpoint,
  );
  const projection = await (input.createProjection ?? createHostProjection)(
    input,
  );
  const hostPort = projection.hostPort;
  try {
    await waitForLoopbackHttpService({
      hostPort,
      service: input.service,
      exit: input.child.exit,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    await projection.close();
    throw error;
  }
  const readyAt = new Date().toISOString();
  const healthPathSha256 = sha256(input.service.healthPath);
  return {
    binding: {
      protocol: "http",
      containerPort: input.service.containerPort,
      host: "127.0.0.1",
      hostPort,
      url: `http://127.0.0.1:${String(hostPort)}/`,
      healthPathSha256,
      identitySha256: sha256(
        canonicalJson({
          kind: "napier.oci-local-service-identity",
          imageIdentitySha256: input.identity.identitySha256,
          containerNameSha256: sha256(input.containerName),
          networkNameSha256: sha256(input.networkName),
          protocol: input.service.protocol,
          containerPort: input.service.containerPort,
          host: "127.0.0.1",
          hostPort,
          projection: "managed_docker_exec",
          outboundNetwork: "denied_internal_network",
        }),
      ),
      readyAt,
    },
    close: projection.close,
  };
}

export function validateContainerServiceNetworkName(value: string): void {
  if (!NETWORK_NAME.test(value)) {
    throw new Error("OCI local service network identity is invalid");
  }
}

export async function createHostProjection(input: {
  identity: ContainerImageIdentity;
  containerName: string;
  nodeExecutable: string;
  service: SandboxLocalServiceRequest;
}): Promise<ContainerHostProjection> {
  const sockets = new Set<Socket>();
  const proxies = new Set<ChildProcessWithoutNullStreams>();
  let closing = false;
  const server = createServer((socket) => {
    if (closing || sockets.size >= MAX_PROXY_CONNECTIONS) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    const proxy = spawn(
      input.identity.clientExecutable,
      [
        "exec",
        "--interactive",
        "--user",
        `${String(input.identity.user.userId)}:${String(input.identity.user.groupId)}`,
        input.containerName,
        input.nodeExecutable,
        "-e",
        PROXY_SOURCE,
        String(input.service.containerPort),
      ],
      {
        cwd: "/",
        env: containerClientEnvironment(),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    proxies.add(proxy);
    socket.pipe(proxy.stdin);
    proxy.stdout.pipe(socket);
    proxy.stderr.resume();
    const settle = (): void => {
      sockets.delete(socket);
      proxies.delete(proxy);
      socket.destroy();
      proxy.kill("SIGKILL");
    };
    socket.once("close", settle);
    socket.once("error", settle);
    proxy.once("close", settle);
    proxy.once("error", settle);
  });
  try {
    const hostPort = await listenOnLoopback(server);
    return {
      hostPort,
      close: async () => {
        if (closing) return;
        closing = true;
        for (const socket of sockets) socket.destroy();
        for (const proxy of proxies) proxy.kill("SIGKILL");
        await closeServer(server);
      },
    };
  } catch (error) {
    await closeServer(server).catch(() => undefined);
    throw error;
  }
}

function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error): void => reject(error);
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", fail);
      const address = server.address();
      if (!address || typeof address === "string" || address.port < 1_024) {
        reject(new Error("OCI local service loopback projection failed"));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
