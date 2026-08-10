import { realpath } from "node:fs/promises";
import path from "node:path";

import { resolveCommandRuntimeBinding } from "./command-runtime.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  NODE_DEBUGGER_RUNTIME_PROBE_ARGUMENTS,
  NODE_DEBUGGER_RUNTIME_PROBE_MARKER,
} from "./node-debugger-runtime-probe-source.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import type { SandboxNodeDebuggerRuntimeBinding } from "./sandbox-types.js";
import { runSandboxedProcess } from "./sandboxed-process.js";

export const NODE_DEBUGGER_RUNTIME_PROBE_TIMEOUT_MS = 3_500;
export const NODE_DEBUGGER_RUNTIME_PROBE_MAX_OUTPUT_CHARS = 2_048;

const FIXED_ENVIRONMENT = {
  CI: "1",
  FORCE_COLOR: "0",
  LANG: "C",
  LC_ALL: "C",
  NO_COLOR: "1",
} as const;
const SHA256 = /^[a-f0-9]{64}$/u;

export interface NodeDebuggerRuntimeIdentity {
  location: "host" | "provider";
  sandbox: string;
  nodeExecutable: string;
  nodeExecutableSha256: string;
  nodeVersion: string;
  runtimeIdentitySha256: string;
}

export interface NodeDebuggerRuntimeResolutionOptions {
  sandbox: OsSandboxAdapter;
  workspaceRoot: string;
  nodeExecutable?: string;
  runtimeReadPaths?: readonly string[];
  signal?: AbortSignal;
}

/** Resolves and actively proves the Node runtime used by the production DAP adapter. */
export async function resolveNodeDebuggerRuntime(
  options: NodeDebuggerRuntimeResolutionOptions,
): Promise<NodeDebuggerRuntimeIdentity> {
  const provider = await options.sandbox.resolveNodeDebuggerRuntime?.();
  if (provider) {
    validateProviderBinding(provider);
    if (
      options.nodeExecutable !== undefined ||
      (options.runtimeReadPaths?.length ?? 0) > 0
    ) {
      throw new Error(
        "Image-bound Node debugger runtime does not accept host asset overrides",
      );
    }
    return {
      location: "provider",
      sandbox: options.sandbox.id,
      ...providerIdentity(provider),
    };
  }
  if (options.sandbox.id === "oci-container") {
    throw new Error(
      "OCI image-bound Node debugger runtime identity is unavailable",
    );
  }

  const workspaceRoot = await realpath(options.workspaceRoot);
  const binding = await resolveCommandRuntimeBinding("node", {
    ...(options.nodeExecutable ? { node: options.nodeExecutable } : {}),
  });
  const result = await runSandboxedProcess({
    sandbox: options.sandbox,
    launch: {
      command: binding.executable,
      args: [...NODE_DEBUGGER_RUNTIME_PROBE_ARGUMENTS],
      cwd: workspaceRoot,
      env: { ...FIXED_ENVIRONMENT },
      workspaceRoot,
      approvedCapabilities: ["process.spawn", "workspace.read"],
      ...((options.runtimeReadPaths?.length ?? 0) > 0
        ? { runtimeReadPaths: [...options.runtimeReadPaths!] }
        : {}),
    },
    timeoutMs: NODE_DEBUGGER_RUNTIME_PROBE_TIMEOUT_MS,
    maxOutputChars: NODE_DEBUGGER_RUNTIME_PROBE_MAX_OUTPUT_CHARS,
    ...(options.signal ? { signal: options.signal } : {}),
    abortedMessage: "Node debugger runtime probe was aborted",
  });
  if (
    result.status !== "exited" ||
    result.exitCode !== 0 ||
    result.stderr !== ""
  ) {
    throw new Error("Node debugger runtime production probe failed");
  }
  const observed = parseProbeOutput(result.stdout);
  return {
    location: "host",
    sandbox: options.sandbox.id,
    nodeExecutable: binding.executable,
    nodeExecutableSha256: binding.executableSha256,
    nodeVersion: observed.nodeVersion,
    runtimeIdentitySha256: sha256(
      canonicalJson({
        kind: "napier.host-node-debugger-runtime-identity",
        sandbox: options.sandbox.id,
        nodeExecutable: binding.executable,
        nodeExecutableSha256: binding.executableSha256,
        nodeVersion: observed.nodeVersion,
        inspectorWorkerProbe: true,
      }),
    ),
  };
}

export async function assertNodeDebuggerRuntimeStable(
  expected: NodeDebuggerRuntimeIdentity,
  options: NodeDebuggerRuntimeResolutionOptions,
  label: string,
): Promise<void> {
  const current = await resolveNodeDebuggerRuntime(options);
  if (
    current.location !== expected.location ||
    current.sandbox !== expected.sandbox ||
    current.nodeExecutable !== expected.nodeExecutable ||
    current.nodeExecutableSha256 !== expected.nodeExecutableSha256 ||
    current.nodeVersion !== expected.nodeVersion ||
    current.runtimeIdentitySha256 !== expected.runtimeIdentitySha256
  ) {
    throw new Error(`${label} runtime identity changed`);
  }
}

export function nodeDebuggerRuntimeLimitEvidence(): {
  probeTimeoutMs: number;
  probeOutputLimitChars: number;
  inspectorWorkerProbe: true;
} {
  return {
    probeTimeoutMs: NODE_DEBUGGER_RUNTIME_PROBE_TIMEOUT_MS,
    probeOutputLimitChars: NODE_DEBUGGER_RUNTIME_PROBE_MAX_OUTPUT_CHARS,
    inspectorWorkerProbe: true,
  };
}

function providerIdentity(
  binding: SandboxNodeDebuggerRuntimeBinding,
): Omit<NodeDebuggerRuntimeIdentity, "location" | "sandbox"> {
  return {
    nodeExecutable: binding.nodeExecutable,
    nodeExecutableSha256: binding.nodeExecutableSha256,
    nodeVersion: binding.nodeVersion,
    runtimeIdentitySha256: binding.runtimeIdentitySha256,
  };
}

function validateProviderBinding(
  binding: SandboxNodeDebuggerRuntimeBinding,
): void {
  if (
    binding.runtime !== "node-debugger" ||
    !path.posix.isAbsolute(binding.nodeExecutable) ||
    /[\u0000-\u001f\u007f]/u.test(binding.nodeExecutable) ||
    !SHA256.test(binding.nodeExecutableSha256) ||
    !SHA256.test(binding.runtimeIdentitySha256) ||
    !validNodeVersion(binding.nodeVersion)
  ) {
    throw new Error("Node debugger provider runtime identity is invalid");
  }
}

function parseProbeOutput(output: string): { nodeVersion: string } {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error("Node debugger runtime probe output is invalid");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as Record<string, unknown>)["marker"] !==
      NODE_DEBUGGER_RUNTIME_PROBE_MARKER ||
    !validNodeVersion((value as Record<string, unknown>)["nodeVersion"])
  ) {
    throw new Error("Node debugger runtime probe output is invalid");
  }
  return {
    nodeVersion: (value as Record<string, string>)["nodeVersion"]!,
  };
}

function validNodeVersion(value: unknown): value is string {
  const match =
    typeof value === "string" ? /^(\d+)\.(\d+)\.(\d+)$/u.exec(value) : null;
  return Boolean(
    match &&
    (Number(match[1]) > 22 ||
      (Number(match[1]) === 22 && Number(match[2]) >= 19)),
  );
}
