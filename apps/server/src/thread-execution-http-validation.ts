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
import { parsePromptImages } from "./prompt-image-validation.js";

export function parseResumeRunRequest(
  input: unknown,
): ResumeRunRequest | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["runId", "model"]);
  if (!record) return undefined;
  const runId = parseRunId(record["runId"]);
  if (record["runId"] !== undefined && !runId) return undefined;
  const model =
    record["model"] === undefined ? undefined : parseModelRef(record["model"]);
  if (record["model"] !== undefined && !model) return undefined;
  return {
    ...(runId ? { runId } : {}),
    ...(model ? { model } : {}),
  };
}

export function parsePromptRequest(input: unknown): PromptRequest | undefined {
  const record = requestRecord(input, [
    "text",
    "images",
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
  const images =
    record["images"] === undefined
      ? undefined
      : parsePromptImages(record["images"]);
  if (record["images"] !== undefined && !images) return undefined;
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
  const sourceContinuityRunId = parseRunId(record["sourceContinuityRunId"]);
  if (record["sourceContinuityRunId"] !== undefined && !sourceContinuityRunId) {
    return undefined;
  }
  return {
    text,
    ...(images ? { images } : {}),
    ...(model ? { model } : {}),
    ...(modelRoute ? { modelRoute } : {}),
    ...(typeof capabilityPreset === "string"
      ? { capabilityPreset: capabilityPreset as AgentCapabilityPresetId }
      : {}),
    ...(sourceContinuityRunId ? { sourceContinuityRunId } : {}),
  };
}

function parseRunId(input: unknown): string | undefined {
  return typeof input === "string" && /^run_[a-z0-9]{8,80}$/u.test(input)
    ? input
    : undefined;
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
  const fallbackModels = parseFallbackModels(record["fallbackModels"]);
  if (!fallbackModels.valid) return undefined;
  const subagentRoles = parseSubagentRoleRoutes(record["subagentRoles"]);
  if (record["subagentRoles"] !== undefined && !subagentRoles) {
    return undefined;
  }
  return {
    ...(typeof role === "string" ? { role: role as ModelRole } : {}),
    ...(fallbackModels.value ? { fallbackModels: fallbackModels.value } : {}),
    ...(subagentRoles ? { subagentRoles } : {}),
  };
}

const SUBAGENT_ROLES = [
  "researcher",
  "reviewer",
  "general",
  "coder",
] as const satisfies readonly SubagentRole[];

type ParsedFallbackModels =
  | {
      valid: true;
      value?: NonNullable<ModelRouteRequest["fallbackModels"]>;
    }
  | { valid: false };

function parseFallbackModels(
  input: unknown,
  primary?: ModelRoleRouteBinding["model"],
): ParsedFallbackModels {
  if (input === undefined) return { valid: true };
  if (!Array.isArray(input) || input.length > 4) return { valid: false };
  const candidates = input.map(parseModelRef);
  if (candidates.some((candidate) => candidate === undefined)) {
    return { valid: false };
  }
  const value = candidates as NonNullable<ModelRouteRequest["fallbackModels"]>;
  const keys = [primary, ...value]
    .filter((candidate) => candidate !== undefined)
    .map((candidate) => `${candidate.provider}/${candidate.id}`);
  return new Set(keys).size === keys.length
    ? { valid: true, value }
    : { valid: false };
}

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
    if (!binding || !model) return undefined;
    const fallbackModels = parseFallbackModels(
      binding["fallbackModels"],
      model,
    );
    if (!fallbackModels.valid) return undefined;
    parsed[role as SubagentRole] = {
      model,
      ...(fallbackModels.value ? { fallbackModels: fallbackModels.value } : {}),
    };
  }
  return parsed;
}
