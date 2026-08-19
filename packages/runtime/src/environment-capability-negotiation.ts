import type {
  AgentProfile,
  JsonValue,
  RunExecutionMode,
} from "@napier/contracts";
import type { CapabilityReadinessRecord } from "@napier/contracts/agent-capability-contract";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { AppendEventInput } from "./store.js";

export const ENVIRONMENT_CAPABILITY_NEGOTIATED_EVENT =
  "run.environment.negotiated";

export interface EnvironmentCapabilityNegotiationReceipt {
  kind: "napier.environment-capability-negotiation";
  schemaVersion: 1;
  status: "degraded_read_only";
  executionMode: "environment_degraded_read_only";
  reason: "sandbox_unavailable";
  sandboxId: string;
  readinessId: string;
  readinessDetailSha256: string;
  configuredToolCount: number;
  activeToolCount: number;
  activeToolNames: string[];
  omittedToolNames: string[];
  repairComponent: "sandbox";
  repairCommand: string;
  contentSha256: string;
}

export function createEnvironmentCapabilityNegotiationReceipt(input: {
  configuredProfile: Pick<AgentProfile, "enabledTools">;
  activeProfile: Pick<AgentProfile, "enabledTools">;
  sandboxId: string;
  readiness: CapabilityReadinessRecord;
}): EnvironmentCapabilityNegotiationReceipt {
  const configured = sortedUnique(input.configuredProfile.enabledTools);
  const active = sortedUnique(input.activeProfile.enabledTools);
  const activeSet = new Set(active);
  const content = {
    kind: "napier.environment-capability-negotiation" as const,
    schemaVersion: 1 as const,
    status: "degraded_read_only" as const,
    executionMode: "environment_degraded_read_only" as const,
    reason: "sandbox_unavailable" as const,
    sandboxId: input.sandboxId,
    readinessId: input.readiness.id,
    readinessDetailSha256: sha256(input.readiness.detail),
    configuredToolCount: configured.length,
    activeToolCount: active.length,
    activeToolNames: active,
    omittedToolNames: configured.filter((tool) => !activeSet.has(tool)),
    repairComponent: "sandbox" as const,
    repairCommand:
      input.readiness.id === "sandbox:configured-sandbox-invalid"
        ? "napier setup --workspace 'WORKSPACE_PATH' --component sandbox --uninstall"
        : "napier setup --workspace 'WORKSPACE_PATH' --component sandbox",
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createEnvironmentCapabilityNegotiationEvents(input: {
  executionMode: RunExecutionMode;
  readiness: CapabilityReadinessRecord | undefined;
  threadId: string;
  runId: string;
  configuredProfile: Pick<AgentProfile, "enabledTools">;
  activeProfile: Pick<AgentProfile, "enabledTools">;
  sandboxId: string;
}): AppendEventInput[] {
  if (
    input.executionMode !== "environment_degraded_read_only" ||
    !input.readiness
  ) {
    return [];
  }
  return [
    {
      threadId: input.threadId,
      runId: input.runId,
      type: ENVIRONMENT_CAPABILITY_NEGOTIATED_EVENT,
      category: "system",
      visibility: "user",
      payload: createEnvironmentCapabilityNegotiationReceipt({
        configuredProfile: input.configuredProfile,
        activeProfile: input.activeProfile,
        sandboxId: input.sandboxId,
        readiness: input.readiness,
      }) as unknown as JsonValue,
    },
  ];
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
