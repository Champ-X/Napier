import type { RunEvent } from "@napier/contracts";
import type {
  RunHarnessContextTokenMetrics,
  RunHarnessOverflowMetrics,
} from "@napier/contracts/run-harness-effects";

import { canonicalJson, sha256 } from "./ed25519.js";
import { validateModelContextEnvelopeReceipt } from "./model-context-envelope.js";

interface TokenPressureEvidence {
  event: RunEvent;
  status: "within_budget" | "projected" | "unavailable";
  provider: string;
  model: string;
  recoveryAttempt: 0 | 1;
  systemPromptEstimatedTokens: number;
  toolDefinitionEstimatedTokens: number;
  activeMessageEstimatedTokens: number;
  outputReserveTokens: number;
  reasoningReserveTokens: number;
  safetyReserveTokens: number;
  activeEstimatedTotalTokens: number;
  systemPromptSha256: string;
  toolDefinitionSetSha256: string;
  activeMessageSetSha256: string;
}

interface TokenCalibrationEvidence {
  status: "calibrated" | "unavailable";
  underestimateRatio: number;
}

export function projectRunHarnessContextMetrics(events: readonly RunEvent[]): {
  contextTokens: RunHarnessContextTokenMetrics;
  overflow: RunHarnessOverflowMetrics;
} {
  const pressureEvents = events.filter(
    (event) => event.type === "model.context.token_pressure",
  );
  const pressures = pressureEvents.flatMap((event) => {
    const pressure = parseTokenPressure(event);
    return pressure ? [pressure] : [];
  });
  const calibrationEvents = events.filter(
    (event) => event.type === "model.context.token_calibration",
  );
  const calibrations = calibrationEvents.flatMap((event) => {
    const calibration = parseTokenCalibration(event);
    return calibration ? [calibration] : [];
  });
  const contextTokens =
    pressureEvents.length > 0 && pressures.length === pressureEvents.length
      ? aggregateTokenPressure(pressures)
      : unavailableTokenPressure();
  return {
    contextTokens: aggregateTokenCalibration(
      contextTokens,
      calibrationEvents,
      calibrations,
    ),
    overflow: projectOverflow(events, pressures),
  };
}

function aggregateTokenCalibration(
  contextTokens: RunHarnessContextTokenMetrics,
  events: readonly RunEvent[],
  calibrations: readonly TokenCalibrationEvidence[],
): RunHarnessContextTokenMetrics {
  if (events.length === 0) return contextTokens;
  const usable = calibrations.filter(
    (calibration) => calibration.status === "calibrated",
  );
  return {
    ...contextTokens,
    calibrationObservationCount: events.length,
    calibratedObservationCount: usable.length,
    calibrationUnavailableCount: events.length - usable.length,
    ...(calibrations.length === events.length && usable.length > 0
      ? {
          p95InputUnderestimateRatio: percentile95(
            usable.map((calibration) => calibration.underestimateRatio),
          ),
        }
      : {}),
  };
}

function parseTokenCalibration(
  event: RunEvent,
): TokenCalibrationEvidence | undefined {
  const payload = record(event.payload);
  if (
    !payload ||
    payload["kind"] !== "napier.model-context-token-calibration" ||
    payload["schemaVersion"] !== 1 ||
    !validHashedRecord(payload) ||
    !oneOf(payload["status"], ["calibrated", "unavailable"]) ||
    typeof payload["underestimateRatio"] !== "number" ||
    payload["underestimateRatio"] < 0 ||
    payload["underestimateRatio"] > 1
  ) {
    return undefined;
  }
  return {
    status: payload["status"] as TokenCalibrationEvidence["status"],
    underestimateRatio: payload["underestimateRatio"],
  };
}

