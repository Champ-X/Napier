import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { RunEvent, RunRecord } from "@napier/contracts";

import { toJsonValue } from "./agent-runtime-utils.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { EventSink } from "./event-sink.js";
import { validateModelContextEnvelopeReceipt } from "./model-context-envelope.js";
import type { LocalStore } from "./store.js";
import type { TokenCalibrationObservation } from "./token-meter-calibration.js";
import type { TokenMeterRegistry } from "./token-meter-provider.js";

export const MODEL_CONTEXT_TOKEN_CALIBRATION_EVENT =
  "model.context.token_calibration" as const;

const hydrationTasks = new WeakMap<
  TokenMeterRegistry,
  WeakMap<LocalStore, Promise<void>>
>();

export interface ModelContextTokenCalibrationReceipt {
  kind: "napier.model-context-token-calibration";
  schemaVersion: 1;
  status: "calibrated" | "unavailable";
  provider: string;
  model: string;
  contentClass: "text" | "structured" | "multimodal";
  meterProviderId: string;
  estimateMethod: string;
  baseEstimatedInputTokens: number;
  estimatedInputTokens: number;
  actualInputTokens: number;
  underestimateTokens: number;
  underestimateRatio: number;
  absoluteErrorRatio: number;
  safetyFactorBeforePpm: number;
  safetyFactorAfterPpm: number;
  sampleCount: number;
  pressureContentSha256: string;
  modelContextEnvelopeSha256: string;
  modelContextEnvelopeTurnIndex: number;
  modelContextMessageSetSha256: string;
  modelContextToolDefinitionSetSha256: string;
  unavailableReason?: "provider_usage_unavailable";
  contentSha256: string;
}

export async function calibrateResponse(
  host: { store: LocalStore; tokenMeters: TokenMeterRegistry },
  run: RunRecord,
  responseEvent: RunEvent,
  message: AssistantMessage,
  onEvent?: EventSink,
): Promise<void> {
  await recordModelContextTokenCalibration({
    store: host.store,
    registry: host.tokenMeters,
    threadId: run.threadId,
    runId: run.id,
    responseEvent,
    provider: message.provider,
    model: message.model,
    actualInputTokens:
      message.usage.input + message.usage.cacheRead + message.usage.cacheWrite,
    ...(onEvent ? { onEvent } : {}),
  }).catch(() => undefined);
}

export async function hydrateTokenCalibrationRegistry(
  store: LocalStore,
  registry: TokenMeterRegistry,
): Promise<void> {
  const stores =
    hydrationTasks.get(registry) ?? new WeakMap<LocalStore, Promise<void>>();
  const existing = stores.get(store);
  if (existing) return existing;
  const task = hydrateFromLedger(store, registry);
  stores.set(store, task);
  hydrationTasks.set(registry, stores);
  try {
    await task;
  } catch (error) {
    stores.delete(store);
    throw error;
  }
}

