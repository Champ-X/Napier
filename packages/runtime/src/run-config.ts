import { createHash } from "node:crypto";
import type {
  AgentProfile,
  AutomaticRecoveryPolicy,
  ModelRef,
  RunConfigurationDelta,
  RunConfigurationField,
  RunConfigurationFingerprint,
  RunConfigurationFingerprintV1,
  RunConfigurationFingerprintV2,
  RunConfigurationFingerprintV3,
  RunConfigurationFingerprintV4,
  RunConfigurationFingerprintV5,
  RunConfigurationFingerprintV6,
  RunConfigurationFingerprintV7,
  RunConfigurationFingerprintV8,
  RunExecutionMode,
  SubagentRole,
} from "@napier/contracts";
type RunConfigurationFingerprintV9 = Extract<
  RunConfigurationFingerprint,
  { schemaVersion: 9 }
>;

import {
  DEFAULT_RUN_LIMITS,
  DEFAULT_SUBAGENT_LIMITS,
  effectiveAutomaticRecoveryPolicy,
  effectiveModelAdvisorPolicy,
  effectiveToolLoopGuardPolicy,
  normalizeAutomaticRecoveryPolicy,
  normalizeModelAdvisorPolicy,
  normalizeRunLimits,
  normalizeSubagentLimits,
} from "./agents.js";
import {
  fingerprintAutomaticRecovery,
  fingerprintExecutionMode,
  fingerprintModelAdvisor,
  fingerprintModelRoute,
  fingerprintPromptVariableHashes,
  fingerprintSkillCatalogSha256,
  fingerprintToolLoopGuard,
} from "./run-config-accessors.js";
export {
  fingerprintAutomaticRecovery,
  fingerprintExecutionMode,
  fingerprintModelAdvisor,
  fingerprintModelRoute,
  fingerprintSkillCatalogSha256,
} from "./run-config-accessors.js";
import { createPromptVariableCatalog } from "./prompt-variables.js";
import {
  projectRunExecutionCapabilitySurface,
  validRunExecutionCapabilitySurface,
} from "./run-execution-tool-surface.js";
import {
  defaultModelRoutePolicy,
  normalizeModelRoutePolicy,
} from "./model-route-profile.js";
import { normalizeToolLoopGuardPolicy } from "./tool-loop-guard.js";

const SHA256 = /^[a-f0-9]{64}$/;
const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high"]);
const TOOL_POLICIES = new Set(["observe", "workspace", "unrestricted"]);
const SUBAGENT_ROLES = new Set<SubagentRole>([
  "researcher",
  "reviewer",
  "general",
  "coder",
]);
const EXECUTION_MODES = new Set<RunExecutionMode>([
  "standard",
  "environment_degraded_read_only",
  "safe_read_only_recovery",
  "workflow_map_read_only",
  "workflow_loop_read_only",
  "agent_experiment_read_only",
  "model_experiment_single_call",
  "tool_experiment_read_only",
]);
const V1_FINGERPRINT_KEYS = new Set([
  "schemaVersion",
  "agentRevision",
  "model",
  "thinkingLevel",
  "toolPolicy",
  "enabledTools",
  "enabledSkills",
  "enabledSubagents",
  "subagentLimits",
  "runLimits",
  "systemPromptSha256",
  "contentSha256",
]);
const V2_FINGERPRINT_KEYS = new Set([
  ...V1_FINGERPRINT_KEYS,
  "automaticRecovery",
  "executionMode",
]);
const V3_FINGERPRINT_KEYS = new Set([
  ...V2_FINGERPRINT_KEYS,
  "skillCatalogSha256",
]);
const V4_FINGERPRINT_KEYS = new Set([...V3_FINGERPRINT_KEYS, "modelAdvisor"]);
const V5_FINGERPRINT_KEYS = new Set(V4_FINGERPRINT_KEYS);
const V6_FINGERPRINT_KEYS = new Set(V5_FINGERPRINT_KEYS);
const V7_FINGERPRINT_KEYS = new Set([
  ...V6_FINGERPRINT_KEYS,
  "promptVariableCatalogSha256",
  "promptVariableSnapshotSha256",
  "resolvedSystemPromptSha256",
]);
const V8_FINGERPRINT_KEYS = new Set([...V7_FINGERPRINT_KEYS, "toolLoopGuard"]);
const V9_FINGERPRINT_KEYS = new Set([...V8_FINGERPRINT_KEYS, "modelRoute"]);
const FINGERPRINT_KEYS = new Map<number, ReadonlySet<string>>([
  [1, V1_FINGERPRINT_KEYS],
  [2, V2_FINGERPRINT_KEYS],
  [3, V3_FINGERPRINT_KEYS],
  [4, V4_FINGERPRINT_KEYS],
  [5, V5_FINGERPRINT_KEYS],
  [6, V6_FINGERPRINT_KEYS],
  [7, V7_FINGERPRINT_KEYS],
  [8, V8_FINGERPRINT_KEYS],
  [9, V9_FINGERPRINT_KEYS],
]);

