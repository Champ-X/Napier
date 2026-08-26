import type { RunEvent } from "@napier/contracts";

import type { CompiledPromptPackageReceiptV3 } from "./compiled-prompt-package.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { validateContextProjectionReceipt } from "./context-projection-receipt.js";

type ProjectionReceipt = ReturnType<typeof validateContextProjectionReceipt>;

export function projectionSourceReceiptsMatch(
  receipt: ProjectionReceipt,
  pruning: unknown,
  pressure: unknown,
): boolean {
  if (!validHashedRecord(pruning) || !validHashedRecord(pressure)) return false;
  const expectedStatus =
    pressure["status"] === "unavailable"
      ? "unavailable"
      : Number(pruning["replacementCount"]) > 0 ||
          pressure["status"] === "projected"
        ? "projected"
        : "within_budget";
  return (
    receipt.status === expectedStatus &&
    pruning["contentSha256"] === receipt.pruningReceiptSha256 &&
    pruning["attempt"] === receipt.modelAttempt &&
    pruning["messageCount"] === receipt.prePruningMessageCount &&
    pruning["replacementCount"] === receipt.prunedToolResultCount &&
    pruning["savedToolResultTextBytes"] === receipt.prunedToolResultBytes &&
    pressureFieldsMatch(receipt, pressure)
  );
}

export function projectionInvocationEvents(
  events: readonly RunEvent[],
  runId: string,
  projectionIndex: number,
): RunEvent[] {
  const nextIndex = events.findIndex(
    (candidate, index) =>
      index > projectionIndex &&
      candidate.runId === runId &&
      candidate.type === "context.projected",
  );
  return events
    .slice(projectionIndex + 1, nextIndex < 0 ? undefined : nextIndex)
    .filter((candidate) => candidate.runId === runId);
}

export function projectionPromptSourcesMatch(
  receipt: ProjectionReceipt,
  promptPackage: CompiledPromptPackageReceiptV3,
): boolean {
  const sources = promptPackage.layers.flatMap((layer) =>
    layer.sources.map((source) => ({
      sourceIdSha256: sha256(source.sourceId),
      inputContentSha256: source.inputContentSha256,
      included: source.included,
      trimmingReason: source.trimmingReason,
    })),
  );
  return (
    receipt.promptSourceCount === sources.length &&
    receipt.includedPromptSourceCount ===
      sources.filter((source) => source.included).length &&
    receipt.omittedPromptSourceCount ===
      sources.filter((source) => !source.included).length &&
    receipt.promptSourceSetSha256 === sha256(canonicalJson(sources)) &&
    receipt.skillCatalog ===
      componentState(promptPackage, "task.skill_catalog") &&
    receipt.memory === componentState(promptPackage, "workspace.memory") &&
    receipt.compactionCheckpoint ===
      componentState(promptPackage, "workspace.checkpoint")
  );
}

function pressureFieldsMatch(
  receipt: ProjectionReceipt,
  pressure: Record<string, unknown>,
): boolean {
  return (
    pressure["contentSha256"] === receipt.tokenPressureReceiptSha256 &&
    pressure["provider"] === receipt.provider &&
    pressure["model"] === receipt.model &&
    pressure["modelAttempt"] === receipt.modelAttempt &&
    pressure["recoveryAttempt"] === receipt.recoveryAttempt &&
    pressure["originalMessageCount"] === receipt.preparedMessageCount &&
    pressure["originalMessageSetSha256"] === receipt.preparedMessageSetSha256 &&
    pressure["activeMessageCount"] === receipt.activeMessageCount &&
    pressure["activeMessageSetSha256"] === receipt.activeMessageSetSha256 &&
    pressure["toolDefinitionSetSha256"] === receipt.toolDefinitionSetSha256 &&
    pressure["systemPromptSha256"] === receipt.systemPromptSha256 &&
    pressure["projection"] === receipt.tokenProjection &&
    pressure["removedMessageCount"] === receipt.removedMessageCount &&
    pressure["removedUnitCount"] === receipt.removedUnitCount &&
    pressure["contentClass"] === receipt.contentClass &&
    pressure["meterProviderId"] === receipt.meterProviderId &&
    pressure["estimateMethod"] === receipt.estimateMethod &&
    pressureTokenTotalsMatch(receipt, pressure)
  );
}

function pressureTokenTotalsMatch(
  receipt: ProjectionReceipt,
  pressure: Record<string, unknown>,
): boolean {
  const activeInput =
    Number(pressure["activeEstimatedTotalTokens"]) -
    Number(pressure["outputReserveTokens"]) -
    Number(pressure["reasoningReserveTokens"]) -
    Number(pressure["safetyReserveTokens"]);
  return (
    activeInput === receipt.activeEstimatedInputTokens &&
    pressure["outputReserveTokens"] === receipt.outputReserveTokens &&
    pressure["reasoningReserveTokens"] === receipt.reasoningReserveTokens &&
    pressure["safetyReserveTokens"] === receipt.safetyReserveTokens &&
    pressure["activeEstimatedTotalTokens"] ===
      receipt.activeEstimatedTotalTokens &&
    pressure["contextWindowTokens"] === receipt.contextWindowTokens
  );
}

function componentState(
  promptPackage: CompiledPromptPackageReceiptV3,
  sourceId: string,
): "absent" | "included" | "omitted" {
  const source = promptPackage.layers
    .flatMap((layer) => layer.sources)
    .find((candidate) => candidate.sourceId === sourceId);
  return source ? (source.included ? "included" : "omitted") : "absent";
}

function validHashedRecord(value: unknown): value is Record<string, unknown> {
  if (!record(value) || typeof value["contentSha256"] !== "string") {
    return false;
  }
  const content = { ...value };
  delete content["contentSha256"];
  return sha256(canonicalJson(content)) === value["contentSha256"];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
