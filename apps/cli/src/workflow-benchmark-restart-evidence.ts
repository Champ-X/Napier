import type { JsonValue, RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import type { WorkflowBenchmarkRestartEvidence } from "./workflow-benchmark-execution.js";
import type {
  WorkflowBenchmarkDiagnostic,
  WorkflowBenchmarkEvaluation,
  WorkflowBenchmarkLedgerBundle,
  WorkflowBenchmarkLedgerEventReceipt,
} from "./workflow-benchmark-types.js";

const RESTART_EVENT_KEYS = keySet(
  "id threadId runId seq type category visibility createdAt payload",
);
const RESTART_PAYLOAD_KEYS = keySet(
  "schemaVersion planId manifestSha256 preRestartReplaySha256 preRestartEventCount preRestartMapRunIds decisionId decisionSha256",
);

interface RestartEvaluationInput {
  benchmarkCase: {
    schemaVersion: WorkflowBenchmarkEvaluation["schemaVersion"];
  };
  runtimeRestartCount?: number;
  approvalRecovered?: boolean;
  completedMapRunsReused?: boolean;
  postRestartModelResponseCount?: number;
}

export function workflowBenchmarkRestartDiagnostics(
  input: RestartEvaluationInput,
): WorkflowBenchmarkDiagnostic[] {
  if (
    input.benchmarkCase.schemaVersion !== 4 &&
    input.benchmarkCase.schemaVersion !== 6
  ) {
    return [];
  }
  const diagnostics: WorkflowBenchmarkDiagnostic[] = [];
  const expectedRestartCount = input.benchmarkCase.schemaVersion === 6 ? 2 : 1;
  if (input.runtimeRestartCount !== expectedRestartCount) {
    diagnostics.push("runtime_restart_mismatch");
  }
  if (input.approvalRecovered !== true) {
    diagnostics.push("approval_recovery_mismatch");
  }
  if (input.completedMapRunsReused !== true) {
    diagnostics.push("map_reuse_mismatch");
  }
  if ((input.postRestartModelResponseCount ?? 0) !== 0) {
    diagnostics.push("post_restart_model_called");
  }
  return diagnostics;
}

export function workflowBenchmarkRestartEvaluationProjection(
  input: RestartEvaluationInput,
) {
  return {
    runtimeRestartCount: input.runtimeRestartCount ?? 0,
    approvalRecovered: input.approvalRecovered ?? false,
    completedMapRunsReused: input.completedMapRunsReused ?? false,
    postRestartModelResponseCount: input.postRestartModelResponseCount ?? 0,
  };
}

export function workflowBenchmarkRestartEvaluationEvidence(input: {
  events: RunEvent[];
  mapRunIds: string[];
  restartEvidence: WorkflowBenchmarkRestartEvidence | undefined;
}) {
  if (!input.restartEvidence) return {};
  const restartSeq = input.restartEvidence.restartEvent.seq;
  const afterRestart = input.events.filter((event) => event.seq > restartSeq);
  return {
    runtimeRestartCount: input.events.filter(
      (event) => event.type === "benchmark.workflow.runtime.restarted",
    ).length,
    approvalRecovered:
      afterRestart.filter(
        (event) => event.type === "operator.decision.answered",
      ).length === 1 &&
      afterRestart.filter(
        (event) => event.type === "operator.decision.continued",
      ).length === 1,
    completedMapRunsReused:
      canonicalJson([...input.mapRunIds].sort()) ===
      canonicalJson(input.restartEvidence.preRestartMapRunIds),
    postRestartModelResponseCount: afterRestart.filter(
      (event) => event.type === "model.response",
    ).length,
  };
}

export function workflowBenchmarkRestartLedgerEvidence(
  restartEvidence: WorkflowBenchmarkRestartEvidence | undefined,
): Pick<
  WorkflowBenchmarkLedgerBundle["workflow"],
  "restartEvent" | "restartEvents" | "preRestartMapRunIds"
> {
  return restartEvidence
    ? {
        restartEvent: structuredClone(restartEvidence.restartEvent),
        ...(restartEvidence.restartEvents.length > 1
          ? {
              restartEvents: restartEvidence.restartEvents.map((event) =>
                structuredClone(event),
              ),
            }
          : {}),
        preRestartMapRunIds: [...restartEvidence.preRestartMapRunIds],
      }
    : {};
}

export function validWorkflowBenchmarkRestartFields(
  workflow: Record<string, unknown>,
): boolean {
  const event = workflow["restartEvent"];
  const events = workflow["restartEvents"];
  const mapRunIds = workflow["preRestartMapRunIds"];
  if (event === undefined && events === undefined && mapRunIds === undefined) {
    return true;
  }
  return (
    validRestartEvent(event) &&
    validRestartEvents(events, event) &&
    Array.isArray(mapRunIds) &&
    mapRunIds.length >= 2 &&
    mapRunIds.length <= 8 &&
    mapRunIds.every(resourceId) &&
    new Set(mapRunIds).size === mapRunIds.length &&
    mapRunIds.every(
      (runId, index) => index === 0 || mapRunIds[index - 1]! < runId,
    )
  );
}

export function validWorkflowBenchmarkRestartBinding(
  bundle: WorkflowBenchmarkLedgerBundle,
): boolean {
  const event = bundle.workflow.restartEvent;
  const events = bundle.workflow.restartEvents ?? (event ? [event] : undefined);
  const preRestartMapRunIds = bundle.workflow.preRestartMapRunIds;
  if (
    event === undefined &&
    events === undefined &&
    preRestartMapRunIds === undefined
  ) {
    return true;
  }
  if (!event || !events || !preRestartMapRunIds) return false;
  return (
    canonicalJson(events[0] as unknown as JsonValue) ===
      canonicalJson(event as unknown as JsonValue) &&
    events.length ===
      bundle.eventReceipts.filter(
        (receipt) => receipt.type === "benchmark.workflow.runtime.restarted",
      ).length &&
    events.every((restartEvent) =>
      restartEventMatchesBundle(bundle, restartEvent, preRestartMapRunIds),
    )
  );
}

export function workflowBenchmarkRestartEvaluationFromBundle(
  bundle: WorkflowBenchmarkLedgerBundle,
) {
  const event = bundle.workflow.restartEvent;
  const preRestartMapRunIds = bundle.workflow.preRestartMapRunIds;
  if (!event || !preRestartMapRunIds) return {};
  const afterRestart = bundle.eventReceipts.filter(
    (receipt) => receipt.seq > event.seq,
  );
  return {
    runtimeRestartCount: bundle.eventReceipts.filter(
      (receipt) => receipt.type === "benchmark.workflow.runtime.restarted",
    ).length,
    approvalRecovered:
      afterRestart.filter(
        (receipt) => receipt.type === "operator.decision.answered",
      ).length === 1 &&
      afterRestart.filter(
        (receipt) => receipt.type === "operator.decision.continued",
      ).length === 1,
    completedMapRunsReused:
      canonicalJson(bundle.workflow.mapRunIds) ===
      canonicalJson(preRestartMapRunIds),
    postRestartModelResponseCount: afterRestart.filter(
      (receipt) => receipt.type === "model.response",
    ).length,
  };
}

function validRestartEvent(value: unknown): value is RunEvent {
  if (
    !exactRecord(value, RESTART_EVENT_KEYS) ||
    !exactRecord(value["payload"], RESTART_PAYLOAD_KEYS)
  ) {
    return false;
  }
  const payload = value["payload"];
  const mapRunIds = payload["preRestartMapRunIds"];
  return (
    resourceId(value["id"]) &&
    resourceId(value["threadId"]) &&
    resourceId(value["runId"]) &&
    nonNegativeInteger(value["seq"]) &&
    value["type"] === "benchmark.workflow.runtime.restarted" &&
    value["category"] === "system" &&
    value["visibility"] === "user" &&
    validIsoDate(value["createdAt"]) &&
    payload["schemaVersion"] === 1 &&
    resourceId(payload["planId"]) &&
    digest(payload["manifestSha256"]) &&
    digest(payload["preRestartReplaySha256"]) &&
    nonNegativeInteger(payload["preRestartEventCount"]) &&
    Array.isArray(mapRunIds) &&
    mapRunIds.every(resourceId) &&
    resourceId(payload["decisionId"]) &&
    digest(payload["decisionSha256"])
  );
}

function validRestartEvents(events: unknown, first: RunEvent): boolean {
  if (events === undefined) return true;
  return (
    Array.isArray(events) &&
    events.length >= 2 &&
    events.length <= 4 &&
    events.every(validRestartEvent) &&
    new Set(events.map((event) => event.id)).size === events.length &&
    events.every(
      (event, index) => index === 0 || events[index - 1]!.seq < event.seq,
    ) &&
    canonicalJson(events[0] as unknown as JsonValue) ===
      canonicalJson(first as unknown as JsonValue)
  );
}

function restartEventMatchesBundle(
  bundle: WorkflowBenchmarkLedgerBundle,
  event: RunEvent,
  preRestartMapRunIds: string[],
): boolean {
  if (!validRestartEvent(event) || !record(event.payload)) return false;
  const receipt = bundle.eventReceipts.find(
    (candidate) => candidate.id === event.id,
  );
  return (
    event.threadId === bundle.threadId &&
    event.payload["planId"] === bundle.workflow.planId &&
    event.payload["manifestSha256"] === bundle.workflow.manifestSha256 &&
    Number(event.payload["preRestartEventCount"]) + 1 === event.seq &&
    canonicalJson(event.payload["preRestartMapRunIds"] as JsonValue) ===
      canonicalJson(preRestartMapRunIds) &&
    receiptMatchesEvent(receipt, event)
  );
}

function receiptMatchesEvent(
  receipt: WorkflowBenchmarkLedgerEventReceipt | undefined,
  event: RunEvent,
): boolean {
  return (
    receipt?.seq === event.seq &&
    receipt.runId === event.runId &&
    receipt.type === event.type &&
    receipt.category === event.category &&
    receipt.visibility === event.visibility &&
    receipt.createdAt === event.createdAt &&
    receipt.payloadSha256 === sha256(canonicalJson(event.payload))
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    record(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function keySet(value: string): readonly string[] {
  return value.split(" ");
}
