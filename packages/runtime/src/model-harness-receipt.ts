import { canonicalJson, sha256 } from "./ed25519.js";
import {
  MODEL_HARNESS_RESOLUTION_ID,
  MODEL_HARNESS_RULE_SET_VERSION,
  type ModelHarnessEnvironmentCapability,
  type ModelHarnessFamily,
  type ModelHarnessProfile,
  type ModelHarnessResolution,
  type ModelHarnessTaskPhase,
} from "./model-harness-resolution.js";

export type ModelHarnessIntent = ModelHarnessTaskPhase;

export interface ModelHarnessResolutionReceipt {
  kind: "napier.model-harness-resolution";
  schemaVersion: 2;
  harnessId: ModelHarnessResolution["resolutionId"];
  baseHarnessId: ModelHarnessProfile["id"];
  ruleSetVersion: ModelHarnessResolution["ruleSetVersion"];
  matchedRuleId: string;
  policySource: ModelHarnessResolution["policySource"];
  family: ModelHarnessFamily;
  promptDialect: ModelHarnessProfile["promptDialect"];
  provider: string;
  model: string;
  modelApi: string;
  attempt: number;
  intents: ModelHarnessIntent[];
  taskPhase: ModelHarnessTaskPhase;
  environmentCapabilities: ModelHarnessEnvironmentCapability[];
  guidanceSha256: string;
  toolSurface: "full" | "focused";
  configuredToolCount: number;
  activeToolCount: number;
  activeToolNames: string[];
  omittedToolNames: string[];
  configuredToolDefinitionBytes: number;
  activeToolDefinitionBytes: number;
  savedToolDefinitionBytes: number;
  maxRetries: number;
  maxRetriesSource: "caller" | "harness";
  maxRetryDelayMs: number;
  maxRetryDelayMsSource: "caller" | "harness";
  contentSha256: string;
}

const RECEIPT_KEYS = new Set<keyof ModelHarnessResolutionReceipt>([
  "kind",
  "schemaVersion",
  "harnessId",
  "baseHarnessId",
  "ruleSetVersion",
  "matchedRuleId",
  "policySource",
  "family",
  "promptDialect",
  "provider",
  "model",
  "modelApi",
  "attempt",
  "intents",
  "taskPhase",
  "environmentCapabilities",
  "guidanceSha256",
  "toolSurface",
  "configuredToolCount",
  "activeToolCount",
  "activeToolNames",
  "omittedToolNames",
  "configuredToolDefinitionBytes",
  "activeToolDefinitionBytes",
  "savedToolDefinitionBytes",
  "maxRetries",
  "maxRetriesSource",
  "maxRetryDelayMs",
  "maxRetryDelayMsSource",
  "contentSha256",
]);
const FAMILIES = new Set<ModelHarnessFamily>([
  "anthropic",
  "openai",
  "google",
  "generic",
]);
const DIALECTS = new Set<ModelHarnessProfile["promptDialect"]>([
  "xml-guided",
  "instruction-led",
  "compact",
]);
const PHASES = new Set<ModelHarnessTaskPhase>([
  "browser",
  "coding",
  "data",
  "research",
  "general",
]);
const CAPABILITIES = new Set<ModelHarnessEnvironmentCapability>([
  "browser",
  "workspace_write",
  "process",
  "code_kernel",
  "mcp",
]);
const RETRY_SOURCES = new Set(["caller", "harness"]);
const POLICY_SOURCES = new Set(["family", "model_rule"]);
const SHA256 = /^[a-f0-9]{64}$/u;
const RULE_ID = /^[a-z][a-z0-9.-]{2,79}$/u;

export function parseModelHarnessResolutionReceipt(
  value: unknown,
): ModelHarnessResolutionReceipt | undefined {
  if (!exactReceiptRecord(value)) return undefined;
  if (
    !validIdentity(value) ||
    !validResolution(value) ||
    !validToolProjection(value) ||
    !validRetryPolicy(value)
  )
    return undefined;
  const { contentSha256, ...content } = value;
  return sha256(canonicalJson(content)) === contentSha256
    ? (value as unknown as ModelHarnessResolutionReceipt)
    : undefined;
}

function exactReceiptRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === RECEIPT_KEYS.size &&
    keys.every((key) =>
      RECEIPT_KEYS.has(key as keyof ModelHarnessResolutionReceipt),
    )
  );
}

function validIdentity(value: Record<string, unknown>): boolean {
  const family = member(value.family, FAMILIES);
  return (
    value.kind === "napier.model-harness-resolution" &&
    value.schemaVersion === 2 &&
    value.harnessId === MODEL_HARNESS_RESOLUTION_ID &&
    value.ruleSetVersion === MODEL_HARNESS_RULE_SET_VERSION &&
    Boolean(family) &&
    value.baseHarnessId === `napier.model-harness.${family}.v1` &&
    member(value.promptDialect, DIALECTS) === expectedDialect(family!) &&
    Boolean(text(value.provider)) &&
    Boolean(text(value.model)) &&
    Boolean(text(value.modelApi)) &&
    positiveInteger(value.attempt) &&
    SHA256.test(text(value.contentSha256) ?? "")
  );
}

function validResolution(value: Record<string, unknown>): boolean {
  const matchedRuleId = text(value.matchedRuleId);
  const policySource = member(value.policySource, POLICY_SOURCES);
  const taskPhase = member(value.taskPhase, PHASES);
  const intents = members(value.intents, PHASES);
  return (
    Boolean(matchedRuleId && RULE_ID.test(matchedRuleId)) &&
    Boolean(policySource) &&
    (policySource === "family") === (matchedRuleId === "family-fallback") &&
    Boolean(taskPhase) &&
    intents?.length === 1 &&
    intents[0] === taskPhase &&
    Boolean(members(value.environmentCapabilities, CAPABILITIES)) &&
    SHA256.test(text(value.guidanceSha256) ?? "")
  );
}

function validToolProjection(value: Record<string, unknown>): boolean {
  const active = strings(value.activeToolNames);
  const omitted = strings(value.omittedToolNames);
  if (!active || !omitted || !disjoint(active, omitted)) return false;
  if (
    !nonNegativeInteger(value.configuredToolCount) ||
    value.configuredToolCount !== active.length + omitted.length ||
    !nonNegativeInteger(value.activeToolCount) ||
    value.activeToolCount !== active.length
  )
    return false;
  if (
    !nonNegativeInteger(value.configuredToolDefinitionBytes) ||
    !nonNegativeInteger(value.activeToolDefinitionBytes) ||
    !nonNegativeInteger(value.savedToolDefinitionBytes) ||
    value.configuredToolDefinitionBytes - value.activeToolDefinitionBytes !==
      value.savedToolDefinitionBytes
  )
    return false;
  return (
    (value.toolSurface === "full" || value.toolSurface === "focused") &&
    (value.toolSurface === "full") === (omitted.length === 0)
  );
}

function validRetryPolicy(value: Record<string, unknown>): boolean {
  return (
    nonNegativeInteger(value.maxRetries) &&
    Boolean(member(value.maxRetriesSource, RETRY_SOURCES)) &&
    nonNegativeInteger(value.maxRetryDelayMs) &&
    Boolean(member(value.maxRetryDelayMsSource, RETRY_SOURCES))
  );
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return nonNegativeInteger(value) && value > 0;
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) &&
    value.every((item) => text(item)) &&
    new Set(value).size === value.length
    ? (value as string[])
    : undefined;
}

function members<Value extends string>(
  value: unknown,
  allowed: Set<Value>,
): Value[] | undefined {
  return Array.isArray(value) &&
    value.every((item) => member(item, allowed)) &&
    new Set(value).size === value.length
    ? (value as Value[])
    : undefined;
}

function member<Value extends string>(
  value: unknown,
  allowed: Set<Value>,
): Value | undefined {
  return typeof value === "string" && allowed.has(value as Value)
    ? (value as Value)
    : undefined;
}

function disjoint(left: readonly string[], right: readonly string[]): boolean {
  const rightSet = new Set(right);
  return left.every((item) => !rightSet.has(item));
}

function expectedDialect(
  family: ModelHarnessFamily,
): ModelHarnessProfile["promptDialect"] {
  return family === "anthropic"
    ? "xml-guided"
    : family === "generic"
      ? "compact"
      : "instruction-led";
}
