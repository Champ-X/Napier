import { createHash } from "node:crypto";

import type {
  AgentProfile,
  AgentProfileField,
  AgentProfileRevision,
  AgentProfileRevisionSource,
  AutomaticRecoveryPolicy,
  ModelAdvisorPolicy,
  ModelAdvisorRuleId,
  ModelRef,
  ResolvedModelAdvisorPolicy,
  RunLimits,
  SubagentLimits,
  ToolLoopGuardPolicy,
  UpdateAgentProfileRequest,
} from "@napier/contracts";

import { nowIso } from "./ids.js";
import { normalizePromptVariableDefinitions } from "./prompt-variables.js";
import { normalizeToolLoopGuardPolicy } from "./tool-loop-guard.js";

const ALLOWED_TOOLS = new Set([
  "list_files",
  "read_file",
  "search_files",
  "list_symbols",
  "inspect_data",
  "inspect_code",
  "read_symbol",
  "apply_patch",
  "verify_workspace",
]);
const THINKING_LEVELS = new Set<AgentProfile["thinkingLevel"]>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
]);
const TOOL_POLICIES = new Set<AgentProfile["toolPolicy"]>([
  "observe",
  "workspace",
  "unrestricted",
]);
const SUBAGENT_ROLES = new Set(["researcher", "reviewer", "general"]);
const MODEL_ADVISOR_MODES = new Set<ModelAdvisorPolicy["mode"]>([
  "observe",
  "enforce",
  "off",
]);
const MODEL_ADVISOR_RULES = new Set<ModelAdvisorRuleId>([
  "unverified_verification_claim",
  "destructive_command_reference",
]);
const AGENT_PROFILE_FIELDS: readonly AgentProfileField[] = [
  "name",
  "description",
  "systemPrompt",
  "model",
  "thinkingLevel",
  "toolPolicy",
  "enabledTools",
  "enabledSkills",
  "enabledSubagents",
  "subagentLimits",
  "runLimits",
  "automaticRecovery",
  "modelAdvisor",
  "promptVariables",
  "toolLoopGuard",
];
const AGENT_REVISION_SOURCES = new Set<AgentProfileRevisionSource>([
  "created",
  "updated",
  "rollback",
  "imported",
  "migrated",
]);

export const DEFAULT_SUBAGENT_LIMITS: Readonly<SubagentLimits> = {
  maxConcurrent: 2,
  maxTotal: 4,
  maxTurns: 8,
  timeoutMs: 120_000,
};

export const DEFAULT_RUN_LIMITS: Readonly<RunLimits> = {
  maxTurns: 24,
  maxTotalTokens: 250_000,
  maxCostUsd: 10,
  timeoutMs: 900_000,
};

export const DEFAULT_AUTOMATIC_RECOVERY_POLICY: Readonly<AutomaticRecoveryPolicy> =
  {
    mode: "manual",
    maxAttempts: 2,
    backoffMs: 5_000,
  };

export const DEFAULT_MODEL_ADVISOR_POLICY: Readonly<ResolvedModelAdvisorPolicy> =
  {
    mode: "observe",
    enabledRules: [
      "unverified_verification_claim",
      "destructive_command_reference",
    ],
    maxCorrectionAttempts: 0,
  };

