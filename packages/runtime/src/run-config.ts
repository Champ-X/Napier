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
  RunExecutionMode,
  SubagentRole,
} from "@napier/contracts";

import {
  DEFAULT_AUTOMATIC_RECOVERY_POLICY,
  DEFAULT_RUN_LIMITS,
  DEFAULT_SUBAGENT_LIMITS,
  effectiveAutomaticRecoveryPolicy,
  normalizeAutomaticRecoveryPolicy,
  normalizeRunLimits,
  normalizeSubagentLimits,
} from "./agents.js";

const SHA256 = /^[a-f0-9]{64}$/;
const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high"]);
const TOOL_POLICIES = new Set(["observe", "workspace", "unrestricted"]);
const SUBAGENT_ROLES = new Set<SubagentRole>([
  "researcher",
  "reviewer",
  "general",
]);
const EXECUTION_MODES = new Set<RunExecutionMode>([
  "standard",
  "safe_read_only_recovery",
]);
const SAFE_RECOVERY_TOOLS = new Set([
  "list_files",
  "read_file",
  "search_files",
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

export function createRunConfigurationFingerprint(
  profile: AgentProfile,
  model: ModelRef = profile.model,
  executionMode: RunExecutionMode = "standard",
  options: { skillCatalogSha256?: string } = {},
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
  const safeRecovery = executionMode === "safe_read_only_recovery";
  const content = {
    schemaVersion: options.skillCatalogSha256 ? (3 as const) : (2 as const),
    agentRevision: profile.revision,
    model: structuredClone(model),
    thinkingLevel: profile.thinkingLevel,
    toolPolicy: safeRecovery ? "observe" : profile.toolPolicy,
    enabledTools: canonicalSet(
      safeRecovery
        ? profile.enabledTools.filter((tool) => SAFE_RECOVERY_TOOLS.has(tool))
        : profile.enabledTools,
    ),
    enabledSkills: canonicalSet(profile.enabledSkills),
    enabledSubagents: safeRecovery
      ? []
      : (canonicalSet(profile.enabledSubagents ?? []) as SubagentRole[]),
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
      ? { skillCatalogSha256: options.skillCatalogSha256 }
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
    schemaVersion === 1
      ? V1_FINGERPRINT_KEYS
      : schemaVersion === 2
        ? V2_FINGERPRINT_KEYS
        : schemaVersion === 3
          ? V3_FINGERPRINT_KEYS
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
    3,
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
    executionMode === "safe_read_only_recovery" &&
    (toolPolicy !== "observe" ||
      enabledSubagents.length > 0 ||
      enabledTools.some((tool) => !SAFE_RECOVERY_TOOLS.has(tool)))
  ) {
    throw new Error(
      "Run configuration fingerprint safe recovery boundary is invalid",
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

export function fingerprintAutomaticRecovery(
  fingerprint: RunConfigurationFingerprint,
): AutomaticRecoveryPolicy {
  return fingerprint.schemaVersion === 2 || fingerprint.schemaVersion === 3
    ? structuredClone(fingerprint.automaticRecovery)
    : structuredClone(DEFAULT_AUTOMATIC_RECOVERY_POLICY);
}

export function fingerprintExecutionMode(
  fingerprint: RunConfigurationFingerprint,
): RunExecutionMode {
  return fingerprint.schemaVersion === 2 || fingerprint.schemaVersion === 3
    ? fingerprint.executionMode
    : "standard";
}

export function fingerprintSkillCatalogSha256(
  fingerprint: RunConfigurationFingerprint,
): string {
  return fingerprint.schemaVersion === 3 ? fingerprint.skillCatalogSha256 : "";
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
