import { emptyUsage, type RunEvent, type SubagentTask, type Usage } from "@napier/contracts";
import type { ModelAccountingSummaryV1 } from "@napier/contracts/model-accounting";
import { canonicalJson, sha256 } from "./ed25519.js";
import { projectModelObservationUsage } from "./model-usage-observation.js";

import { MODEL_ACCOUNTING_EVENT_TYPES, LEGACY_AUXILIARY_USAGE_TYPES, USAGE_TYPES,
  hasPhysicalReference, isUndispatchedModelDiagnostic, object, readModelAccountingEvidence, type ModelAccountingEvidence } from "./model-accounting-evidence.js";
export { MODEL_ACCOUNTING_EVENT_TYPES, hasModelAccounting, readModelAccountingEvidence } from "./model-accounting-evidence.js";
const KEYS = Object.keys(emptyUsage()) as Array<keyof Usage>;
export interface ModelAccountingFold { usage: Usage; summary: ModelAccountingSummaryV1 }

export function foldModelAccounting(events: readonly RunEvent[], tasks: readonly SubagentTask[] = [],
  previous?: ModelAccountingSummaryV1): ModelAccountingFold {
  const evidence = readModelAccountingEvidence(events);
  const summary: ModelAccountingSummaryV1 = { schemaVersion: 1, mode: "physical_receipt_v1", revision: 0,
    usageStatus: "complete", tokenCompleteness: "complete", reportedCostCompleteness: "complete",
    budgetCostCompleteness: "complete", unresolvedInvocations: 0, partialInvocations: 0,
    budgetTokens: 0, budgetCostUsd: 0, knownBudgetCostUsd: 0, evidenceSha256: "" };
  let usage = legacyUsage(events, evidence);
  summary.budgetTokens = rawTokens(usage); summary.budgetCostUsd = usage.costUsd;
  summary.knownBudgetCostUsd = usage.costUsd;
  for (const attribution of evidence.attributions.values()) {
    const observation = evidence.observations.get(attribution.physicalId);
    if (!observation) { unresolved(summary); continue; }
    const projection = projectModelObservationUsage(attribution, observation);
    usage = addModelUsage(usage, projection.usage);
    summary.budgetTokens += projection.budgetTokens;
    summary.budgetCostUsd = addKnownCost(summary.budgetCostUsd, projection.budgetCostUsd);
    summary.knownBudgetCostUsd += projection.budgetCostUsd ?? projection.usage.costUsd;
    for (const key of ["tokenCompleteness", "reportedCostCompleteness", "budgetCostCompleteness"] as const)
      if (projection[key] === "incomplete") summary[key] = "incomplete";
    if (observation.usageStatus === "unknown" || observation.usageStatus === "partial") summary.partialInvocations += 1;
  }
  const attributedChildren = new Set([...evidence.attributions.values()].flatMap((value) =>
    value.owner.kind === "child" ? [value.owner.childInvocationId] : []));
  for (const event of events) {
    if (event.type !== "subagent.child.invocation_reserved") continue;
    const id = String(object(event.payload)["invocationId"]);
    if (attributedChildren.has(id) || evidence.childClosed.has(id)) continue;
    const known = events.some((candidate) => candidate.type === "model.response" &&
      object(candidate.payload)["childInvocationId"] === id && object(candidate.payload)["usageStatus"] === "known");
    if (!known) unresolved(summary);
  }
  for (const task of tasks) {
    usage = addModelUsage(usage, task.usage);
    if (task.accounting) {
      summary.budgetTokens += task.accounting.budgetTokens;
      summary.budgetCostUsd = addKnownCost(summary.budgetCostUsd, task.accounting.budgetCostUsd);
      summary.knownBudgetCostUsd += task.accounting.knownBudgetCostUsd;
      summary.unresolvedInvocations += task.accounting.unresolvedInvocations;
      summary.partialInvocations += task.accounting.partialInvocations;
      for (const key of ["tokenCompleteness", "reportedCostCompleteness", "budgetCostCompleteness"] as const)
        if (task.accounting[key] === "incomplete") summary[key] = "incomplete";
    } else {
      summary.budgetTokens += rawTokens(task.usage);
      summary.budgetCostUsd = addKnownCost(summary.budgetCostUsd, task.usage.costUsd);
      summary.knownBudgetCostUsd += task.usage.costUsd;
      if (task.usageStatus === "incomplete") unresolved(summary);
    }
  }
  summary.usageStatus = summary.unresolvedInvocations || summary.partialInvocations ||
    summary.tokenCompleteness === "incomplete" || summary.reportedCostCompleteness === "incomplete" ||
    summary.budgetCostCompleteness === "incomplete" ? "incomplete" : "complete";
  summary.evidenceSha256 = sha256(canonicalJson({ usage, summary: { ...summary, revision: 0, evidenceSha256: "" },
    events: events.filter((event) => MODEL_ACCOUNTING_EVENT_TYPES.some((type) => event.type === type))
      .map((event) => ({ id: event.id, type: event.type, payload: event.payload })),
    tasks: tasks.map((task) => ({ id: task.id, usage: task.usage, status: task.usageStatus ?? null,
      accounting: task.accounting ?? null })).sort((a, b) => a.id.localeCompare(b.id)) }));
  summary.revision = previous?.evidenceSha256 === summary.evidenceSha256 ? previous.revision : (previous?.revision ?? 0) + 1;
  return { usage, summary };
}

