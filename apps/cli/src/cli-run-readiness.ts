import type { AgentProfile, RunRecord } from "@napier/contracts";
import {
  agentCapabilityPresetUpdate,
  agentCapabilityStatus,
  type AgentCapabilityPresetId,
} from "@napier/contracts/agent-capabilities";
import type { LocalAgentRuntimeServices } from "@napier/runtime";
import {
  probeShellRuntime,
  type RuntimeCapabilityProbe,
} from "@napier/runtime/doctor-probes";

import type { CliRunOptions } from "./cli-run-options.js";
import { CliPublicError } from "./cli-public-error.js";
import { cliErrorFrame } from "./cli-public-error.js";

export interface CliRunReadinessDependencies {
  processSandbox?: (
    workspaceRoot: string,
    signal: AbortSignal | undefined,
    sandbox: LocalAgentRuntimeServices["sandbox"],
  ) => Promise<RuntimeCapabilityProbe>;
}

export async function assertCliRunReadiness(
  services: LocalAgentRuntimeServices,
  profile: AgentProfile,
  presetId: AgentCapabilityPresetId | undefined,
  signal?: AbortSignal,
  dependencies: CliRunReadinessDependencies = {},
): Promise<void> {
  const effective = presetId
    ? { ...profile, ...agentCapabilityPresetUpdate(presetId) }
    : profile;
  if (!agentCapabilityStatus(effective).processExecution) return;
  const result = await (dependencies.processSandbox ?? probeShellRuntime)(
    services.workspaceRoot,
    signal,
    services.sandbox,
  );
  if (result.status === "ready") return;
  throw new CliPublicError(
    services.sandbox.id === "configured-sandbox-invalid"
      ? "sandbox_binding_invalid"
      : "sandbox_unavailable",
    `Sandbox is unavailable for this task mode (${result.code})`,
  );
}

export function activeCliAgent(
  services: LocalAgentRuntimeServices,
  requestedAgentId: string | undefined,
  threadId: string | undefined,
) {
  if (threadId) {
    return services.store.getAgent(services.store.getThread(threadId).agentId);
  }
  return requestedAgentId
    ? services.store.getAgent(requestedAgentId)
    : services.store.listAgents()[0]!;
}

export async function prepareCliRunTarget(
  services: LocalAgentRuntimeServices,
  options: CliRunOptions,
  signal: AbortSignal,
  dependencies: CliRunReadinessDependencies = {},
) {
  const existing = options.threadId
    ? services.store.getThread(options.threadId)
    : undefined;
  if (existing && options.agentId && options.agentId !== existing.agentId) {
    throw new Error("Existing Thread Agent does not match --agent");
  }
  const agent = existing
    ? services.store.getAgent(existing.agentId)
    : options.agentId
      ? services.store.getAgent(options.agentId)
      : services.store.listAgents()[0];
  if (!agent) throw new Error("No Agent profile is available");
  await assertCliRunReadiness(
    services,
    agent,
    options.capabilityPreset,
    signal,
    dependencies,
  );
  return { existing, agent };
}

export function cliRunReadinessNotice(
  error: unknown,
  threadId: string | undefined,
): string | undefined {
  if (
    !(error instanceof CliPublicError) ||
    !["sandbox_unavailable", "sandbox_binding_invalid"].includes(
      error.publicCode,
    )
  ) {
    return undefined;
  }
  const frame = cliErrorFrame(threadId ?? "thread_cli_tui", error);
  return `Cannot start Run: ${frame.message} (${frame.diagnosticSha256.slice(0, 12)})`;
}

export async function assertCliResumeReadiness(
  services: LocalAgentRuntimeServices,
  threadId: string,
  runId: string | undefined,
  signal?: AbortSignal,
  dependencies: CliRunReadinessDependencies = {},
): Promise<void> {
  const interrupted = services.store
    .listRuns(threadId)
    .filter((run) => run.status === "interrupted")
    .findLast((run) => !runId || run.id === runId);
  if (!interrupted) return;
  await assertCliFrozenRunReadiness(
    services,
    interrupted,
    signal,
    dependencies,
  );
}

async function assertCliFrozenRunReadiness(
  services: LocalAgentRuntimeServices,
  run: RunRecord,
  signal?: AbortSignal,
  dependencies: CliRunReadinessDependencies = {},
): Promise<void> {
  const configuration = run.configuration;
  if (
    !configuration ||
    !agentCapabilityStatus({
      toolPolicy: configuration.toolPolicy,
      enabledTools: configuration.enabledTools,
      enabledSkills: configuration.enabledSkills,
      enabledSubagents: configuration.enabledSubagents,
    }).processExecution
  ) {
    return;
  }
  const result = await (dependencies.processSandbox ?? probeShellRuntime)(
    services.workspaceRoot,
    signal,
    services.sandbox,
  );
  if (result.status !== "ready") {
    throw new CliPublicError(
      services.sandbox.id === "configured-sandbox-invalid"
        ? "sandbox_binding_invalid"
        : "sandbox_unavailable",
      `Sandbox is unavailable for interrupted Run recovery (${result.code})`,
    );
  }
}