function aggregateTokenPressure(
  pressures: readonly TokenPressureEvidence[],
): RunHarnessContextTokenMetrics {
  const usable = pressures.filter(
    (pressure) => pressure.status !== "unavailable",
  );
  if (usable.length !== pressures.length || usable.length === 0) {
    return unavailableTokenPressure();
  }
  const systemPromptEstimatedTokens = sum(
    usable,
    "systemPromptEstimatedTokens",
  );
  const toolDefinitionEstimatedTokens = sum(
    usable,
    "toolDefinitionEstimatedTokens",
  );
  const activeMessageEstimatedTokens = sum(
    usable,
    "activeMessageEstimatedTokens",
  );
  const activeEstimatedTotalTokens = sum(usable, "activeEstimatedTotalTokens");
  return {
    status: "available",
    observationCount: usable.length,
    systemPromptEstimatedTokens,
    toolDefinitionEstimatedTokens,
    activeMessageEstimatedTokens,
    activeEstimatedTotalTokens,
    systemPromptTokenShare: safeRate(
      systemPromptEstimatedTokens,
      activeEstimatedTotalTokens,
    ),
    toolDefinitionTokenShare: safeRate(
      toolDefinitionEstimatedTokens,
      activeEstimatedTotalTokens,
    ),
  };
}

function unavailableTokenPressure(): RunHarnessContextTokenMetrics {
  return { status: "unavailable", observationCount: 0 };
}

function projectOverflow(
  events: readonly RunEvent[],
  pressures: readonly TokenPressureEvidence[],
): RunHarnessOverflowMetrics {
  const metrics: RunHarnessOverflowMetrics = {
    attemptCount: 0,
    recoveredCount: 0,
    failedCount: 0,
    unavailableCount: 0,
  };
  for (const overflow of events.filter(
    (event) => event.type === "model.context.overflow",
  )) {
    metrics.attemptCount += 1;
    const payload = record(overflow.payload);
    if (!payload || !validHashedRecord(payload)) {
      metrics.unavailableCount += 1;
      continue;
    }
    const action = payload["action"];
    if (!validOriginalOverflowBinding(events, overflow, payload)) {
      metrics.unavailableCount += 1;
      continue;
    }
    if (action === "budget_exhausted") {
      metrics.failedCount += 1;
      continue;
    }
    if (action !== "retry") {
      metrics.unavailableCount += 1;
      continue;
    }
    const pressure = pressures.find(
      (candidate) =>
        candidate.event.seq > overflow.seq &&
        candidate.recoveryAttempt === 1 &&
        candidate.provider === payload["provider"] &&
        candidate.model === payload["model"],
    );
    if (!pressure) {
      metrics.unavailableCount += 1;
      continue;
    }
    if (pressure.status === "unavailable") {
      metrics.failedCount += 1;
      continue;
    }
    const envelope = nextRecoveryEnvelope(events, pressure);
    if (!envelope) {
      metrics.unavailableCount += 1;
      continue;
    }
    const terminal = events.find(
      (candidate) =>
        candidate.seq > envelope.event.seq &&
        candidate.type === "model.response" &&
        terminalBindsEnvelope(candidate, envelope.receipt),
    );
    if (!terminal) {
      metrics.unavailableCount += 1;
      continue;
    }
    const stopReason = field(terminal.payload, "stopReason");
    if (stopReason === "error" || stopReason === "aborted") {
      metrics.failedCount += 1;
    } else {
      metrics.recoveredCount += 1;
    }
  }
  return metrics;
}

