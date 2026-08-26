import {
  AGENT_TOOL_NAMES,
  type PromptVariableDefinition,
  type RollbackAgentProfileRequest,
  type ToolLoopGuardPolicy,
  type UpdateAgentProfileRequest,
} from "@napier/contracts";
import type { ModelRoutePolicyV2 } from "@napier/contracts/model-route";
import {
  normalizeModelRoutePolicy,
  normalizePromptVariableDefinitions,
} from "@napier/runtime/model";
import {
  normalizeToolLoopGuardPolicy,
} from "@napier/runtime/tools";

import {
  normalizeBoundedPrompt,
  normalizeBoundedText,
  parseModelRef,
  requestRecord,
  validThreadId,
} from "./http-request-validation.js";

interface OptionalField<Value> {
  valid: boolean;
  value?: Value;
}

export function parseUpdateAgentProfileRequest(
  input: unknown,
): UpdateAgentProfileRequest | undefined {
  const record = requestRecord(input, [
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
    "modelRoute",
    "clearModelRoute",
    "threadId",
  ]);
  if (!record) return undefined;
  const name = optionalField(record, "name", (value) =>
    normalizeBoundedText(value, 1, 80),
  );
  const description = optionalField(record, "description", (value) =>
    normalizeBoundedText(value, 1, 500),
  );
  const systemPrompt = optionalField(record, "systemPrompt", (value) =>
    normalizeBoundedPrompt(value, 12_000),
  );
  const model = optionalField(record, "model", parseModelRef);
  const thinkingLevel = optionalField(
    record,
    "thinkingLevel",
    parseThinkingLevel,
  );
  const toolPolicy = optionalField(record, "toolPolicy", parseToolPolicy);
  const enabledTools = optionalField(record, "enabledTools", parseEnabledTools);
  const enabledSkills = optionalField(record, "enabledSkills", (value) =>
    parseAgentNameArray(value, 128),
  );
  const enabledSubagents = optionalField(
    record,
    "enabledSubagents",
    parseEnabledSubagents,
  );
  const subagentLimits = optionalField(
    record,
    "subagentLimits",
    parseSubagentLimits,
  );
  const runLimits = optionalField(record, "runLimits", parseRunLimits);
  const automaticRecovery = optionalField(
    record,
    "automaticRecovery",
    parseAutomaticRecoveryPolicy,
  );
  const modelAdvisor = optionalField(
    record,
    "modelAdvisor",
    parseModelAdvisorPolicy,
  );
  const promptVariables = optionalField(
    record,
    "promptVariables",
    parsePromptVariableDefinitions,
  );
  const toolLoopGuard = optionalField(
    record,
    "toolLoopGuard",
    parseToolLoopGuardPolicy,
  );
  const modelRoute = optionalField(
    record,
    "modelRoute",
    parseModelRoutePolicy,
  );
  const clearModelRoute = optionalField(
    record,
    "clearModelRoute",
    parseTrue,
  );
  const threadId = optionalField(record, "threadId", (value) =>
    validThreadId(value) ? value : undefined,
  );
  const fields = [
    name,
    description,
    systemPrompt,
    model,
    thinkingLevel,
    toolPolicy,
    enabledTools,
    enabledSkills,
    enabledSubagents,
    subagentLimits,
    runLimits,
    automaticRecovery,
    modelAdvisor,
    promptVariables,
    toolLoopGuard,
    modelRoute,
    clearModelRoute,
    threadId,
  ];
  if (
    fields.some((field) => !field.valid) ||
    (modelRoute.value !== undefined && clearModelRoute.value === true)
  ) return undefined;
  return {
    ...(name.value !== undefined ? { name: name.value } : {}),
    ...(description.value !== undefined
      ? { description: description.value }
      : {}),
    ...(systemPrompt.value !== undefined
      ? { systemPrompt: systemPrompt.value }
      : {}),
    ...(model.value !== undefined ? { model: model.value } : {}),
    ...(thinkingLevel.value !== undefined
      ? { thinkingLevel: thinkingLevel.value }
      : {}),
    ...(toolPolicy.value !== undefined ? { toolPolicy: toolPolicy.value } : {}),
    ...(enabledTools.value !== undefined
      ? { enabledTools: enabledTools.value }
      : {}),
    ...(enabledSkills.value !== undefined
      ? { enabledSkills: enabledSkills.value }
      : {}),
    ...(enabledSubagents.value !== undefined
      ? { enabledSubagents: enabledSubagents.value }
      : {}),
    ...(subagentLimits.value !== undefined
      ? { subagentLimits: subagentLimits.value }
      : {}),
    ...(runLimits.value !== undefined ? { runLimits: runLimits.value } : {}),
    ...(automaticRecovery.value !== undefined
      ? { automaticRecovery: automaticRecovery.value }
      : {}),
    ...(modelAdvisor.value !== undefined
      ? { modelAdvisor: modelAdvisor.value }
      : {}),
    ...(promptVariables.value !== undefined
      ? { promptVariables: promptVariables.value }
      : {}),
    ...(toolLoopGuard.value !== undefined
      ? { toolLoopGuard: toolLoopGuard.value }
      : {}),
    ...(modelRoute.value !== undefined
      ? { modelRoute: modelRoute.value }
      : {}),
    ...(clearModelRoute.value === true ? { clearModelRoute: true as const } : {}),
    ...(threadId.value !== undefined ? { threadId: threadId.value } : {}),
  };
}