type FingerprintV1Content = Omit<
  RunConfigurationFingerprintV1,
  "contentSha256"
>;
type FingerprintV2Content = Omit<
  RunConfigurationFingerprintV2,
  "contentSha256"
>;
type FingerprintV3Content = Omit<
  RunConfigurationFingerprintV3,
  "contentSha256"
>;
type FingerprintV4Content = Omit<
  RunConfigurationFingerprintV4,
  "contentSha256"
>;
type FingerprintV5Content = Omit<
  RunConfigurationFingerprintV5,
  "contentSha256"
>;
type FingerprintV6Content = Omit<
  RunConfigurationFingerprintV6,
  "contentSha256"
>;
type FingerprintV7Content = Omit<
  RunConfigurationFingerprintV7,
  "contentSha256"
>;
type FingerprintV8Content = Omit<
  RunConfigurationFingerprintV8,
  "contentSha256"
>;
type FingerprintV9Content = Omit<
  RunConfigurationFingerprintV9,
  "contentSha256"
>;

export interface PromptVariableFingerprintInput {
  catalogSha256: string;
  snapshotSha256: string;
  renderedSystemPromptSha256: string;
}

export interface RunConfigurationFingerprintOptions {
  skillCatalogSha256?: string;
  promptVariables?: PromptVariableFingerprintInput;
}