export function updateAgentProfile(
  current: AgentProfile,
  request: UpdateAgentProfileRequest,
): AgentProfile {
  const updated: AgentProfile = {
    ...current,
    ...(request.name !== undefined
      ? { name: requiredText(request.name, "Agent name", 80) }
      : {}),
    ...(request.description !== undefined
      ? {
          description: requiredText(
            request.description,
            "Agent description",
            500,
          ),
        }
      : {}),
    ...(request.systemPrompt !== undefined
      ? {
          systemPrompt: requiredPrompt(
            request.systemPrompt,
            "Agent system prompt",
            12_000,
          ),
        }
      : {}),
    ...(request.model
      ? {
          model: {
            provider: normalizeProviderId(request.model.provider),
            id: normalizeModelId(request.model.id),
          },
        }
      : {}),
    ...(request.thinkingLevel !== undefined
      ? { thinkingLevel: validateThinkingLevel(request.thinkingLevel) }
      : {}),
    ...(request.toolPolicy !== undefined
      ? { toolPolicy: validateToolPolicy(request.toolPolicy) }
      : {}),
    ...(request.enabledTools !== undefined
      ? {
          enabledTools: preserveEquivalentSet(
            current.enabledTools,
            normalizeTools(request.enabledTools),
          ),
        }
      : {}),
    ...(request.enabledSkills !== undefined
      ? {
          enabledSkills: preserveEquivalentSet(
            current.enabledSkills,
            normalizeNames(request.enabledSkills, "skill"),
          ),
        }
      : {}),
    ...(request.enabledSubagents !== undefined
      ? optionalSubagentUpdate(
          current.enabledSubagents,
          request.enabledSubagents,
        )
      : {}),
    ...(request.subagentLimits !== undefined
      ? { subagentLimits: normalizeSubagentLimits(request.subagentLimits) }
      : {}),
    ...(request.runLimits !== undefined
      ? { runLimits: normalizeRunLimits(request.runLimits) }
      : {}),
    ...(request.automaticRecovery !== undefined
      ? optionalAutomaticRecoveryUpdate(
          current.automaticRecovery,
          request.automaticRecovery,
        )
      : {}),
    ...(request.modelAdvisor !== undefined
      ? optionalModelAdvisorUpdate(current.modelAdvisor, request.modelAdvisor)
      : {}),
    ...(request.promptVariables !== undefined
      ? optionalPromptVariableUpdate(
          current.promptVariables,
          request.promptVariables,
        )
      : {}),
    ...(request.toolLoopGuard !== undefined
      ? optionalToolLoopGuardUpdate(
          current.toolLoopGuard,
          request.toolLoopGuard,
        )
      : {}),
  };
  assertIndependentAdvisorModel(updated);
  if (configSignature(updated) === configSignature(current)) {
    return structuredClone(current);
  }
  updated.revision = current.revision + 1;
  updated.updatedAt = nowIso();
  return updated;
}

export function changedAgentFields(
  before: AgentProfile,
  after: AgentProfile,
): AgentProfileField[] {
  return AGENT_PROFILE_FIELDS.filter((field) => {
    if (field === "automaticRecovery") {
      return (
        JSON.stringify(effectiveAutomaticRecoveryPolicy(before)) !==
        JSON.stringify(effectiveAutomaticRecoveryPolicy(after))
      );
    }
    if (field === "modelAdvisor") {
      return (
        JSON.stringify(effectiveModelAdvisorPolicy(before)) !==
        JSON.stringify(effectiveModelAdvisorPolicy(after))
      );
    }
    if (field === "toolLoopGuard") {
      return (
        JSON.stringify(effectiveToolLoopGuardPolicy(before)) !==
        JSON.stringify(effectiveToolLoopGuardPolicy(after))
      );
    }
    return JSON.stringify(before[field]) !== JSON.stringify(after[field]);
  });
}