export function assertChildLogicalInvocationsSettled(events: readonly RunEvent[]): void {
  const closed = readModelAccountingEvidence(events).childClosed;
  for (const event of events) {
    if (event.type !== "subagent.child.invocation_reserved") continue;
    const id = object(event.payload)["invocationId"];
    if (closed.has(String(id))) continue;
    if (!events.some((candidate) => candidate.type === "model.response" && object(candidate.payload)["childInvocationId"] === id))
      throw new Error("Child invocation logical response is unresolved");
  }
}

export function addModelUsage(left: Usage, right: Usage): Usage {
  return Object.fromEntries(KEYS.map((key) => [key, Number(left[key]) + Number(right[key])])) as Usage;
}
function legacyUsage(events: readonly RunEvent[], evidence: ModelAccountingEvidence): Usage {
  const frontier = events.find((event) => event.type === "model.accounting.prepared")?.seq ?? Infinity;
  const legacy = events.filter((event) => {
    const payload = object(event.payload);
    if (!USAGE_TYPES.has(event.type) || isUndispatchedModelDiagnostic(payload) || hasPhysicalReference(payload) ||
        evidence.childClosed.has(String(payload["childInvocationId"]))) return false;
    if (payload["usage"] && event.seq >= frontier) fail("unattributed usage follows accounting activation");
    return true;
  });
  const responses = legacy.filter((event) => event.type === "model.response");
  const primary = responses.length ? responses : legacy.filter((event) => event.type === "message.assistant");
  return [...primary, ...legacy.filter((event) => LEGACY_AUXILIARY_USAGE_TYPES.includes(event.type))]
    .map(eventUsage).filter((value): value is Usage => !!value).reduce(addModelUsage, emptyUsage());
}
function eventUsage(event: RunEvent): Usage | undefined {
  const value = object(object(event.payload)["usage"]);
  if (KEYS.some((key) => typeof value[key] !== "number" || !Number.isFinite(value[key]) || Number(value[key]) < 0)) return undefined;
  return Object.fromEntries(KEYS.map((key) => [key, value[key]])) as Usage;
}
function unresolved(summary: ModelAccountingSummaryV1): void {
  summary.unresolvedInvocations += 1;
  summary.tokenCompleteness = summary.reportedCostCompleteness = summary.budgetCostCompleteness = "incomplete";
  summary.budgetCostUsd = null;
}
function addKnownCost(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right;
}
function rawTokens(value: Usage): number { return value.inputTokens + value.outputTokens + value.cacheReadTokens + value.cacheWriteTokens; }
function fail(reason: string): never { throw new Error(`Model accounting evidence ${reason}`); }