export function createRunConfigurationFingerprint(
  profile: AgentProfile,
  model: ModelRef = profile.model,
  executionMode: RunExecutionMode = "standard",
  options: RunConfigurationFingerprintOptions = {},
): RunConfigurationFingerprint {
  if (!EXECUTION_MODES.has(executionMode)) {
    throw new Error("Run execution mode is invalid");
  }
  if (
    options.skillCatalogSha256 !== undefined &&
    !SHA256.test(options.skillCatalogSha256)
  ) {
    throw new Error("Run configuration skill catalog hash is invalid");
  }
  if (options.promptVariables && !options.skillCatalogSha256) {
    throw new Error(
      "Run configuration prompt variables require a Skill catalog hash",
    );
  }
  for (const [label, value] of Object.entries(options.promptVariables ?? {})) {
    if (!SHA256.test(value)) {
      throw new Error(
        `Run configuration prompt variable ${label} hash is invalid`,
      );
    }
  }
  if (
    options.promptVariables &&
    options.promptVariables.catalogSha256 !==
      createPromptVariableCatalog(profile.promptVariables).contentSha256
  ) {
    throw new Error(
      "Run configuration Prompt Variable catalog does not match the Agent profile",
    );
  }
  const executionSurface = projectRunExecutionCapabilitySurface(
    profile,
    executionMode,
  );
  const singleModelCall = executionMode === "model_experiment_single_call";
  const modelAdvisor = effectiveModelAdvisorPolicy(profile);
  const toolLoopGuard = effectiveToolLoopGuardPolicy(profile);
  const modelRoute = normalizeModelRoutePolicy(
    profile.modelRoute ?? defaultModelRoutePolicy(model),
  );
  const content = {
    schemaVersion: options.promptVariables
      ? (9 as const)
      : options.skillCatalogSha256
        ? modelAdvisor.reviewModel
          ? (6 as const)
          : (5 as const)
        : (2 as const),
    agentRevision: profile.revision,
    model: structuredClone(model),
    thinkingLevel: profile.thinkingLevel,
    toolPolicy: executionSurface.toolPolicy,
    enabledTools: canonicalSet(executionSurface.enabledTools),
    enabledSkills: singleModelCall ? [] : canonicalSet(profile.enabledSkills),
    enabledSubagents: canonicalSet(
      executionSurface.enabledSubagents,
    ) as SubagentRole[],
    subagentLimits: normalizeSubagentLimits(
      profile.subagentLimits ?? structuredClone(DEFAULT_SUBAGENT_LIMITS),
    ),
    runLimits: normalizeRunLimits(
      profile.runLimits ?? structuredClone(DEFAULT_RUN_LIMITS),
    ),
    systemPromptSha256: sha256(profile.systemPrompt),
    automaticRecovery: effectiveAutomaticRecoveryPolicy(profile),
    executionMode,
    ...(options.skillCatalogSha256
      ? {
          skillCatalogSha256: options.skillCatalogSha256,
          modelAdvisor,
        }
      : {}),
    ...(options.promptVariables
      ? {
          promptVariableCatalogSha256: options.promptVariables.catalogSha256,
          promptVariableSnapshotSha256: options.promptVariables.snapshotSha256,
          resolvedSystemPromptSha256:
            options.promptVariables.renderedSystemPromptSha256,
          toolLoopGuard,
          modelRoute,
        }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  } as RunConfigurationFingerprint;
}

export function validateRunConfigurationFingerprint(
  input: unknown,
): RunConfigurationFingerprint {
  const record = assertRecord(input, "Run configuration fingerprint");
  const schemaVersion = record["schemaVersion"];
  const keys =
    typeof schemaVersion === "number"
      ? FINGERPRINT_KEYS.get(schemaVersion)
      : undefined;
  if (!keys) {
    throw new Error("Run configuration fingerprint schema is unsupported");
  }
  for (const key of keys) {
    if (!(key in record)) {
      throw new Error(`Run configuration fingerprint is missing ${key}`);
    }
  }
  for (const key of Object.keys(record)) {
    if (!keys.has(key)) {
      throw new Error(
        `Run configuration fingerprint has unsupported field: ${key}`,
      );
    }
  }
  const agentRevision = positiveInteger(
    record["agentRevision"],
    "agentRevision",
  );
  const model = assertModel(record["model"]);
  const thinkingLevel = assertEnum(
    record["thinkingLevel"],
    THINKING_LEVELS,
    "thinkingLevel",
  ) as AgentProfile["thinkingLevel"];
  const toolPolicy = assertEnum(
    record["toolPolicy"],
    TOOL_POLICIES,
    "toolPolicy",
  ) as AgentProfile["toolPolicy"];
  const enabledTools = assertCanonicalStringArray(
    record["enabledTools"],
    "enabledTools",
    100,
    NAME,
  );
  const enabledSkills = assertCanonicalStringArray(
    record["enabledSkills"],
    "enabledSkills",
    1_000,
    NAME,
  );
  const enabledSubagents = assertCanonicalStringArray(
    record["enabledSubagents"],
    "enabledSubagents",
    4,
  ).map((role) => {
    if (!SUBAGENT_ROLES.has(role as SubagentRole)) {
      throw new Error(
        `Run configuration fingerprint enabledSubagents is invalid`,
      );
    }
    return role as SubagentRole;
  });
  const subagentLimits = assertSubagentLimits(record["subagentLimits"]);
  const runLimits = assertRunLimits(record["runLimits"]);
  const systemPromptSha256 = assertSha256(
    record["systemPromptSha256"],
    "systemPromptSha256",
  );
  const contentSha256 = assertSha256(record["contentSha256"], "contentSha256");
  const shared = {
    agentRevision,
    model,
    thinkingLevel,
    toolPolicy,
    enabledTools,
    enabledSkills,
    enabledSubagents,
    subagentLimits,
    runLimits,
    systemPromptSha256,
  };
  if (schemaVersion === 1) {
    const content: FingerprintV1Content = {
      schemaVersion: 1,
      ...shared,
    };
    if (sha256(canonicalJson(content)) !== contentSha256) {
      throw new Error("Run configuration fingerprint hash mismatch");
    }
    return { ...content, contentSha256 };
  }
  const automaticRecovery = assertAutomaticRecoveryPolicy(
    record["automaticRecovery"],
  );
  const executionMode = assertEnum(
    record["executionMode"],
    EXECUTION_MODES,
    "executionMode",
  ) as RunExecutionMode;
  if (
    !validRunExecutionCapabilitySurface({
      mode: executionMode,
      toolPolicy,
      enabledTools,
      enabledSubagents,
    })
  ) {
    throw new Error(
      "Run configuration fingerprint read-only boundary is invalid",
    );
  }
  const modernShared = {
    ...shared,
    automaticRecovery,
    executionMode,
  };
  if (schemaVersion === 2) {
    const content: FingerprintV2Content = {
      schemaVersion: 2,
      ...modernShared,
    };
    if (sha256(canonicalJson(content)) !== contentSha256) {
      throw new Error("Run configuration fingerprint hash mismatch");
    }
    return { ...content, contentSha256 };
  }
  const skillCatalogSha256 = assertSha256(
    record["skillCatalogSha256"],
    "skillCatalogSha256",
  );
  if (schemaVersion === 3) {
    const content: FingerprintV3Content = {
      schemaVersion: 3,
      ...modernShared,
      skillCatalogSha256,
    };
    if (sha256(canonicalJson(content)) !== contentSha256) {
      throw new Error("Run configuration fingerprint hash mismatch");
    }
    return { ...content, contentSha256 };
  }
  if (schemaVersion === 4) {
    const modelAdvisor = assertLegacyModelAdvisorPolicy(record["modelAdvisor"]);
    const content: FingerprintV4Content = {
      schemaVersion: 4,
      ...modernShared,
      skillCatalogSha256,
      modelAdvisor,
    };
    if (sha256(canonicalJson(content)) !== contentSha256) {
      throw new Error("Run configuration fingerprint hash mismatch");
    }
    return { ...content, contentSha256 };
  }
  const modelAdvisor =
    schemaVersion === 5
      ? assertLegacyResolvedModelAdvisorPolicy(record["modelAdvisor"])
      : assertModelAdvisorPolicy(record["modelAdvisor"]);
  if (schemaVersion === 6 && !modelAdvisor.reviewModel) {
    throw new Error(
      "Run configuration fingerprint schema 6 requires a review model",
    );
  }
  if (schemaVersion === 7) {
    const content: FingerprintV7Content = {
      schemaVersion: 7,
      ...modernShared,
      skillCatalogSha256,
      modelAdvisor,
      promptVariableCatalogSha256: assertSha256(
        record["promptVariableCatalogSha256"],
        "promptVariableCatalogSha256",
      ),
      promptVariableSnapshotSha256: assertSha256(
        record["promptVariableSnapshotSha256"],
        "promptVariableSnapshotSha256",
      ),
      resolvedSystemPromptSha256: assertSha256(
        record["resolvedSystemPromptSha256"],
        "resolvedSystemPromptSha256",
      ),
    };
    if (sha256(canonicalJson(content)) !== contentSha256) {
      throw new Error("Run configuration fingerprint hash mismatch");
    }
    return { ...content, contentSha256 };
  }
  if (schemaVersion === 8 || schemaVersion === 9) {
    const promptConfiguration = {
      ...modernShared,
      skillCatalogSha256,
      modelAdvisor,
      promptVariableCatalogSha256: assertSha256(
        record["promptVariableCatalogSha256"],
        "promptVariableCatalogSha256",
      ),
      promptVariableSnapshotSha256: assertSha256(
        record["promptVariableSnapshotSha256"],
        "promptVariableSnapshotSha256",
      ),
      resolvedSystemPromptSha256: assertSha256(
        record["resolvedSystemPromptSha256"],
        "resolvedSystemPromptSha256",
      ),
      toolLoopGuard: assertToolLoopGuardPolicy(record["toolLoopGuard"]),
    };
    const content: FingerprintV8Content | FingerprintV9Content =
      schemaVersion === 8
        ? { schemaVersion: 8, ...promptConfiguration }
        : {
            schemaVersion: 9,
            ...promptConfiguration,
            modelRoute: assertModelRoutePolicy(record["modelRoute"]),
          };
    if (sha256(canonicalJson(content)) !== contentSha256) {
      throw new Error("Run configuration fingerprint hash mismatch");
    }
    return { ...content, contentSha256 };
  }
  const content: FingerprintV5Content | FingerprintV6Content =
    schemaVersion === 5
      ? {
          schemaVersion: 5,
          ...modernShared,
          skillCatalogSha256,
          modelAdvisor,
        }
      : {
          schemaVersion: 6,
          ...modernShared,
          skillCatalogSha256,
          modelAdvisor,
        };
  if (sha256(canonicalJson(content)) !== contentSha256) {
    throw new Error("Run configuration fingerprint hash mismatch");
  }
  return { ...content, contentSha256 };
}

export function compareRunConfigurations(
  left: RunConfigurationFingerprint | undefined,
  right: RunConfigurationFingerprint | undefined,
): RunConfigurationDelta {
  if (!left || !right) {
    return {
      status: "unavailable",
      ...(left ? { leftSha256: left.contentSha256 } : {}),
      ...(right ? { rightSha256: right.contentSha256 } : {}),
      changedFields: [],
      addedTools: [],
      removedTools: [],
      addedSkills: [],
      removedSkills: [],
      addedSubagents: [],
      removedSubagents: [],
    };
  }
  const changedFields: RunConfigurationField[] = [];
  if (left.agentRevision !== right.agentRevision) {
    changedFields.push("agentRevision");
  }
  if (!same(left.model, right.model)) changedFields.push("model");
  if (left.systemPromptSha256 !== right.systemPromptSha256) {
    changedFields.push("systemPrompt");
  }
  if (left.thinkingLevel !== right.thinkingLevel) {
    changedFields.push("thinkingLevel");
  }
  if (left.toolPolicy !== right.toolPolicy) changedFields.push("toolPolicy");
  if (!same(left.enabledTools, right.enabledTools)) {
    changedFields.push("enabledTools");
  }
  if (!same(left.enabledSkills, right.enabledSkills)) {
    changedFields.push("enabledSkills");
  }
  if (!same(left.enabledSubagents, right.enabledSubagents)) {
    changedFields.push("enabledSubagents");
  }
  if (!same(left.subagentLimits, right.subagentLimits)) {
    changedFields.push("subagentLimits");
  }
  if (!same(left.runLimits, right.runLimits)) {
    changedFields.push("runLimits");
  }
  if (
    !same(
      fingerprintAutomaticRecovery(left),
      fingerprintAutomaticRecovery(right),
    )
  ) {
    changedFields.push("automaticRecovery");
  }
  if (fingerprintExecutionMode(left) !== fingerprintExecutionMode(right)) {
    changedFields.push("executionMode");
  }
  if (
    fingerprintSkillCatalogSha256(left) !== fingerprintSkillCatalogSha256(right)
  ) {
    changedFields.push("skillCatalog");
  }
  if (!same(fingerprintModelAdvisor(left), fingerprintModelAdvisor(right))) {
    changedFields.push("modelAdvisor");
  }
  if (
    !same(
      fingerprintPromptVariableHashes(left),
      fingerprintPromptVariableHashes(right),
    )
  ) {
    changedFields.push("promptVariables");
  }
  if (!same(fingerprintToolLoopGuard(left), fingerprintToolLoopGuard(right))) {
    changedFields.push("toolLoopGuard");
  }
  if (!same(fingerprintModelRoute(left), fingerprintModelRoute(right))) {
    changedFields.push("modelRoute");
  }
  return {
    status: "comparable",
    leftSha256: left.contentSha256,
    rightSha256: right.contentSha256,
    changedFields,
    addedTools: added(left.enabledTools, right.enabledTools),
    removedTools: added(right.enabledTools, left.enabledTools),
    addedSkills: added(left.enabledSkills, right.enabledSkills),
    removedSkills: added(right.enabledSkills, left.enabledSkills),
    addedSubagents: added(
      left.enabledSubagents,
      right.enabledSubagents,
    ) as SubagentRole[],
    removedSubagents: added(
      right.enabledSubagents,
      left.enabledSubagents,
    ) as SubagentRole[],
  };
}

function assertModelRoutePolicy(
  value: unknown,
): RunConfigurationFingerprintV9["modelRoute"] {
  const input = value as RunConfigurationFingerprintV9["modelRoute"];
  const normalized = normalizeModelRoutePolicy(input);
  if (JSON.stringify(input) !== JSON.stringify(normalized)) {
    throw new Error(
      "Run configuration fingerprint Model Route policy is not canonical",
    );
  }
  return normalized;
}

function assertToolLoopGuardPolicy(
  value: unknown,
): RunConfigurationFingerprintV8["toolLoopGuard"] {
  if (value === undefined) {
    throw new Error(
      "Run configuration fingerprint Tool Loop Guard policy is invalid",
    );
  }
  const input = value as RunConfigurationFingerprintV8["toolLoopGuard"];
  const normalized = normalizeToolLoopGuardPolicy(input);
  if (
    JSON.stringify(input.exemptTools) !== JSON.stringify(normalized.exemptTools)
  ) {
    throw new Error(
      "Run configuration fingerprint Tool Loop Guard policy is not canonical",
    );
  }
  return normalized;
}

function assertModel(value: unknown): ModelRef {
  const model = assertExactRecord(
    value,
    "Run configuration fingerprint model",
    ["provider", "id"],
  );
  const provider = model["provider"];
  const id = model["id"];
  if (
    typeof provider !== "string" ||
    !PROVIDER_ID.test(provider) ||
    typeof id !== "string" ||
    !id ||
    id.length > 200 ||
    /[\u0000-\u001f\u007f<>\s]/.test(id)
  ) {
    throw new Error("Run configuration fingerprint model is invalid");
  }
  return { provider, id };
}

function assertAutomaticRecoveryPolicy(
  value: unknown,
): AutomaticRecoveryPolicy {
  const policy = assertExactRecord(
    value,
    "Run configuration fingerprint automaticRecovery",
    ["mode", "maxAttempts", "backoffMs"],
  );
  return normalizeAutomaticRecoveryPolicy({
    mode: assertEnum(
      policy["mode"],
      new Set(["manual", "safe_read_only"]),
      "automaticRecovery.mode",
    ) as AutomaticRecoveryPolicy["mode"],
    maxAttempts: positiveInteger(
      policy["maxAttempts"],
      "automaticRecovery.maxAttempts",
    ),
    backoffMs: positiveInteger(
      policy["backoffMs"],
      "automaticRecovery.backoffMs",
    ),
  });
}

function assertSubagentLimits(
  value: unknown,
): RunConfigurationFingerprint["subagentLimits"] {
  const limits = assertExactRecord(
    value,
    "Run configuration fingerprint subagentLimits",
    ["maxConcurrent", "maxTotal", "maxTurns", "timeoutMs"],
  );
  return normalizeSubagentLimits({
    maxConcurrent: positiveInteger(
      limits["maxConcurrent"],
      "subagentLimits.maxConcurrent",
    ),
    maxTotal: positiveInteger(limits["maxTotal"], "subagentLimits.maxTotal"),
    maxTurns: positiveInteger(limits["maxTurns"], "subagentLimits.maxTurns"),
    timeoutMs: positiveInteger(limits["timeoutMs"], "subagentLimits.timeoutMs"),
  });
}

function assertRunLimits(
  value: unknown,
): RunConfigurationFingerprint["runLimits"] {
  const limits = assertExactRecord(
    value,
    "Run configuration fingerprint runLimits",
    ["maxTurns", "maxTotalTokens", "maxCostUsd", "timeoutMs"],
  );
  const maxCostUsd = limits["maxCostUsd"];
  if (typeof maxCostUsd !== "number" || !Number.isFinite(maxCostUsd)) {
    throw new Error(
      "Run configuration fingerprint runLimits.maxCostUsd is invalid",
    );
  }
  return normalizeRunLimits({
    maxTurns: positiveInteger(limits["maxTurns"], "runLimits.maxTurns"),
    maxTotalTokens: positiveInteger(
      limits["maxTotalTokens"],
      "runLimits.maxTotalTokens",
    ),
    maxCostUsd,
    timeoutMs: positiveInteger(limits["timeoutMs"], "runLimits.timeoutMs"),
  });
}

function assertLegacyModelAdvisorPolicy(
  value: unknown,
): RunConfigurationFingerprintV4["modelAdvisor"] {
  const policy = assertExactRecord(
    value,
    "Run configuration fingerprint modelAdvisor",
    ["mode", "enabledRules"],
  );
  const mode = assertEnum(
    policy["mode"],
    new Set(["observe", "enforce", "off"]),
    "modelAdvisor.mode",
  ) as "observe" | "enforce" | "off";
  const enabledRules = assertCanonicalStringArray(
    policy["enabledRules"],
    "modelAdvisor.enabledRules",
    10,
    /^[a-z][a-z0-9_]{2,80}$/,
  );
  normalizeModelAdvisorPolicy({
    mode,
    enabledRules: enabledRules as Parameters<
      typeof normalizeModelAdvisorPolicy
    >[0]["enabledRules"],
  });
  return {
    mode,
    enabledRules:
      enabledRules as RunConfigurationFingerprintV4["modelAdvisor"]["enabledRules"],
  };
}

function assertLegacyResolvedModelAdvisorPolicy(value: unknown) {
  const policy = assertExactRecord(
    value,
    "Run configuration fingerprint modelAdvisor",
    ["mode", "enabledRules", "maxCorrectionAttempts"],
  );
  const maxCorrectionAttempts = policy["maxCorrectionAttempts"];
  if (
    !Number.isSafeInteger(maxCorrectionAttempts) ||
    Number(maxCorrectionAttempts) < 0 ||
    Number(maxCorrectionAttempts) > 3
  ) {
    throw new Error(
      "Run configuration fingerprint modelAdvisor.maxCorrectionAttempts is invalid",
    );
  }
  return normalizeModelAdvisorPolicy({
    ...assertLegacyModelAdvisorPolicy({
      mode: policy["mode"],
      enabledRules: policy["enabledRules"],
    }),
    maxCorrectionAttempts: Number(maxCorrectionAttempts),
  });
}

function assertModelAdvisorPolicy(value: unknown) {
  const policy = assertRecord(
    value,
    "Run configuration fingerprint modelAdvisor",
  );
  const requiredKeys = [
    "mode",
    "enabledRules",
    "maxCorrectionAttempts",
  ] as const;
  const allowedKeys = new Set([...requiredKeys, "reviewModel"]);
  if (
    requiredKeys.some((key) => !(key in policy)) ||
    Object.keys(policy).some((key) => !allowedKeys.has(key))
  ) {
    throw new Error(
      "Run configuration fingerprint modelAdvisor fields are invalid",
    );
  }
  const legacy = assertLegacyResolvedModelAdvisorPolicy({
    mode: policy["mode"],
    enabledRules: policy["enabledRules"],
    maxCorrectionAttempts: policy["maxCorrectionAttempts"],
  });
  const reviewModel =
    policy["reviewModel"] === undefined
      ? undefined
      : assertModel(policy["reviewModel"]);
  return normalizeModelAdvisorPolicy({
    ...legacy,
    ...(reviewModel ? { reviewModel } : {}),
  });
}

function assertCanonicalStringArray(
  value: unknown,
  label: string,
  maximum: number,
  pattern?: RegExp,
): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`Run configuration fingerprint ${label} is invalid`);
  }
  const entries = value.map((entry) => {
    if (
      typeof entry !== "string" ||
      !entry ||
      entry.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(entry) ||
      (pattern && !pattern.test(entry))
    ) {
      throw new Error(`Run configuration fingerprint ${label} is invalid`);
    }
    return entry;
  });
  if (!same(entries, canonicalSet(entries))) {
    throw new Error(`Run configuration fingerprint ${label} is not canonical`);
  }
  return entries;
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactRecord(
  value: unknown,
  label: string,
  keys: string[],
): Record<string, unknown> {
  const record = assertRecord(value, label);
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !(key in record))
  ) {
    throw new Error(`${label} fields are invalid`);
  }
  return record;
}

function assertEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`Run configuration fingerprint ${label} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Run configuration fingerprint ${label} is invalid`);
  }
  return Number(value);
}

function assertSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`Run configuration fingerprint ${label} is invalid`);
  }
  return value;
}

function canonicalSet<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function added<T extends string>(left: readonly T[], right: readonly T[]): T[] {
  const leftSet = new Set(left);
  return right.filter((value) => !leftSet.has(value));
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
