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
import type { EffectiveAgentCapabilityProjectionV1 } from "@napier/contracts/agent-capability-contract";

import type { CliCapabilityOptions } from "./cli-capability-options.js";
import { writeJsonLine, writeLine } from "./cli-output.js";
import type { CliIo, RunCliDependencies } from "./cli-runtime.js";
import { canonicalWorkspace } from "./workspace-path.js";

interface CapabilityCliResultBase {
  kind: "napier.agent-capability-status";
  agentId: string;
  agentRevision: number;
  status: AgentCapabilityStatus;
  preset?: AgentCapabilityPreset;
}

export interface CapabilityCliResultV1 extends CapabilityCliResultBase {
  schemaVersion: 1;
  action: "status" | "preview" | "applied";
  projection?: EffectiveAgentCapabilityProjectionV1;
}

export interface CapabilityCliRestoreResultV2 extends CapabilityCliResultBase {
  schemaVersion: 2;
  action: "restore_preview" | "restored";
  projection: EffectiveAgentCapabilityProjectionV1;
}

export type CapabilityCliResult =
  | CapabilityCliResultV1
  | CapabilityCliRestoreResultV2;

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
    let projection: EffectiveAgentCapabilityProjectionV1 | undefined;
    let action: CapabilityCliResult["action"] = preset
      ? options.apply
        ? "applied"
        : "preview"
      : "status";
    if (options.restoreRecommended) {
      if (options.apply) {
        const restored = await services.agentCapabilities.restore(current.id, {
          schemaVersion: 1,
          expectedRevision: options.expectedRevision!,
          diffSha256: options.diffSha256!,
        });
        projection = restored.projection;
        action = "restored";
      } else {
        projection = await services.agentCapabilities.project(current.id);
        action = "restore_preview";
      }
    } else if (!preset) {
      projection = await services.agentCapabilities.project(current.id);
    }
    const legacyProfile = projection
      ? {
          toolPolicy: projection.toolPolicy,
          enabledTools: projection.configuredTools,
          enabledSkills: projection.configuredSkills,
          enabledSubagents: projection.configuredSubagents as NonNullable<
            AgentProfile["enabledSubagents"]
          >,
        }
      : agent;
    const base = {
      kind: "napier.agent-capability-status" as const,
      agentId: projection?.agentId ?? agent.id,
      agentRevision: projection?.agentRevision ?? agent.revision,
      status: agentCapabilityStatus(legacyProfile),
      ...(preset ? { preset } : {}),
    };
    const result: CapabilityCliResult = options.restoreRecommended
      ? {
          ...base,
          schemaVersion: 2,
          action: action as CapabilityCliRestoreResultV2["action"],
          projection: projection!,
        }
      : {
          ...base,
          schemaVersion: 1,
          action: action as CapabilityCliResultV1["action"],
          ...(projection ? { projection } : {}),
        };
    if (options.jsonl) {
      await writeJsonLine(io.stdout, result);
    } else {
      await writeLine(io.stdout, formatCapabilities(result, options));
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

function formatCapabilities(
  result: CapabilityCliResult,
  options: CliCapabilityOptions,
): string {
  const status = result.status;
  const restore = result.projection?.restorePreview;
  return [
    `Agent: ${result.agentId} rev ${result.agentRevision}`,
    `Action: ${result.action}`,
    `Preset: ${status.label} (${status.presetId})`,
    `Permissions: ${status.policyLabel}`,
    `Tools: ${status.enabledToolCount} enabled / ${status.blockedEnabledToolCount} blocked by policy`,
    `Capabilities: network ${yesNo(status.networkRead)} · browser read ${yesNo(status.browserRead)} · browser interact ${browserInteractionLabel(status)} · workspace write ${yesNo(status.workspaceWrite)} · process ${yesNo(status.processExecution)}`,
    ...(result.projection
      ? [
          `Contract: ${result.projection.driftState} · ${result.projection.ownership}`,
          `Projection: ${result.projection.projectionSha256}`,
          `Restore diff: ${restore!.diffSha256} (${String(restore!.operations.length)} operations)`,
        ]
      : []),
    ...(result.action === "restore_preview"
      ? [
          `Restore operations (${String(restore!.operations.length)}):`,
          ...(restore!.operations.length === 0
            ? ["  none"]
            : restore!.operations.map(
                (operation) =>
                  `  ${operation.risk.toUpperCase()} ${operation.effect} · ${operation.field} ${operation.operation} ${JSON.stringify(operation.value)}`,
              )),
          `Apply: ${restoreApplyCommand(options, result.agentId, restore!.agentRevision, restore!.diffSha256)}`,
        ]
      : []),
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

function restoreApplyCommand(
  options: CliCapabilityOptions,
  agentId: string,
  revision: number,
  diffSha256: string,
): string {
  return [
    "napier capabilities",
    "--workspace",
    shellArgument(options.workspace),
    ...(options.dataRoot
      ? ["--data-root", shellArgument(options.dataRoot)]
      : []),
    "--agent",
    shellArgument(agentId),
    "--restore-recommended",
    "--expected-revision",
    String(revision),
    "--diff-sha256",
    diffSha256,
    "--apply",
  ].join(" ");
}

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
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