export function createAgentProfileRevision(
  profile: AgentProfile,
  options: {
    source: AgentProfileRevisionSource;
    changedFields?: AgentProfileField[];
    restoredFromRevision?: number;
    createdAt?: string;
  },
): AgentProfileRevision {
  const changedFields = normalizeRevisionChangedFields(
    options.changedFields ??
      (options.source === "created" || options.source === "imported"
        ? [...AGENT_PROFILE_FIELDS]
        : []),
  );
  const createdAt = options.createdAt ?? profile.updatedAt;
  const systemPromptSha256 = sha256(profile.systemPrompt);
  const content = {
    agentId: profile.id,
    revision: profile.revision,
    profile: structuredClone(profile),
    changedFields,
    source: options.source,
    ...(options.restoredFromRevision !== undefined
      ? { restoredFromRevision: options.restoredFromRevision }
      : {}),
    systemPromptSha256,
    createdAt,
  };
  const revision: AgentProfileRevision = {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
  return validateAgentProfileRevision(revision);
}

export function validateAgentProfileRevision(
  input: unknown,
): AgentProfileRevision {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Agent profile revision must be an object");
  }
  const revision = input as AgentProfileRevision;
  if (
    !AGENT_REVISION_SOURCES.has(revision.source) ||
    !Number.isInteger(revision.revision) ||
    revision.revision < 1 ||
    !revision.profile ||
    revision.agentId !== revision.profile.id ||
    revision.revision !== revision.profile.revision ||
    !/^[a-z][a-z0-9_-]{2,80}$/.test(revision.agentId) ||
    !Number.isFinite(Date.parse(revision.createdAt)) ||
    !/^[a-f0-9]{64}$/.test(revision.systemPromptSha256) ||
    revision.systemPromptSha256 !== sha256(revision.profile.systemPrompt) ||
    !/^[a-f0-9]{64}$/.test(revision.contentSha256)
  ) {
    throw new Error("Agent profile revision evidence is invalid");
  }
  assertAgentProfileSnapshot(revision.profile);
  const changedFields = normalizeRevisionChangedFields(revision.changedFields);
  if (
    JSON.stringify(changedFields) !== JSON.stringify(revision.changedFields)
  ) {
    throw new Error("Agent profile revision changed fields are invalid");
  }
  if (revision.source === "rollback") {
    if (
      !Number.isInteger(revision.restoredFromRevision) ||
      Number(revision.restoredFromRevision) < 1 ||
      Number(revision.restoredFromRevision) >= revision.revision ||
      changedFields.length === 0
    ) {
      throw new Error("Agent profile rollback provenance is invalid");
    }
  } else if (revision.restoredFromRevision !== undefined) {
    throw new Error("Agent profile revision has unexpected rollback metadata");
  }
  if (revision.source === "updated" && changedFields.length === 0) {
    throw new Error("Updated Agent profile revision has no changed fields");
  }
  const { contentSha256: _contentSha256, ...content } = revision;
  if (sha256(canonicalJson(content)) !== revision.contentSha256) {
    throw new Error("Agent profile revision content hash mismatch");
  }
  return structuredClone(revision);
}

export function rollbackAgentProfile(
  current: AgentProfile,
  target: AgentProfileRevision,
): AgentProfile {
  const validated = validateAgentProfileRevision(target);
  if (validated.agentId !== current.id) {
    throw new Error("Agent profile rollback target belongs to another Agent");
  }
  const profile = validated.profile;
  const updated = updateAgentProfile(current, {
    name: profile.name,
    description: profile.description,
    systemPrompt: profile.systemPrompt,
    model: profile.model,
    thinkingLevel: profile.thinkingLevel,
    toolPolicy: profile.toolPolicy,
    enabledTools: profile.enabledTools,
    enabledSkills: profile.enabledSkills,
    enabledSubagents: profile.enabledSubagents ?? [],
    subagentLimits:
      profile.subagentLimits ?? structuredClone(DEFAULT_SUBAGENT_LIMITS),
    runLimits: profile.runLimits ?? structuredClone(DEFAULT_RUN_LIMITS),
    automaticRecovery: effectiveAutomaticRecoveryPolicy(profile),
    modelAdvisor: effectiveModelAdvisorPolicy(profile),
    promptVariables: normalizePromptVariableDefinitions(
      profile.promptVariables,
    ),
    toolLoopGuard: effectiveToolLoopGuardPolicy(profile),
  });
  if (updated.revision === current.revision) {
    throw new Error("Agent profile already matches the target revision");
  }
  return updated;
}

function normalizeProviderId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error(`Invalid model provider ID: ${value}`);
  }
  return normalized;
}

function normalizeRevisionChangedFields(
  values: readonly AgentProfileField[],
): AgentProfileField[] {
  if (!Array.isArray(values)) {
    throw new Error("Agent profile revision changed fields are invalid");
  }
  const requested = new Set(values);
  if (
    requested.size !== values.length ||
    values.some((field) => !AGENT_PROFILE_FIELDS.includes(field))
  ) {
    throw new Error("Agent profile revision changed fields are invalid");
  }
  return AGENT_PROFILE_FIELDS.filter((field) => requested.has(field));
}