function parseTokenPressure(
  event: RunEvent,
): TokenPressureEvidence | undefined {
  const payload = record(event.payload);
  if (
    !payload ||
    payload["kind"] !== "napier.model-context-token-pressure" ||
    payload["schemaVersion"] !== 1 ||
    !validHashedRecord(payload) ||
    !oneOf(payload["status"], ["within_budget", "projected", "unavailable"]) ||
    typeof payload["provider"] !== "string" ||
    typeof payload["model"] !== "string" ||
    (payload["recoveryAttempt"] !== 0 && payload["recoveryAttempt"] !== 1)
  ) {
    return undefined;
  }
  const numericKeys = [
    "systemPromptEstimatedTokens",
    "toolDefinitionEstimatedTokens",
    "activeMessageEstimatedTokens",
    "outputReserveTokens",
    "reasoningReserveTokens",
    "safetyReserveTokens",
    "activeEstimatedTotalTokens",
  ] as const;
  if (numericKeys.some((key) => !nonNegativeInteger(payload[key]))) {
    return undefined;
  }
  const expectedTotal = numericKeys
    .slice(0, -1)
    .reduce((total, key) => total + Number(payload[key]), 0);
  if (expectedTotal !== payload["activeEstimatedTotalTokens"]) {
    return undefined;
  }
  const hashes = [
    "systemPromptSha256",
    "toolDefinitionSetSha256",
    "activeMessageSetSha256",
  ] as const;
  if (hashes.some((key) => !hash(payload[key]))) return undefined;
  return {
    event,
    status: payload["status"] as TokenPressureEvidence["status"],
    provider: payload["provider"],
    model: payload["model"],
    recoveryAttempt: payload["recoveryAttempt"],
    systemPromptEstimatedTokens: Number(payload["systemPromptEstimatedTokens"]),
    toolDefinitionEstimatedTokens: Number(
      payload["toolDefinitionEstimatedTokens"],
    ),
    activeMessageEstimatedTokens: Number(
      payload["activeMessageEstimatedTokens"],
    ),
    outputReserveTokens: Number(payload["outputReserveTokens"]),
    reasoningReserveTokens: Number(payload["reasoningReserveTokens"]),
    safetyReserveTokens: Number(payload["safetyReserveTokens"]),
    activeEstimatedTotalTokens: Number(payload["activeEstimatedTotalTokens"]),
    systemPromptSha256: String(payload["systemPromptSha256"]),
    toolDefinitionSetSha256: String(payload["toolDefinitionSetSha256"]),
    activeMessageSetSha256: String(payload["activeMessageSetSha256"]),
  };
}

function validOriginalOverflowBinding(
  events: readonly RunEvent[],
  overflow: RunEvent,
  payload: Record<string, unknown>,
): boolean {
  if (
    typeof payload["provider"] !== "string" ||
    typeof payload["model"] !== "string"
  ) {
    return false;
  }
  return events.some((candidate) => {
    if (
      candidate.seq >= overflow.seq ||
      candidate.type !== "context.model_envelope"
    ) {
      return false;
    }
    try {
      const receipt = validateModelContextEnvelopeReceipt(candidate.payload);
      return envelopeBindingMatches(payload, receipt);
    } catch {
      return false;
    }
  });
}

function nextRecoveryEnvelope(
  events: readonly RunEvent[],
  pressure: TokenPressureEvidence,
):
  | {
      event: RunEvent;
      receipt: ReturnType<typeof validateModelContextEnvelopeReceipt>;
    }
  | undefined {
  for (const event of events) {
    if (
      event.seq <= pressure.event.seq ||
      event.type !== "context.model_envelope"
    )
      continue;
    try {
      const receipt = validateModelContextEnvelopeReceipt(event.payload);
      if (
        receipt.systemPromptSha256 === pressure.systemPromptSha256 &&
        receipt.toolDefinitionSetSha256 === pressure.toolDefinitionSetSha256 &&
        receipt.messageSetSha256 === pressure.activeMessageSetSha256
      ) {
        return { event, receipt };
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function terminalBindsEnvelope(
  event: RunEvent,
  receipt: ReturnType<typeof validateModelContextEnvelopeReceipt>,
): boolean {
  const payload = record(event.payload);
  return Boolean(payload && envelopeBindingMatches(payload, receipt));
}

function envelopeBindingMatches(
  payload: Record<string, unknown>,
  receipt: ReturnType<typeof validateModelContextEnvelopeReceipt>,
): boolean {
  return (
    payload["modelContextEnvelopeSha256"] === receipt.contentSha256 &&
    payload["modelContextEnvelopeTurnIndex"] === receipt.turnIndex &&
    payload["modelContextMessageSetSha256"] === receipt.messageSetSha256 &&
    payload["modelContextToolDefinitionSetSha256"] ===
      receipt.toolDefinitionSetSha256
  );
}

function validHashedRecord(value: Record<string, unknown>): boolean {
  if (!hash(value["contentSha256"])) return false;
  const { contentSha256, ...content } = value;
  return contentSha256 === sha256(canonicalJson(content));
}

function sum(
  values: readonly TokenPressureEvidence[],
  key: keyof TokenPressureEvidence,
): number {
  return values.reduce((total, value) => total + Number(value[key]), 0);
}

function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function percentile95(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function field(value: unknown, key: string): unknown {
  return record(value)?.[key];
}

function oneOf<T>(value: unknown, values: readonly T[]): value is T {
  return values.includes(value as T);
}
