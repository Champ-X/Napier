import path from "node:path";

import {
  AGENT_CAPABILITY_PRESETS,
  agentCapabilityPreset,
  agentCapabilityPresetUpdate,
  agentCapabilityStatus,
  type AgentCapabilityPreset,
  type AgentCapabilityStatus,
} from "@napier/contracts/agent-capabilities";
import type { AgentProfile } from "@napier/contracts";

import type { CliCapabilityOptions } from "./cli-capability-options.js";
import { writeJsonLine, writeLine } from "./cli-output.js";
import type { CliIo, RunCliDependencies } from "./cli-runtime.js";
import { canonicalWorkspace } from "./workspace-path.js";

export interface CapabilityCliResult {
  kind: "napier.agent-capability-status";
  schemaVersion: 1;
  action: "status" | "preview" | "applied";
  agentId: string;
  agentRevision: number;
  status: AgentCapabilityStatus;
  preset?: AgentCapabilityPreset;
}

export async function executeCapabilities(
  options: CliCapabilityOptions,
  io: CliIo,
  dependencies: RunCliDependencies,
  signal?: AbortSignal,
): Promise<number> {
  let services;
  try {
    signal?.throwIfAborted();
    const workspaceRoot = await canonicalWorkspace(options.workspace, io.cwd);
    services = await dependencies.createRuntime({
      workspaceRoot,
      dataRoot: path.resolve(
        io.cwd,
        options.dataRoot ?? path.join(workspaceRoot, ".napier"),
      ),
      env: io.env,
    });
    signal?.throwIfAborted();
    const current = options.agentId
      ? services.store.getAgent(options.agentId)
      : services.store.listAgents()[0];
    if (!current) throw new Error("No Agent profile is available");
    const preset = options.presetId
      ? agentCapabilityPreset(options.presetId)
      : undefined;
    const projected = preset
      ? ({
          ...current,
          ...agentCapabilityPresetUpdate(preset.id),
        } as AgentProfile)
      : current;
    const agent =
      preset && options.apply
        ? await services.store.updateAgent(
            current.id,
            agentCapabilityPresetUpdate(preset.id),
          )
        : projected;
    const result: CapabilityCliResult = {
      kind: "napier.agent-capability-status",
      schemaVersion: 1,
      action: preset ? (options.apply ? "applied" : "preview") : "status",
      agentId: agent.id,
      agentRevision: agent.revision,
      status: agentCapabilityStatus(agent),
      ...(preset ? { preset } : {}),
    };
    if (options.jsonl) {
      await writeJsonLine(io.stdout, result);
    } else {
      await writeLine(io.stdout, formatCapabilities(result));
    }
    return 0;
  } catch (error) {
    await writeLine(
      io.stderr,
      `Napier capabilities failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  } finally {
    await services?.shutdown().catch(() => undefined);
  }
}

function formatCapabilities(result: CapabilityCliResult): string {
  const status = result.status;
  return [
    `Agent: ${result.agentId} rev ${result.agentRevision}`,
    `Action: ${result.action}`,
    `Preset: ${status.label} (${status.presetId})`,
    `Permissions: ${status.policyLabel}`,
    `Tools: ${status.enabledToolCount} enabled / ${status.blockedEnabledToolCount} blocked by policy`,
    `Capabilities: network ${yesNo(status.networkRead)} · browser read ${yesNo(status.browserRead)} · browser interact ${browserInteractionLabel(status)} · workspace write ${yesNo(status.workspaceWrite)} · process ${yesNo(status.processExecution)}`,
    ...(result.action === "status"
      ? [
          "Available presets:",
          ...AGENT_CAPABILITY_PRESETS.map(
            (preset) => `  ${preset.id}: ${preset.label} — ${preset.summary}`,
          ),
        ]
      : []),
  ].join("\n");
}

function browserInteractionLabel(
  status: AgentCapabilityStatus,
): "yes" | "confirm interactively" | "no" {
  return status.browserInteract
    ? "yes"
    : status.browserInteractWithConfirmation
      ? "confirm interactively"
      : "no";
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}