function assertAgentProfileSnapshot(profile: AgentProfile): void {
  if (
    !profile.name.trim() ||
    !profile.description.trim() ||
    !profile.systemPrompt.trim() ||
    normalizeProviderId(profile.model.provider) !== profile.model.provider ||
    normalizeModelId(profile.model.id) !== profile.model.id ||
    validateThinkingLevel(profile.thinkingLevel) !== profile.thinkingLevel ||
    validateToolPolicy(profile.toolPolicy) !== profile.toolPolicy ||
    !Array.isArray(profile.enabledTools) ||
    !Array.isArray(profile.enabledSkills) ||
    !Number.isFinite(Date.parse(profile.createdAt)) ||
    !Number.isFinite(Date.parse(profile.updatedAt)) ||
    Date.parse(profile.updatedAt) < Date.parse(profile.createdAt)
  ) {
    throw new Error("Agent profile revision snapshot is invalid");
  }
  normalizeTools(profile.enabledTools);
  normalizeNames(profile.enabledSkills, "skill");
  normalizeSubagents(profile.enabledSubagents ?? []);
  normalizeSubagentLimits(
    profile.subagentLimits ?? structuredClone(DEFAULT_SUBAGENT_LIMITS),
  );
  normalizeRunLimits(profile.runLimits ?? structuredClone(DEFAULT_RUN_LIMITS));
  normalizeAutomaticRecoveryPolicy(
    profile.automaticRecovery ??
      structuredClone(DEFAULT_AUTOMATIC_RECOVERY_POLICY),
  );
  normalizeModelAdvisorPolicy(
    profile.modelAdvisor ?? structuredClone(DEFAULT_MODEL_ADVISOR_POLICY),
  );
  const promptVariables = normalizePromptVariableDefinitions(
    profile.promptVariables,
  );
  if (
    profile.promptVariables !== undefined &&
    JSON.stringify(profile.promptVariables) !== JSON.stringify(promptVariables)
  ) {
    throw new Error("Agent profile prompt variables are not canonical");
  }
  const toolLoopGuard = normalizeToolLoopGuardPolicy(profile.toolLoopGuard);
  if (
    profile.toolLoopGuard !== undefined &&
    JSON.stringify(profile.toolLoopGuard) !== JSON.stringify(toolLoopGuard)
  ) {
    throw new Error("Agent profile tool loop guard is not canonical");
  }
  assertIndependentAdvisorModel(profile);
}

function normalizeAdvisorReviewModel(
  value: ModelAdvisorPolicy["reviewModel"],
): ModelRef | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    throw new Error("Model Advisor review model is invalid");
  }
  if (typeof value.provider !== "string" || typeof value.id !== "string") {
    throw new Error("Model Advisor review model is invalid");
  }
  return {
    provider: normalizeProviderId(value.provider),
    id: normalizeModelId(value.id),
  };
}

