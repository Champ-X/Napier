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
import { waitForLoopbackHttpService } from "./sandbox-local-service-health.js";
import { validateSandboxLocalServiceRequest } from "./sandbox-local-service-policy.js";
import type {
  SandboxLocalServiceBinding,
  SandboxLocalServiceRequest,
} from "./sandbox-types.js";

const NETWORK_ID = /^[a-f0-9]{12,64}$/u;
const NETWORK_NAME = /^napier-network-[a-f0-9]{32}$/u;
const LOOPBACK_MAPPING = /^127\.0\.0\.1:(\d{1,5})$/u;
const PORT_MAPPING_TIMEOUT_MS = 5_000;
const PORT_MAPPING_RETRY_MS = 50;

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
  service: SandboxLocalServiceRequest;
  child: SandboxedProcess;
  client?: ContainerClient;
  injectedUserIds?: ContainerUserIds;
  injectedDaemonEndpoint?: string;
  signal?: AbortSignal;
}): Promise<SandboxLocalServiceBinding> {
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
  const hostPort = await resolveLoopbackPort({ ...input, client });
  await waitForLoopbackHttpService({
    hostPort,
    service: input.service,
    exit: input.child.exit,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const readyAt = new Date().toISOString();
  const healthPathSha256 = sha256(input.service.healthPath);
  return {
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
        healthPathSha256,
        outboundNetwork: "denied_internal_network",
      }),
    ),
    readyAt,
  };
}

export function validateContainerServiceNetworkName(value: string): void {
  if (!NETWORK_NAME.test(value)) {
    throw new Error("OCI local service network identity is invalid");
  }
}

async function resolveLoopbackPort(input: {
  identity: ContainerImageIdentity;
  containerName: string;
  service: SandboxLocalServiceRequest;
  child: SandboxedProcess;
  client: ContainerClient;
  signal?: AbortSignal;
}): Promise<number> {
  const deadline = Date.now() + PORT_MAPPING_TIMEOUT_MS;
  while (Date.now() < deadline) {
    input.signal?.throwIfAborted();
    const outcome = await Promise.race([
      input
        .client(input.identity.clientExecutable, [
          "container",
          "port",
          input.containerName,
          `${String(input.service.containerPort)}/tcp`,
        ])
        .then(
          (value) => ({ type: "mapping" as const, value }),
          () => ({ type: "retry" as const }),
        ),
      input.child.exit.then(() => ({ type: "exited" as const })),
    ]);
    if (outcome.type === "exited") {
      throw new Error("Local service process exited before port projection");
    }
    if (outcome.type === "mapping") {
      const port = parseLoopbackPort(outcome.value);
      if (port !== undefined) return port;
    }
    await new Promise((resolve) => setTimeout(resolve, PORT_MAPPING_RETRY_MS));
  }
  throw new Error("OCI local service port projection timed out");
}

function parseLoopbackPort(output: string): number | undefined {
  const match = LOOPBACK_MAPPING.exec(output.trim());
  const port = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(port) && port >= 1_024 && port <= 65_535
    ? port
    : undefined;
}