function parseModelRoutePolicy(
  input: unknown,
): ModelRoutePolicyV2 | undefined {
  try {
    return normalizeModelRoutePolicy(input as ModelRoutePolicyV2);
  } catch {
    return undefined;
  }
}

function parseTrue(input: unknown): true | undefined {
  return input === true ? true : undefined;
}

export function parseRollbackAgentProfileRequest(
  input: unknown,
): RollbackAgentProfileRequest | undefined {
  const record = requestRecord(input, ["revision", "threadId"]);
  const revision = record?.["revision"];
  const threadId = record?.["threadId"];
  return record &&
    typeof revision === "number" &&
    Number.isSafeInteger(revision) &&
    revision >= 1 &&
    validThreadId(threadId)
    ? { revision, threadId }
    : undefined;
}

function optionalField<Value>(
  record: Record<string, unknown>,
  key: string,
  parse: (input: unknown) => Value | undefined,
): OptionalField<Value> {
  if (record[key] === undefined) return { valid: true };
  const value = parse(record[key]);
  return value === undefined ? { valid: false } : { valid: true, value };
}

function parseToolLoopGuardPolicy(
  input: unknown,
): ToolLoopGuardPolicy | undefined {
  try {
    return normalizeToolLoopGuardPolicy(input as ToolLoopGuardPolicy);
  } catch {
    return undefined;
  }
}

function parsePromptVariableDefinitions(
  input: unknown,
): PromptVariableDefinition[] | undefined {
  if (!Array.isArray(input)) return undefined;
  try {
    return normalizePromptVariableDefinitions(
      input as PromptVariableDefinition[],
    );
  } catch {
    return undefined;
  }
}

function parseModelAdvisorPolicy(
  input: unknown,
): UpdateAgentProfileRequest["modelAdvisor"] | undefined {
  const record = requestRecord(input, [
    "mode",
    "enabledRules",
    "maxCorrectionAttempts",
    "reviewModel",
  ]);
  const mode = record?.["mode"];
  const enabledRules = record?.["enabledRules"];
  const maxCorrectionAttempts = record?.["maxCorrectionAttempts"];
  const reviewModel =
    record?.["reviewModel"] === undefined
      ? undefined
      : parseModelRef(record["reviewModel"]);
  if (
    !record ||
    (mode !== "observe" && mode !== "enforce" && mode !== "off") ||
    !Array.isArray(enabledRules) ||
    enabledRules.length > 10 ||
    !enabledRules.every(
      (rule) =>
        rule === "unverified_verification_claim" ||
        rule === "destructive_command_reference",
    ) ||
    (maxCorrectionAttempts !== undefined &&
      (typeof maxCorrectionAttempts !== "number" ||
        !Number.isSafeInteger(maxCorrectionAttempts) ||
        maxCorrectionAttempts < 0 ||
        maxCorrectionAttempts > 3)) ||
    (record["reviewModel"] !== undefined && !reviewModel)
  ) {
    return undefined;
  }
  return {
    mode,
    enabledRules,
    ...(typeof maxCorrectionAttempts === "number"
      ? { maxCorrectionAttempts }
      : {}),
    ...(reviewModel ? { reviewModel } : {}),
  };
}

function parseThinkingLevel(
  input: unknown,
): UpdateAgentProfileRequest["thinkingLevel"] | undefined {
  return input === "off" ||
    input === "minimal" ||
    input === "low" ||
    input === "medium" ||
    input === "high"
    ? input
    : undefined;
}

function parseToolPolicy(
  input: unknown,
): UpdateAgentProfileRequest["toolPolicy"] | undefined {
  return input === "observe" ||
    input === "workspace" ||
    input === "unrestricted"
    ? input
    : undefined;
}