function assertIndependentAdvisorModel(
  profile: Pick<AgentProfile, "model" | "modelAdvisor">,
): void {
  const reviewModel = effectiveModelAdvisorPolicy(profile).reviewModel;
  if (
    reviewModel &&
    reviewModel.provider === profile.model.provider &&
    reviewModel.id === profile.model.id
  ) {
    throw new Error(
      "Model Advisor review model must differ from the primary model",
    );
  }
  if (
    reviewModel &&
    reviewModel.provider === "napier" &&
    reviewModel.id === "demo"
  ) {
    throw new Error("Model Advisor review model must use a live model");
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeModelId(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 200 ||
    /[\u0000-\u001f\u007f<>\s]/.test(normalized)
  ) {
    throw new Error(`Invalid model ID: ${value}`);
  }
  return normalized;
}

function validateThinkingLevel(
  value: AgentProfile["thinkingLevel"],
): AgentProfile["thinkingLevel"] {
  if (!THINKING_LEVELS.has(value)) {
    throw new Error(`Invalid thinking level: ${value}`);
  }
  return value;
}

function validateToolPolicy(
  value: AgentProfile["toolPolicy"],
): AgentProfile["toolPolicy"] {
  if (!TOOL_POLICIES.has(value)) {
    throw new Error(`Invalid tool policy: ${value}`);
  }
  return value;
}

function normalizeTools(values: string[]): string[] {
  const normalized = [...new Set(values)];
  const unsupported = normalized.find((tool) => !ALLOWED_TOOLS.has(tool));
  if (unsupported) throw new Error(`Unsupported Agent tool: ${unsupported}`);
  return normalized.sort();
}

export function effectiveModelAdvisorPolicy(
  profile: Pick<AgentProfile, "modelAdvisor">,
): ResolvedModelAdvisorPolicy {
  return normalizeModelAdvisorPolicy(
    profile.modelAdvisor ?? structuredClone(DEFAULT_MODEL_ADVISOR_POLICY),
  );
}

export function effectiveToolLoopGuardPolicy(
  profile: Pick<AgentProfile, "toolLoopGuard">,
): ToolLoopGuardPolicy {
  return normalizeToolLoopGuardPolicy(profile.toolLoopGuard);
}

export function normalizeModelAdvisorPolicy(
  input: ModelAdvisorPolicy,
): ResolvedModelAdvisorPolicy {
  if (
    !input ||
    typeof input !== "object" ||
    !MODEL_ADVISOR_MODES.has(input.mode) ||
    !Array.isArray(input.enabledRules) ||
    (input.maxCorrectionAttempts !== undefined &&
      (!Number.isSafeInteger(input.maxCorrectionAttempts) ||
        input.maxCorrectionAttempts < 0 ||
        input.maxCorrectionAttempts > 3))
  ) {
    throw new Error("Model Advisor policy is invalid");
  }
  const enabledRules = [...new Set(input.enabledRules)].sort();
  const unsupported = enabledRules.find(
    (rule) => !MODEL_ADVISOR_RULES.has(rule),
  );
  if (unsupported) {
    throw new Error(`Unsupported Model Advisor rule: ${unsupported}`);
  }
  const reviewModel = normalizeAdvisorReviewModel(input.reviewModel);
  return {
    mode: input.mode,
    enabledRules,
    maxCorrectionAttempts: input.maxCorrectionAttempts ?? 0,
    ...(reviewModel ? { reviewModel } : {}),
  };
}

function optionalModelAdvisorUpdate(
  current: AgentProfile["modelAdvisor"],
  requested: ModelAdvisorPolicy,
): { modelAdvisor?: ModelAdvisorPolicy } {
  const normalized = normalizeModelAdvisorPolicy(requested);
  const effectiveCurrent = normalizeModelAdvisorPolicy(
    current ?? structuredClone(DEFAULT_MODEL_ADVISOR_POLICY),
  );
  if (JSON.stringify(effectiveCurrent) === JSON.stringify(normalized)) {
    return current === undefined ? {} : { modelAdvisor: current };
  }
  return { modelAdvisor: normalized };
}

function optionalPromptVariableUpdate(
  current: AgentProfile["promptVariables"],
  requested: NonNullable<AgentProfile["promptVariables"]>,
): Pick<AgentProfile, "promptVariables"> | Record<string, never> {
  const normalized = normalizePromptVariableDefinitions(requested);
  const effectiveCurrent = normalizePromptVariableDefinitions(current);
  if (JSON.stringify(effectiveCurrent) === JSON.stringify(normalized)) {
    return current === undefined ? {} : { promptVariables: current };
  }
  if (current === undefined && normalized.length === 0) return {};
  return { promptVariables: normalized };
}

function optionalToolLoopGuardUpdate(
  current: AgentProfile["toolLoopGuard"],
  requested: ToolLoopGuardPolicy,
): { toolLoopGuard?: ToolLoopGuardPolicy } {
  const normalized = normalizeToolLoopGuardPolicy(requested);
  const effectiveCurrent = normalizeToolLoopGuardPolicy(current);
  if (JSON.stringify(effectiveCurrent) === JSON.stringify(normalized)) {
    return current === undefined ? {} : { toolLoopGuard: current };
  }
  return { toolLoopGuard: normalized };
}

function normalizeNames(values: string[], label: string): string[] {
  const normalized = [
    ...new Set(values.map((value) => value.trim().toLowerCase())),
  ];
  for (const value of normalized) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(value)) {
      throw new Error(`Invalid ${label} name: ${value}`);
    }
  }
  return normalized.sort();
}

function normalizeSubagents(
  values: NonNullable<AgentProfile["enabledSubagents"]>,
): NonNullable<AgentProfile["enabledSubagents"]> {
  const normalized = [...new Set(values)];
  const unsupported = normalized.find((role) => !SUBAGENT_ROLES.has(role));
  if (unsupported) {
    throw new Error(`Unsupported subagent role: ${unsupported}`);
  }
  return normalized.sort();
}

function preserveEquivalentSet<T extends string>(
  current: T[],
  normalized: T[],
): T[] {
  const currentSet = [...new Set(current)].sort();
  return JSON.stringify(currentSet) === JSON.stringify(normalized)
    ? [...current]
    : normalized;
}

