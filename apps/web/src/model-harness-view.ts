import type { RunEvent } from "@napier/contracts";

export type ModelHarnessFamily = "anthropic" | "openai" | "google" | "generic";
export type ModelHarnessIntent = "browser" | "coding" | "data" | "research" | "general";

export interface ModelHarnessView {
  eventSeq: number;
  runId: string;
  harnessId: string;
  family: ModelHarnessFamily;
  promptDialect: "xml-guided" | "instruction-led" | "compact";
  provider: string;
  model: string;
  modelApi: string;
  attempt: number;
  intents: ModelHarnessIntent[];
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

const SHA256 = /^[a-f0-9]{64}$/u;
const HARNESS_ID = /^napier\.model-harness\.(anthropic|openai|google|generic)\.v1$/u;
const FAMILIES = new Set<ModelHarnessFamily>(["anthropic", "openai", "google", "generic"]);
const DIALECTS = new Set<ModelHarnessView["promptDialect"]>(["xml-guided", "instruction-led", "compact"]);
const INTENTS = new Set<ModelHarnessIntent>(["browser", "coding", "data", "research", "general"]);
const SOURCES = new Set<ModelHarnessView["maxRetriesSource"]>(["caller", "harness"]);

export function modelHarnessViews(events: readonly RunEvent[]): ModelHarnessView[] {
  return events.flatMap((event) => {
    const view = modelHarnessView(event);
    return view ? [view] : [];
  });
}

export function latestModelHarnessView(
  events: readonly RunEvent[],
  runId?: string,
): ModelHarnessView | undefined {
  return modelHarnessViews(events).findLast((view) => !runId || view.runId === runId);
}

function modelHarnessView(event: RunEvent): ModelHarnessView | undefined {
  if (event.type !== "model.harness.resolved" || !record(event.payload)) return undefined;
  const payload = event.payload;
  const profile = harnessProfile(payload);
  const tools = harnessTools(payload);
  const retry = harnessRetry(payload);
  const identity = harnessIdentity(payload);
  if (!profile || !tools || !retry || !identity) return undefined;
  return {
    eventSeq: event.seq,
    runId: event.runId,
    ...identity,
    ...profile,
    ...tools,
    ...retry,
  };
}

function harnessProfile(payload: Record<string, unknown>): Pick<
  ModelHarnessView,
  "family" | "promptDialect" | "intents" | "toolSurface"
> | undefined {
  const family = member(payload["family"], FAMILIES);
  const promptDialect = member(payload["promptDialect"], DIALECTS);
  const intents = members(payload["intents"], INTENTS);
  const toolSurface = payload["toolSurface"] === "full" || payload["toolSurface"] === "focused"
    ? payload["toolSurface"]
    : undefined;
  if (!family || !promptDialect || !intents || !toolSurface) return undefined;
  return { family, promptDialect, intents, toolSurface };
}

function harnessTools(payload: Record<string, unknown>): Pick<
  ModelHarnessView,
  | "configuredToolCount" | "activeToolCount" | "activeToolNames" | "omittedToolNames"
  | "configuredToolDefinitionBytes" | "activeToolDefinitionBytes" | "savedToolDefinitionBytes"
> | undefined {
  const activeToolNames = strings(payload["activeToolNames"]);
  const omittedToolNames = strings(payload["omittedToolNames"]);
  const configuredToolCount = integer(payload["configuredToolCount"]);
  const activeToolCount = integer(payload["activeToolCount"]);
  const configuredToolDefinitionBytes = integer(payload["configuredToolDefinitionBytes"]);
  const activeToolDefinitionBytes = integer(payload["activeToolDefinitionBytes"]);
  const savedToolDefinitionBytes = integer(payload["savedToolDefinitionBytes"]);
  if (!activeToolNames || !omittedToolNames || configuredToolCount === undefined || activeToolCount === undefined ||
    configuredToolDefinitionBytes === undefined || activeToolDefinitionBytes === undefined ||
    savedToolDefinitionBytes === undefined) return undefined;
  if (activeToolCount !== activeToolNames.length || configuredToolCount !== activeToolNames.length + omittedToolNames.length ||
    configuredToolDefinitionBytes - activeToolDefinitionBytes !== savedToolDefinitionBytes) return undefined;
  return {
    configuredToolCount, activeToolCount, activeToolNames, omittedToolNames,
    configuredToolDefinitionBytes, activeToolDefinitionBytes, savedToolDefinitionBytes,
  };
}

function harnessRetry(payload: Record<string, unknown>): Pick<
  ModelHarnessView,
  "maxRetries" | "maxRetriesSource" | "maxRetryDelayMs" | "maxRetryDelayMsSource"
> | undefined {
  const maxRetries = integer(payload["maxRetries"]);
  const maxRetryDelayMs = integer(payload["maxRetryDelayMs"]);
  const maxRetriesSource = member(payload["maxRetriesSource"], SOURCES);
  const maxRetryDelayMsSource = member(payload["maxRetryDelayMsSource"], SOURCES);
  if (maxRetries === undefined || maxRetryDelayMs === undefined || !maxRetriesSource || !maxRetryDelayMsSource) return undefined;
  return { maxRetries, maxRetriesSource, maxRetryDelayMs, maxRetryDelayMsSource };
}

function harnessIdentity(payload: Record<string, unknown>): Pick<
  ModelHarnessView,
  "harnessId" | "contentSha256" | "provider" | "model" | "modelApi" | "attempt"
> | undefined {
  const harnessId = text(payload["harnessId"]);
  const contentSha256 = text(payload["contentSha256"]);
  const provider = text(payload["provider"]);
  const model = text(payload["model"]);
  const modelApi = text(payload["modelApi"]);
  const attempt = integer(payload["attempt"]);
  if (!harnessId || !HARNESS_ID.test(harnessId) || !contentSha256 || !SHA256.test(contentSha256)) return undefined;
  if (!provider || !model || !modelApi || attempt === undefined || attempt < 1) return undefined;
  return {
    harnessId,
    contentSha256,
    provider,
    model,
    modelApi,
    attempt,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function integer(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...new Set(value)]
    : undefined;
}

function member<Value extends string>(value: unknown, values: Set<Value>): Value | undefined {
  return typeof value === "string" && values.has(value as Value) ? value as Value : undefined;
}

function members<Value extends string>(value: unknown, values: Set<Value>): Value[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every((item) => member(item, values))
    ? value as Value[]
    : undefined;
}