function parseEnabledTools(input: unknown): string[] | undefined {
  const allowed: ReadonlySet<string> = new Set(AGENT_TOOL_NAMES);
  if (
    !Array.isArray(input) ||
    input.length > allowed.size ||
    input.some((value) => typeof value !== "string" || !allowed.has(value))
  ) {
    return undefined;
  }
  const unique = new Set(input);
  return unique.size === input.length ? [...unique].sort() : undefined;
}

function parseAgentNameArray(
  input: unknown,
  maxItems: number,
): string[] | undefined {
  if (!Array.isArray(input) || input.length > maxItems) return undefined;
  const normalized: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") return undefined;
    const item = value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(item)) return undefined;
    normalized.push(item);
  }
  const unique = new Set(normalized);
  return unique.size === normalized.length ? [...unique].sort() : undefined;
}

function parseEnabledSubagents(
  input: unknown,
): NonNullable<UpdateAgentProfileRequest["enabledSubagents"]> | undefined {
  if (!Array.isArray(input) || input.length > 4) return undefined;
  const allowed = new Set(["researcher", "reviewer", "general", "coder"]);
  if (input.some((value) => typeof value !== "string" || !allowed.has(value))) {
    return undefined;
  }
  const unique = new Set(input);
  return unique.size === input.length
    ? ([...unique].sort() as NonNullable<
        UpdateAgentProfileRequest["enabledSubagents"]
      >)
    : undefined;
}

function parseSubagentLimits(
  input: unknown,
): NonNullable<UpdateAgentProfileRequest["subagentLimits"]> | undefined {
  const record = requestRecord(input, [
    "maxConcurrent",
    "maxTotal",
    "maxTurns",
    "timeoutMs",
  ]);
  const maxConcurrent = parseBoundedInteger(record?.["maxConcurrent"], 1, 8);
  const maxTotal = parseBoundedInteger(record?.["maxTotal"], 1, 24);
  const maxTurns = parseBoundedInteger(record?.["maxTurns"], 1, 32);
  const timeoutMs = parseBoundedInteger(record?.["timeoutMs"], 1_000, 900_000);
  return record &&
    maxConcurrent !== undefined &&
    maxTotal !== undefined &&
    maxTurns !== undefined &&
    timeoutMs !== undefined
    ? { maxConcurrent, maxTotal, maxTurns, timeoutMs }
    : undefined;
}

function parseRunLimits(
  input: unknown,
): NonNullable<UpdateAgentProfileRequest["runLimits"]> | undefined {
  const record = requestRecord(input, [
    "maxTurns",
    "maxTotalTokens",
    "maxCostUsd",
    "timeoutMs",
  ]);
  const maxTurns = parseBoundedInteger(record?.["maxTurns"], 1, 128);
  const maxTotalTokens = parseBoundedInteger(
    record?.["maxTotalTokens"],
    1_000,
    10_000_000,
  );
  const maxCostUsd = parseBoundedFiniteNumber(
    record?.["maxCostUsd"],
    0.01,
    1_000,
  );
  const timeoutMs = parseBoundedInteger(
    record?.["timeoutMs"],
    10_000,
    3_600_000,
  );
  return record &&
    maxTurns !== undefined &&
    maxTotalTokens !== undefined &&
    maxCostUsd !== undefined &&
    timeoutMs !== undefined
    ? { maxTurns, maxTotalTokens, maxCostUsd, timeoutMs }
    : undefined;
}

function parseAutomaticRecoveryPolicy(
  input: unknown,
): NonNullable<UpdateAgentProfileRequest["automaticRecovery"]> | undefined {
  const record = requestRecord(input, ["mode", "maxAttempts", "backoffMs"]);
  const mode = record?.["mode"];
  const maxAttempts = parseBoundedInteger(record?.["maxAttempts"], 1, 3);
  const backoffMs = parseBoundedInteger(
    record?.["backoffMs"],
    1_000,
    3_600_000,
  );
  return record &&
    (mode === "manual" || mode === "safe_read_only") &&
    maxAttempts !== undefined &&
    backoffMs !== undefined
    ? { mode, maxAttempts, backoffMs }
    : undefined;
}

function parseBoundedInteger(
  input: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof input === "number" &&
    Number.isInteger(input) &&
    input >= minimum &&
    input <= maximum
    ? input
    : undefined;
}

function parseBoundedFiniteNumber(
  input: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof input === "number" &&
    Number.isFinite(input) &&
    input >= minimum &&
    input <= maximum
    ? input
    : undefined;
}