function optionalSubagentUpdate(
  current: AgentProfile["enabledSubagents"],
  requested: NonNullable<AgentProfile["enabledSubagents"]>,
): Pick<AgentProfile, "enabledSubagents"> | Record<string, never> {
  const normalized = normalizeSubagents(requested);
  if (current === undefined && normalized.length === 0) return {};
  return {
    enabledSubagents: preserveEquivalentSet(current ?? [], normalized),
  };
}

function optionalAutomaticRecoveryUpdate(
  current: AgentProfile["automaticRecovery"],
  requested: AutomaticRecoveryPolicy,
): Pick<AgentProfile, "automaticRecovery"> | Record<string, never> {
  const normalized = normalizeAutomaticRecoveryPolicy(requested);
  if (
    current === undefined &&
    JSON.stringify(normalized) ===
      JSON.stringify(DEFAULT_AUTOMATIC_RECOVERY_POLICY)
  ) {
    return {};
  }
  return { automaticRecovery: normalized };
}

export function effectiveAutomaticRecoveryPolicy(
  profile: Pick<AgentProfile, "automaticRecovery">,
): AutomaticRecoveryPolicy {
  return normalizeAutomaticRecoveryPolicy(
    profile.automaticRecovery ??
      structuredClone(DEFAULT_AUTOMATIC_RECOVERY_POLICY),
  );
}

export function normalizeAutomaticRecoveryPolicy(
  input: AutomaticRecoveryPolicy,
): AutomaticRecoveryPolicy {
  if (!input || (input.mode !== "manual" && input.mode !== "safe_read_only")) {
    throw new Error("Automatic recovery mode is invalid");
  }
  return {
    mode: input.mode,
    maxAttempts: boundedInteger(
      input.maxAttempts,
      "Automatic recovery maxAttempts",
      1,
      3,
    ),
    backoffMs: boundedInteger(
      input.backoffMs,
      "Automatic recovery backoffMs",
      1_000,
      3_600_000,
    ),
  };
}

export function normalizeSubagentLimits(input: SubagentLimits): SubagentLimits {
  return {
    maxConcurrent: boundedInteger(input.maxConcurrent, "maxConcurrent", 1, 8),
    maxTotal: boundedInteger(input.maxTotal, "maxTotal", 1, 24),
    maxTurns: boundedInteger(input.maxTurns, "maxTurns", 1, 32),
    timeoutMs: boundedInteger(input.timeoutMs, "timeoutMs", 1_000, 900_000),
  };
}

export function normalizeRunLimits(input: RunLimits): RunLimits {
  return {
    maxTurns: boundedInteger(input.maxTurns, "run maxTurns", 1, 128),
    maxTotalTokens: boundedInteger(
      input.maxTotalTokens,
      "run maxTotalTokens",
      1_000,
      10_000_000,
    ),
    maxCostUsd: boundedNumber(input.maxCostUsd, "run maxCostUsd", 0.01, 1_000),
    timeoutMs: boundedInteger(
      input.timeoutMs,
      "run timeoutMs",
      10_000,
      3_600_000,
    ),
  };
}

function boundedInteger(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return value;
}

function boundedNumber(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be from ${minimum} to ${maximum}`);
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function requiredPrompt(
  value: string,
  label: string,
  maxLength: number,
): string {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function configSignature(profile: AgentProfile): string {
  return JSON.stringify({
    name: profile.name,
    description: profile.description,
    systemPrompt: profile.systemPrompt,
    model: profile.model,
    thinkingLevel: profile.thinkingLevel,
    toolPolicy: profile.toolPolicy,
    enabledTools: profile.enabledTools,
    enabledSkills: profile.enabledSkills,
    enabledSubagents: profile.enabledSubagents ?? [],
    subagentLimits: profile.subagentLimits,
    runLimits: profile.runLimits,
    automaticRecovery: effectiveAutomaticRecoveryPolicy(profile),
    modelAdvisor: effectiveModelAdvisorPolicy(profile),
    promptVariables: normalizePromptVariableDefinitions(
      profile.promptVariables,
    ),
    toolLoopGuard: effectiveToolLoopGuardPolicy(profile),
  });
}