export async function recordModelContextTokenCalibration(input: {
  store: LocalStore;
  registry: TokenMeterRegistry;
  threadId: string;
  runId: string;
  responseEvent: RunEvent;
  provider: string;
  model: string;
  actualInputTokens: number;
  onEvent?: EventSink;
}): Promise<ModelContextTokenCalibrationReceipt | undefined> {
  const pressure = await boundPressure(input);
  if (!pressure) return undefined;
  let observation: TokenCalibrationObservation;
  try {
    observation = pressureObservation(
      pressure,
      input.provider,
      input.model,
      input.actualInputTokens,
    );
  } catch {
    // Calibration is derived evidence and must never change call semantics.
    return undefined;
  }
  const before = input.registry.calibration.snapshot(observation);
  const usable = input.actualInputTokens > 0;
  const after = usable
    ? input.registry.calibration.observe(observation)
    : before;
  const underestimateTokens = usable
    ? Math.max(0, input.actualInputTokens - observation.estimatedInputTokens)
    : 0;
  const content = {
    kind: "napier.model-context-token-calibration" as const,
    schemaVersion: 1 as const,
    status: usable ? ("calibrated" as const) : ("unavailable" as const),
    provider: input.provider,
    model: input.model,
    contentClass: observation.contentClass,
    meterProviderId: stringField(pressure, "meterProviderId"),
    estimateMethod: stringField(pressure, "estimateMethod"),
    baseEstimatedInputTokens: observation.baseEstimatedInputTokens,
    estimatedInputTokens: observation.estimatedInputTokens,
    actualInputTokens: Math.max(0, input.actualInputTokens),
    underestimateTokens,
    underestimateRatio: usable
      ? roundRatio(underestimateTokens / input.actualInputTokens)
      : 0,
    absoluteErrorRatio: usable
      ? roundRatio(
          Math.abs(input.actualInputTokens - observation.estimatedInputTokens) /
            input.actualInputTokens,
        )
      : 0,
    safetyFactorBeforePpm: before.safetyFactorPpm,
    safetyFactorAfterPpm: after.safetyFactorPpm,
    sampleCount: after.sampleCount,
    pressureContentSha256: stringField(pressure, "contentSha256"),
    modelContextEnvelopeSha256: stringField(
      input.responseEvent.payload,
      "modelContextEnvelopeSha256",
    ),
    modelContextEnvelopeTurnIndex: integerField(
      input.responseEvent.payload,
      "modelContextEnvelopeTurnIndex",
    ),
    modelContextMessageSetSha256: stringField(
      input.responseEvent.payload,
      "modelContextMessageSetSha256",
    ),
    modelContextToolDefinitionSetSha256: stringField(
      input.responseEvent.payload,
      "modelContextToolDefinitionSetSha256",
    ),
    ...(!usable
      ? { unavailableReason: "provider_usage_unavailable" as const }
      : {}),
  };
  const receipt = {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
  const event = await input.store.appendEvent({
    threadId: input.threadId,
    runId: input.runId,
    type: MODEL_CONTEXT_TOKEN_CALIBRATION_EVENT,
    category: "model",
    visibility: "debug",
    payload: toJsonValue(receipt),
  });
  if (input.onEvent) {
    try {
      await input.onEvent(event);
    } catch {
      // Durable calibration evidence survives a disconnected stream.
    }
  }
  return receipt;
}

function calibrationObservation(
  event: RunEvent,
): TokenCalibrationObservation | undefined {
  if (
    event.type !== MODEL_CONTEXT_TOKEN_CALIBRATION_EVENT ||
    !record(event.payload) ||
    event.payload["status"] !== "calibrated" ||
    !validHashedRecord(event.payload)
  ) {
    return undefined;
  }
  try {
    return {
      provider: stringField(event.payload, "provider"),
      model: stringField(event.payload, "model"),
      contentClass: contentClassField(event.payload),
      baseEstimatedInputTokens: positiveIntegerField(
        event.payload,
        "baseEstimatedInputTokens",
      ),
      estimatedInputTokens: positiveIntegerField(
        event.payload,
        "estimatedInputTokens",
      ),
      actualInputTokens: positiveIntegerField(
        event.payload,
        "actualInputTokens",
      ),
    };
  } catch {
    return undefined;
  }
}

async function boundPressure(input: {
  store: LocalStore;
  threadId: string;
  runId: string;
  responseEvent: RunEvent;
  provider: string;
  model: string;
}): Promise<Record<string, unknown> | undefined> {
  if (!record(input.responseEvent.payload)) return undefined;
  const envelope = input.responseEvent.payload;
  const events = await input.store.listEvents(input.threadId);
  const envelopeReceipt = events
    .flatMap((event) => {
      if (
        event.runId !== input.runId ||
        event.seq >= input.responseEvent.seq ||
        event.type !== "context.model_envelope" ||
        !record(event.payload) ||
        event.payload["contentSha256"] !==
          envelope["modelContextEnvelopeSha256"]
      ) {
        return [];
      }
      try {
        return [validateModelContextEnvelopeReceipt(event.payload)];
      } catch {
        return [];
      }
    })
    .at(-1);
  if (!envelopeReceipt) return undefined;
  return events
    .filter(
      (event) =>
        event.runId === input.runId &&
        event.seq < input.responseEvent.seq &&
        event.type === "model.context.token_pressure" &&
        record(event.payload) &&
        validHashedRecord(event.payload) &&
        event.payload["provider"] === input.provider &&
        event.payload["model"] === input.model &&
        event.payload["systemPromptSha256"] ===
          envelopeReceipt.systemPromptSha256 &&
        event.payload["activeMessageSetSha256"] ===
          envelopeReceipt.messageSetSha256 &&
        event.payload["toolDefinitionSetSha256"] ===
          envelopeReceipt.toolDefinitionSetSha256,
    )
    .at(-1)?.payload as Record<string, unknown> | undefined;
}

async function hydrateFromLedger(
  store: LocalStore,
  registry: TokenMeterRegistry,
): Promise<void> {
  for (const thread of store.listThreads()) {
    const events = await store.listEvents(thread.id);
    for (const event of events) {
      const observation = calibrationObservation(event);
      if (observation) registry.calibration.observe(observation);
    }
  }
}

function pressureObservation(
  pressure: Record<string, unknown>,
  provider: string,
  model: string,
  actualInputTokens: number,
): TokenCalibrationObservation {
  return {
    provider,
    model,
    contentClass: contentClassField(pressure),
    baseEstimatedInputTokens: positiveIntegerField(
      pressure,
      "activeBaseEstimatedInputTokens",
    ),
    estimatedInputTokens:
      positiveIntegerField(pressure, "activeMessageEstimatedTokens") +
      positiveIntegerField(pressure, "systemPromptEstimatedTokens") +
      positiveIntegerField(pressure, "toolDefinitionEstimatedTokens"),
    actualInputTokens: Math.max(1, actualInputTokens),
  };
}

function contentClassField(
  value: Record<string, unknown>,
): TokenCalibrationObservation["contentClass"] {
  const contentClass = value["contentClass"];
  if (
    contentClass !== "text" &&
    contentClass !== "structured" &&
    contentClass !== "multimodal"
  ) {
    throw new Error("Token calibration content class is invalid");
  }
  return contentClass;
}

function stringField(value: unknown, key: string): string {
  const field = asRecord(value)?.[key];
  if (typeof field !== "string" || !field) {
    throw new Error(`Token calibration ${key} is invalid`);
  }
  return field;
}

function integerField(value: unknown, key: string): number {
  const field = asRecord(value)?.[key];
  if (!Number.isSafeInteger(field) || Number(field) < 0) {
    throw new Error(`Token calibration ${key} is invalid`);
  }
  return Number(field);
}

function positiveIntegerField(value: unknown, key: string): number {
  const field = integerField(value, key);
  if (field < 1) throw new Error(`Token calibration ${key} is invalid`);
  return field;
}

function validHashedRecord(value: Record<string, unknown>): boolean {
  const contentSha256 = value["contentSha256"];
  if (typeof contentSha256 !== "string") return false;
  const { contentSha256: _contentSha256, ...content } = value;
  return contentSha256 === sha256(canonicalJson(content));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return record(value) ? value : undefined;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
