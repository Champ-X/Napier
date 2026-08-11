import type { AgentProfile } from "@napier/contracts";
import { agentCapabilityStatus } from "@napier/contracts/agent-capabilities";
import type { CapabilityReadinessRecord } from "@napier/contracts/agent-capability-contract";

import {
  probeShellRuntime,
  type RuntimeCapabilityProbe,
} from "./doctor-runtime-probes.js";
import type { OsSandboxAdapter } from "./sandbox.js";

export const PROCESS_RUN_READINESS_MESSAGE =
  "Sandbox is unavailable for this process-capable task. Run napier setup --workspace 'WORKSPACE_PATH' --component sandbox, inspect and exact-apply its preview, then retry.";
export const PROCESS_RUN_READINESS_INVALID_BINDING_MESSAGE =
  "The persisted Sandbox binding is invalid. Run napier setup --workspace 'WORKSPACE_PATH' --component sandbox --uninstall, inspect and exact-apply that preview to remove only the invalid binding, then run ordinary Sandbox Setup and retry.";

const SHARED_GATES = new WeakMap<
  OsSandboxAdapter,
  Map<string, ProcessRunReadinessGate>
>();

export class ProcessRunReadinessError extends Error {
  readonly code = "sandbox_unavailable";

  constructor(readonly readiness: CapabilityReadinessRecord) {
    super(processRunReadinessMessage(readiness));
    this.name = "ProcessRunReadinessError";
  }
}

export function processRunReadinessMessage(
  readiness: Pick<CapabilityReadinessRecord, "id"> | undefined,
): string {
  return readiness?.id === "sandbox:configured-sandbox-invalid"
    ? PROCESS_RUN_READINESS_INVALID_BINDING_MESSAGE
    : PROCESS_RUN_READINESS_MESSAGE;
}

export class ProcessRunReadinessGate {
  private cached: Promise<CapabilityReadinessRecord> | undefined;
  private readinessVersion = -1;

  constructor(
    private readonly sandbox: OsSandboxAdapter,
    private readonly workspaceRoot: string,
    private readonly probe: (
      workspaceRoot: string,
      signal: AbortSignal | undefined,
      sandbox: OsSandboxAdapter,
    ) => Promise<RuntimeCapabilityProbe> = probeShellRuntime,
  ) {}

  record(refresh = false): Promise<CapabilityReadinessRecord> {
    const version = this.sandbox.readinessVersion ?? 0;
    if (refresh || this.readinessVersion !== version) {
      this.cached = undefined;
      this.readinessVersion = version;
    }
    this.cached ??= inspectProcessSandboxReadiness(
      this.sandbox,
      this.workspaceRoot,
      this.probe,
    );
    return this.cached;
  }

  async assertProfile(
    profile: Pick<
      AgentProfile,
      "toolPolicy" | "enabledTools" | "enabledSkills" | "enabledSubagents"
    >,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!agentCapabilityStatus(profile).processExecution) return;
    signal?.throwIfAborted();
    const readiness = await this.record(true);
    signal?.throwIfAborted();
    if (readiness.status !== "ready") {
      throw new ProcessRunReadinessError(readiness);
    }
  }
}

export function sharedProcessRunReadinessGate(
  sandbox: OsSandboxAdapter,
  workspaceRoot: string,
): ProcessRunReadinessGate {
  let workspaces = SHARED_GATES.get(sandbox);
  if (!workspaces) {
    workspaces = new Map();
    SHARED_GATES.set(sandbox, workspaces);
  }
  let gate = workspaces.get(workspaceRoot);
  if (!gate) {
    gate = new ProcessRunReadinessGate(sandbox, workspaceRoot);
    workspaces.set(workspaceRoot, gate);
  }
  return gate;
}

export async function inspectProcessSandboxReadiness(
  sandbox: OsSandboxAdapter,
  workspaceRoot: string,
  probe: (
    workspaceRoot: string,
    signal: AbortSignal | undefined,
    sandbox: OsSandboxAdapter,
  ) => Promise<RuntimeCapabilityProbe> = probeShellRuntime,
): Promise<CapabilityReadinessRecord> {
  const result = await probe(workspaceRoot, undefined, sandbox);
  const available = result.status === "ready";
  return {
    id: `sandbox:${sandbox.id}`,
    status: available ? "ready" : "unavailable",
    configured: true,
    allowedByPolicy: false,
    exposed: false,
    detail: available
      ? `Sandbox provider completed the production shell PTY probe; effective process access remains policy-controlled (${result.message})`
      : result.message,
  };
}
