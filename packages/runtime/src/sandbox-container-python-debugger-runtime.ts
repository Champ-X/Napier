import path from "node:path";
import { randomBytes } from "node:crypto";
import { canonicalJson, sha256 } from "./ed25519.js";
import { PYTHON_DEBUGGER_PROBE_SOURCE } from "./python-debugger-probe-source.js";
import {
  probeContainerRuntimeIdentity,
  removeContainerResource,
  runContainerClient,
  type ContainerClient,
  type ContainerImageIdentity,
  type ContainerUserIds,
} from "./sandbox-container-runtime.js";
import type { SandboxPythonDebuggerRuntimeBinding } from "./sandbox-types.js";

export async function resolveContainerPythonDebuggerRuntime(
  identity: ContainerImageIdentity,
  client: ContainerClient = runContainerClient,
  userIds?: ContainerUserIds,
  daemonEndpoint?: string,
): Promise<SandboxPythonDebuggerRuntimeBinding> {
  const observed = await probeContainerRuntimeIdentity(
    identity,
    client,
    userIds,
    daemonEndpoint,
  );
  if (!observed.python)
    throw new Error("OCI image-bound Python runtime is unavailable");
  const containerName = `napier-${randomBytes(16).toString("hex")}`;
  let output: string;
  try {
    output = await client(identity.clientExecutable, [
      "run",
      "--rm",
      "--name",
      containerName,
      "--platform",
      identity.imagePlatform,
      "--network",
      "none",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--user",
      `${identity.user.userId}:${identity.user.groupId}`,
      "--pids-limit",
      "32",
      "--memory",
      "256m",
      "--memory-swap",
      "256m",
      "--cpus",
      "2",
      "--entrypoint",
      observed.python.executable,
      identity.imageId,
      "-I",
      "-B",
      "-c",
      PYTHON_DEBUGGER_PROBE_SOURCE,
    ]);
  } finally {
    // A killed Docker client does not prove its container stopped.
    await removeContainerResource(
      identity,
      containerName,
      client,
      userIds,
      daemonEndpoint,
    );
  }
  const probe: unknown = JSON.parse(output);
  if (!probe || typeof probe !== "object" || Array.isArray(probe))
    throw new Error("OCI Python debugger identity is invalid");
  const p = probe as Record<string, unknown>;
  if (
    p.executable !== observed.python.executable ||
    p.executableSha256 !== observed.python.executableSha256 ||
    p.pythonVersion !== observed.python.version ||
    p.loopback !== true ||
    typeof p.debugpyRoot !== "string" ||
    !path.posix.isAbsolute(p.debugpyRoot) ||
    /[\u0000-\u001f\u007f]/u.test(p.debugpyRoot) ||
    typeof p.debugpyVersion !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}$/u.test(p.debugpyVersion) ||
    typeof p.packageSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(p.packageSha256)
  )
    throw new Error(
      "OCI Python debugger identity differs from the image runtime",
    );
  const content = {
    runtime: "python-debugger" as const,
    isolation: "oci" as const,
    executable: observed.python.executable,
    executableSha256: observed.python.executableSha256,
    pythonVersion: observed.python.version,
    debugpyRoot: p.debugpyRoot,
    debugpyVersion: p.debugpyVersion,
    packageSha256: p.packageSha256,
    ...(identity.user.mapping === "portable-non-posix"
      ? { protocolWorkspaceRoot: "/workspace" }
      : {}),
  };
  return {
    ...content,
    runtimeIdentitySha256: sha256(
      canonicalJson({
        kind: "napier.oci-python-debugger-runtime-identity",
        imageIdentitySha256: identity.identitySha256,
        probeSha256: sha256(PYTHON_DEBUGGER_PROBE_SOURCE),
        transport: "container-loopback",
        ...content,
      }),
    ),
  };
}
