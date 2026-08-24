import type { PromptRequest, ResumeRunRequest } from "@napier/contracts";
import type {
  ModelRoleRouteBinding,
  ModelRole,
  ModelRouteRequest,
} from "@napier/contracts/model-route";
import type { SubagentRole } from "@napier/contracts";
import {
  AGENT_CAPABILITY_PRESET_IDS,
  type AgentCapabilityPresetId,
} from "@napier/contracts/agent-capabilities";

import { parseModelRef, requestRecord } from "./http-request-validation.js";

export function parseResumeRunRequest(
  input: unknown,
): ResumeRunRequest | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["runId", "model"]);
  if (!record) return undefined;
  const runId = record["runId"];
  if (
    runId !== undefined &&
    (typeof runId !== "string" || !/^run_[a-z0-9]{8,80}$/u.test(runId))
  ) {
    return undefined;
  }
  const model =
    record["model"] === undefined ? undefined : parseModelRef(record["model"]);
  if (record["model"] !== undefined && !model) return undefined;
  return {
    ...(typeof runId === "string" ? { runId } : {}),
    ...(model ? { model } : {}),
  };
}

export function parsePromptRequest(input: unknown): PromptRequest | undefined {
  const record = requestRecord(input, [
    "text",
    "model",
    "modelRoute",
    "capabilityPreset",
    "sourceContinuityRunId",
  ]);
  if (!record) return undefined;
  const text = record?.["text"];
  if (
    typeof text !== "string" ||
    text.length < 1 ||
    text.length > 60_000 ||
    !text.trim()
  ) {
    return undefined;
  }
  const model =
    record["model"] === undefined ? undefined : parseModelRef(record["model"]);
  if (record["model"] !== undefined && !model) return undefined;
  const modelRoute =
    record["modelRoute"] === undefined
      ? undefined
      : parseModelRouteRequest(record["modelRoute"]);
  if (record["modelRoute"] !== undefined && !modelRoute) return undefined;
  const capabilityPreset = record["capabilityPreset"];
  if (
    capabilityPreset !== undefined &&
    (typeof capabilityPreset !== "string" ||
      !AGENT_CAPABILITY_PRESET_IDS.includes(
        capabilityPreset as AgentCapabilityPresetId,
      ))
  ) {
    return undefined;
  }
  const sourceContinuityRunId = record["sourceContinuityRunId"];
  if (
    sourceContinuityRunId !== undefined &&
    (typeof sourceContinuityRunId !== "string" ||
      !/^run_[a-z0-9]{8,80}$/u.test(sourceContinuityRunId))
  ) {
    return undefined;
  }
  return {
    text,
    ...(model ? { model } : {}),
    ...(modelRoute ? { modelRoute } : {}),
    ...(typeof capabilityPreset === "string"
      ? { capabilityPreset: capabilityPreset as AgentCapabilityPresetId }
      : {}),
    ...(typeof sourceContinuityRunId === "string"
      ? { sourceContinuityRunId }
      : {}),
  };
}

const MODEL_ROLES = new Set<ModelRole>([
  "default",
  "fast",
  "reasoning",
  "vision",
  "subagent",
]);

export function parseModelRouteRequest(
  input: unknown,
): ModelRouteRequest | undefined {
  const record = requestRecord(input, [
    "role",
    "fallbackModels",
    "subagentRoles",
  ]);
  if (!record) return undefined;
  const role = record["role"];
  if (
    role !== undefined &&
    (typeof role !== "string" || !MODEL_ROLES.has(role as ModelRole))
  ) {
    return undefined;
  }
  const rawFallbacks = record["fallbackModels"];
  if (
    rawFallbacks !== undefined &&
    (!Array.isArray(rawFallbacks) || rawFallbacks.length > 4)
  ) {
    return undefined;
  }
  const fallbackModels = rawFallbacks?.map(parseModelRef);
  if (fallbackModels?.some((candidate) => candidate === undefined)) {
    return undefined;
  }
  const normalizedFallbacks = fallbackModels as
    | NonNullable<ModelRouteRequest["fallbackModels"]>
    | undefined;
  if (
    normalizedFallbacks &&
    new Set(
      normalizedFallbacks.map(
        (candidate) => `${candidate.provider}/${candidate.id}`,
      ),
    ).size !== normalizedFallbacks.length
  ) {
    return undefined;
  }
  const subagentRoles = parseSubagentRoleRoutes(record["subagentRoles"]);
  if (record["subagentRoles"] !== undefined && !subagentRoles) {
    return undefined;
  }
  return {
    ...(typeof role === "string" ? { role: role as ModelRole } : {}),
    ...(normalizedFallbacks ? { fallbackModels: normalizedFallbacks } : {}),
    ...(subagentRoles ? { subagentRoles } : {}),
  };
}

const SUBAGENT_ROLES = [
  "researcher",
  "reviewer",
  "general",
  "coder",
] as const satisfies readonly SubagentRole[];

function parseSubagentRoleRoutes(
  input: unknown,
): ModelRouteRequest["subagentRoles"] | undefined {
  if (input === undefined) return undefined;
  const roles = requestRecord(input, SUBAGENT_ROLES);
  if (!roles || Object.keys(roles).length === 0) return undefined;
  const parsed: Partial<Record<SubagentRole, ModelRoleRouteBinding>> = {};
  for (const [role, inputBinding] of Object.entries(roles)) {
    const binding = requestRecord(inputBinding, ["model", "fallbackModels"]);
    const model = parseModelRef(binding?.["model"]);
    const rawFallbacks = binding?.["fallbackModels"];
    if (
      !binding ||
      !model ||
      (rawFallbacks !== undefined &&
        (!Array.isArray(rawFallbacks) || rawFallbacks.length > 4))
    ) {
      return undefined;
    }
    const fallbackModels = rawFallbacks?.map(parseModelRef);
    if (fallbackModels?.some((candidate) => candidate === undefined)) {
      return undefined;
    }
    const normalized = fallbackModels as ModelRoleRouteBinding["fallbackModels"];
    const keys = [
      `${model.provider}/${model.id}`,
      ...(normalized ?? []).map(
        (candidate) => `${candidate.provider}/${candidate.id}`,
      ),
    ];
    if (new Set(keys).size !== keys.length) return undefined;
    parsed[role as SubagentRole] = {
      model,
      ...(normalized ? { fallbackModels: normalized } : {}),
    };
  }
  return parsed;
}
