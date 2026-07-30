import { traceSummaryBoundarySource, type RunEvent } from "@napier/contracts";

import { agentEventTraceSummary } from "./agent-event-view";
import { artifactEventTraceSummary } from "./artifact-event-view";
import { branchEventTraceSummary } from "./branch-event-view";
import { channelEventTraceSummary } from "./channel-event-view";
import {
  operatorDecisionTraceSummary,
  runControlTraceSummary,
} from "./control-event-view";
import { contextEventTraceSummary } from "./context-event-view";
import { credentialEventTraceSummary } from "./credential-event-view";
import { evaluationEventTraceSummary } from "./evaluation-event-view";
import { extensionEventTraceSummary } from "./extension-event-view";
import {
  goalEventTraceSummary,
  memoryEventTraceSummary,
} from "./goal-memory-event-view";
import { messageEventTraceSummary } from "./message-event-view";
import { modelAdvisorEventTraceSummary } from "./model-advisor-event-view";
import { modelEventTraceSummary } from "./model-event-view";
import { modelResponseTraceSummary } from "./model-response-view";
import { openTelemetryTraceExportSummary } from "./otel-trace-export-view";
import { packageGovernanceEventTraceSummary } from "./package-governance-event-view";
import { planEventTraceSummary } from "./plan-event-view";
import { receiptEventTraceSummary } from "./receipt-event-view";
import { runEventTraceSummary } from "./run-event-view";
import { scheduleEventTraceSummary } from "./schedule-event-view";
import { sha256Canonical } from "./stable-digest";
import { subagentEventTraceSummary } from "./subagent-event-view";
import { threadImportedSummary } from "./thread-imported-view";
import { toolEventTraceSummary } from "./tool-event-view";
import { workflowEventTraceSummary } from "./workflow-event-view";
import { workspaceFileEventTraceSummary } from "./workspace-file-event-view";
import { workspaceProcessEventTraceSummary } from "./workspace-process-event-view";

export type TraceEventSummarySource =
  | "bounded"
  | "fixed"
  | "category"
  | "generic";

export interface TraceEventSummaryView {
  text: string;
  source: TraceEventSummarySource;
}

export interface TraceSummaryCoverageView {
  total: number;
  bounded: number;
  fixed: number;
  category: number;
  generic: number;
  genericEventTypes: string[];
}

export type TraceSummaryCoverageDeltaStatus =
  | "clean"
  | "generic_present"
  | "regressed";

export interface TraceSummaryCoverageDeltaView {
  status: TraceSummaryCoverageDeltaStatus;
  left: TraceSummaryCoverageView;
  right: TraceSummaryCoverageView;
  boundedDelta: number;
  fixedDelta: number;
  categoryDelta: number;
  genericDelta: number;
  diagnostics: string[];
  genericEventTypes: string[];
}

export interface TraceSummaryCoverageReceipt {
  kind: "napier.trace-summary-coverage";
  schemaVersion: 1;
  total: number;
  bounded: number;
  fixed: number;
  category: number;
  generic: number;
  genericEventTypes: string[];
  contentSha256: string;
}

export interface TraceSummaryCoverageDeltaReceipt {
  kind: "napier.trace-summary-coverage-delta";
  schemaVersion: 1;
  status: TraceSummaryCoverageDeltaStatus;
  left: Omit<
    TraceSummaryCoverageReceipt,
    "kind" | "schemaVersion" | "contentSha256"
  >;
  right: Omit<
    TraceSummaryCoverageReceipt,
    "kind" | "schemaVersion" | "contentSha256"
  >;
  boundedDelta: number;
  fixedDelta: number;
  categoryDelta: number;
  genericDelta: number;
  diagnostics: string[];
  genericEventTypes: string[];
  contentSha256: string;
}

export interface TraceSummaryCoverageReceiptVerification {
  status: "valid" | "invalid";
  diagnostics: string[];
  observedContentSha256?: string;
  declaredContentSha256?: string;
}

export function traceEventSummaryView(event: RunEvent): TraceEventSummaryView {
  if (event.type === "trace.otlp.exported") {
    return classifiedSummary(
      event,
      openTelemetryTraceExportSummary(event),
      "fixed",
    );
  }
  if (event.type === "thread.imported") {
    return classifiedSummary(event, threadImportedSummary(event), "fixed");
  }
  if (event.type.startsWith("message.") || event.type.startsWith("system.")) {
    return classifiedSummary(event, messageEventTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("agent.")) {
    return classifiedSummary(event, agentEventTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("branch.")) {
    return classifiedSummary(event, branchEventTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("schedule.")) {
    return classifiedSummary(event, scheduleEventTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("channel.")) {
    return classifiedSummary(event, channelEventTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("credential.")) {
    return classifiedSummary(
      event,
      credentialEventTraceSummary(event),
      "fixed",
    );
  }
  if (event.type.startsWith("extension.")) {
    return classifiedSummary(event, extensionEventTraceSummary(event), "fixed");
  }
  if (
    event.type.startsWith("skill.") ||
    event.type.startsWith("prompt.") ||
    event.type.startsWith("inspector.")
  ) {
    return classifiedSummary(
      event,
      packageGovernanceEventTraceSummary(event),
      "fixed",
    );
  }
  if (
    event.type.startsWith("receipt.") ||
    event.type.startsWith("receipt_trust.")
  ) {
    return classifiedSummary(event, receiptEventTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("context.")) {
    return classifiedSummary(event, contextEventTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("evaluation.")) {
    return classifiedSummary(
      event,
      evaluationEventTraceSummary(event),
      "fixed",
    );
  }
  if (event.type.startsWith("plan.")) {
    return classifiedSummary(event, planEventTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("workflow.")) {
    return classifiedSummary(event, workflowEventTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("artifact.")) {
    return classifiedSummary(event, artifactEventTraceSummary(event), "fixed");
  }
  if (event.type === "model.response") {
    return classifiedSummary(event, modelResponseTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("tool.")) {
    return classifiedSummary(event, toolEventTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("goal.")) {
    return classifiedSummary(event, goalEventTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("memory.")) {
    return classifiedSummary(event, memoryEventTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("operator.decision.")) {
    return classifiedSummary(
      event,
      operatorDecisionTraceSummary(event),
      "fixed",
    );
  }
  if (event.type.startsWith("run.control.")) {
    return classifiedSummary(event, runControlTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("run.")) {
    return classifiedSummary(event, runEventTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("workspace.process.")) {
    return classifiedSummary(
      event,
      workspaceProcessEventTraceSummary(event),
      "fixed",
    );
  }
  if (event.type.startsWith("workspace.file.")) {
    return classifiedSummary(
      event,
      workspaceFileEventTraceSummary(event),
      "fixed",
    );
  }
  if (event.type.startsWith("subagent.")) {
    return classifiedSummary(event, subagentEventTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("model.advisor.")) {
    return classifiedSummary(
      event,
      modelAdvisorEventTraceSummary(event),
      "fixed",
    );
  }
  if (event.type.startsWith("model.")) {
    return classifiedSummary(event, modelEventTraceSummary(event), "fixed");
  }
  return traceSummaryBoundarySource(event) === "dedicated"
    ? { text: event.category, source: "category" }
    : genericSummary(event);
}

export function traceSummaryCoverageView(
  events: readonly RunEvent[],
): TraceSummaryCoverageView {
  const counts: TraceSummaryCoverageView = {
    total: events.length,
    bounded: 0,
    fixed: 0,
    category: 0,
    generic: 0,
    genericEventTypes: [],
  };
  const genericTypes = new Set<string>();
  for (const event of events) {
    const summary = traceEventSummaryView(event);
    counts[summary.source] += 1;
    if (summary.source === "generic") genericTypes.add(event.type);
  }
  counts.genericEventTypes = [...genericTypes].sort();
  return counts;
}

export function traceSummaryCoverageDeltaView(
  leftEvents: readonly RunEvent[],
  rightEvents: readonly RunEvent[],
): TraceSummaryCoverageDeltaView {
  const left = traceSummaryCoverageView(leftEvents);
  const right = traceSummaryCoverageView(rightEvents);
  const genericDelta = right.generic - left.generic;
  const diagnostics = [
    ...(genericDelta > 0
      ? ["candidate_generic_summary_fallback_increased"]
      : []),
    ...(right.generic > 0
      ? ["candidate_generic_summary_fallback_present"]
      : []),
  ];
  return {
    status:
      genericDelta > 0
        ? "regressed"
        : right.generic > 0
          ? "generic_present"
          : "clean",
    left,
    right,
    boundedDelta: right.bounded - left.bounded,
    fixedDelta: right.fixed - left.fixed,
    categoryDelta: right.category - left.category,
    genericDelta,
    diagnostics,
    genericEventTypes: right.genericEventTypes,
  };
}

export async function traceSummaryCoverageReceipt(
  coverage: TraceSummaryCoverageView,
): Promise<TraceSummaryCoverageReceipt> {
  const content = traceSummaryCoverageReceiptContent(coverage);
  return {
    ...content,
    contentSha256: await sha256Canonical(content),
  };
}

export async function traceSummaryCoverageDeltaReceipt(
  delta: TraceSummaryCoverageDeltaView,
): Promise<TraceSummaryCoverageDeltaReceipt> {
  const content = traceSummaryCoverageDeltaReceiptContent(delta);
  return {
    ...content,
    contentSha256: await sha256Canonical(content),
  };
}

export async function verifyTraceSummaryCoverageReceipt(
  input: unknown,
): Promise<TraceSummaryCoverageReceiptVerification> {
  const parsed = parseTraceSummaryCoverageReceipt(input);
  if (!parsed.ok) {
    return {
      status: "invalid",
      diagnostics: parsed.diagnostics,
      ...declaredContentSha256(input),
    };
  }
  const { contentSha256: _contentSha256, ...content } = parsed.receipt;
  const observedContentSha256 = await sha256Canonical(content);
  const diagnostics = [
    ...(observedContentSha256 !== parsed.receipt.contentSha256
      ? ["content_sha256_mismatch"]
      : []),
  ];
  return {
    status: diagnostics.length === 0 ? "valid" : "invalid",
    diagnostics,
    observedContentSha256,
    declaredContentSha256: parsed.receipt.contentSha256,
  };
}

export async function verifyTraceSummaryCoverageDeltaReceipt(
  input: unknown,
): Promise<TraceSummaryCoverageReceiptVerification> {
  const parsed = parseTraceSummaryCoverageDeltaReceipt(input);
  if (!parsed.ok) {
    return {
      status: "invalid",
      diagnostics: parsed.diagnostics,
      ...declaredContentSha256(input),
    };
  }
  const { contentSha256: _contentSha256, ...content } = parsed.receipt;
  const observedContentSha256 = await sha256Canonical(content);
  const diagnostics = [
    ...(observedContentSha256 !== parsed.receipt.contentSha256
      ? ["content_sha256_mismatch"]
      : []),
  ];
  return {
    status: diagnostics.length === 0 ? "valid" : "invalid",
    diagnostics,
    observedContentSha256,
    declaredContentSha256: parsed.receipt.contentSha256,
  };
}

function traceSummaryCoverageReceiptContent(
  coverage: TraceSummaryCoverageView,
): Omit<TraceSummaryCoverageReceipt, "contentSha256"> {
  return {
    kind: "napier.trace-summary-coverage",
    schemaVersion: 1,
    total: coverage.total,
    bounded: coverage.bounded,
    fixed: coverage.fixed,
    category: coverage.category,
    generic: coverage.generic,
    genericEventTypes: [...coverage.genericEventTypes],
  };
}

function traceSummaryCoverageDeltaReceiptContent(
  delta: TraceSummaryCoverageDeltaView,
): Omit<TraceSummaryCoverageDeltaReceipt, "contentSha256"> {
  return {
    kind: "napier.trace-summary-coverage-delta",
    schemaVersion: 1,
    status: delta.status,
    left: traceSummaryCoverageReceiptPayload(delta.left),
    right: traceSummaryCoverageReceiptPayload(delta.right),
    boundedDelta: delta.boundedDelta,
    fixedDelta: delta.fixedDelta,
    categoryDelta: delta.categoryDelta,
    genericDelta: delta.genericDelta,
    diagnostics: [...delta.diagnostics],
    genericEventTypes: [...delta.genericEventTypes],
  };
}

function traceSummaryCoverageReceiptPayload(
  coverage: TraceSummaryCoverageView,
): Omit<
  TraceSummaryCoverageReceipt,
  "kind" | "schemaVersion" | "contentSha256"
> {
  return {
    total: coverage.total,
    bounded: coverage.bounded,
    fixed: coverage.fixed,
    category: coverage.category,
    generic: coverage.generic,
    genericEventTypes: [...coverage.genericEventTypes],
  };
}

function parseTraceSummaryCoverageReceipt(
  input: unknown,
):
  | { ok: true; receipt: TraceSummaryCoverageReceipt }
  | { ok: false; diagnostics: string[] } {
  if (!record(input)) {
    return { ok: false, diagnostics: ["receipt_not_object"] };
  }
  const coverage = parseCoveragePayload(input);
  const contentSha256 = sha256String(input["contentSha256"]);
  const diagnostics = [
    ...(input["kind"] !== "napier.trace-summary-coverage"
      ? ["kind_invalid"]
      : []),
    ...(input["schemaVersion"] !== 1 ? ["schema_version_invalid"] : []),
    ...coverage.diagnostics,
    ...(contentSha256 ? [] : ["content_sha256_invalid"]),
  ];
  if (diagnostics.length > 0 || !coverage.value || !contentSha256) {
    return { ok: false, diagnostics };
  }
  return {
    ok: true,
    receipt: {
      kind: "napier.trace-summary-coverage",
      schemaVersion: 1,
      ...coverage.value,
      contentSha256,
    },
  };
}

function parseTraceSummaryCoverageDeltaReceipt(
  input: unknown,
):
  | { ok: true; receipt: TraceSummaryCoverageDeltaReceipt }
  | { ok: false; diagnostics: string[] } {
  if (!record(input)) {
    return { ok: false, diagnostics: ["receipt_not_object"] };
  }
  const left = parseCoveragePayload(input["left"]);
  const right = parseCoveragePayload(input["right"]);
  const status = safeDeltaStatus(input["status"]);
  const boundedDelta = nonNegativeOrNegativeInteger(input["boundedDelta"]);
  const fixedDelta = nonNegativeOrNegativeInteger(input["fixedDelta"]);
  const categoryDelta = nonNegativeOrNegativeInteger(input["categoryDelta"]);
  const genericDelta = nonNegativeOrNegativeInteger(input["genericDelta"]);
  const diagnosticsField = safeStringArray(input["diagnostics"]);
  const genericEventTypes = safeStringArray(input["genericEventTypes"]);
  const contentSha256 = sha256String(input["contentSha256"]);
  const expectedDiagnostics =
    left.value && right.value
      ? expectedTraceSummaryCoverageDiagnostics(left.value, right.value)
      : undefined;
  const expectedStatus =
    left.value && right.value
      ? expectedTraceSummaryCoverageStatus(left.value, right.value)
      : undefined;
  const expectedGenericDelta =
    left.value && right.value
      ? right.value.generic - left.value.generic
      : undefined;
  const diagnostics = [
    ...(input["kind"] !== "napier.trace-summary-coverage-delta"
      ? ["kind_invalid"]
      : []),
    ...(input["schemaVersion"] !== 1 ? ["schema_version_invalid"] : []),
    ...(status ? [] : ["status_invalid"]),
    ...left.diagnostics.map((item) => `left_${item}`),
    ...right.diagnostics.map((item) => `right_${item}`),
    ...(boundedDelta === undefined ? ["bounded_delta_invalid"] : []),
    ...(fixedDelta === undefined ? ["fixed_delta_invalid"] : []),
    ...(categoryDelta === undefined ? ["category_delta_invalid"] : []),
    ...(genericDelta === undefined ? ["generic_delta_invalid"] : []),
    ...(diagnosticsField ? [] : ["diagnostics_invalid"]),
    ...(genericEventTypes ? [] : ["generic_event_types_invalid"]),
    ...(contentSha256 ? [] : ["content_sha256_invalid"]),
    ...(left.value &&
    right.value &&
    boundedDelta !== right.value.bounded - left.value.bounded
      ? ["bounded_delta_mismatch"]
      : []),
    ...(left.value &&
    right.value &&
    fixedDelta !== right.value.fixed - left.value.fixed
      ? ["fixed_delta_mismatch"]
      : []),
    ...(left.value &&
    right.value &&
    categoryDelta !== right.value.category - left.value.category
      ? ["category_delta_mismatch"]
      : []),
    ...(expectedGenericDelta !== undefined &&
    genericDelta !== expectedGenericDelta
      ? ["generic_delta_mismatch"]
      : []),
    ...(status && expectedStatus && status !== expectedStatus
      ? ["status_mismatch"]
      : []),
    ...(diagnosticsField &&
    expectedDiagnostics &&
    !sameStringArray(diagnosticsField, expectedDiagnostics)
      ? ["diagnostics_mismatch"]
      : []),
    ...(genericEventTypes &&
    right.value &&
    !sameStringArray(genericEventTypes, right.value.genericEventTypes)
      ? ["generic_event_types_mismatch"]
      : []),
  ];
  if (
    diagnostics.length > 0 ||
    !left.value ||
    !right.value ||
    !status ||
    boundedDelta === undefined ||
    fixedDelta === undefined ||
    categoryDelta === undefined ||
    genericDelta === undefined ||
    !diagnosticsField ||
    !genericEventTypes ||
    !contentSha256
  ) {
    return { ok: false, diagnostics };
  }
  return {
    ok: true,
    receipt: {
      kind: "napier.trace-summary-coverage-delta",
      schemaVersion: 1,
      status,
      left: left.value,
      right: right.value,
      boundedDelta,
      fixedDelta,
      categoryDelta,
      genericDelta,
      diagnostics: diagnosticsField,
      genericEventTypes,
      contentSha256,
    },
  };
}

function parseCoveragePayload(input: unknown): {
  value?: Omit<
    TraceSummaryCoverageReceipt,
    "kind" | "schemaVersion" | "contentSha256"
  >;
  diagnostics: string[];
} {
  if (!record(input)) return { diagnostics: ["coverage_not_object"] };
  const total = nonNegativeInteger(input["total"]);
  const bounded = nonNegativeInteger(input["bounded"]);
  const fixed = nonNegativeInteger(input["fixed"]);
  const category = nonNegativeInteger(input["category"]);
  const generic = nonNegativeInteger(input["generic"]);
  const genericEventTypes = safeStringArray(input["genericEventTypes"]);
  const countMismatch =
    total !== undefined &&
    bounded !== undefined &&
    fixed !== undefined &&
    category !== undefined &&
    generic !== undefined &&
    total !== bounded + fixed + category + generic;
  const diagnostics = [
    ...(total === undefined ? ["total_invalid"] : []),
    ...(bounded === undefined ? ["bounded_invalid"] : []),
    ...(fixed === undefined ? ["fixed_invalid"] : []),
    ...(category === undefined ? ["category_invalid"] : []),
    ...(generic === undefined ? ["generic_invalid"] : []),
    ...(genericEventTypes ? [] : ["generic_event_types_invalid"]),
    ...(countMismatch ? ["count_mismatch"] : []),
  ];
  if (
    diagnostics.length > 0 ||
    total === undefined ||
    bounded === undefined ||
    fixed === undefined ||
    category === undefined ||
    generic === undefined ||
    !genericEventTypes
  ) {
    return { diagnostics };
  }
  return {
    value: {
      total,
      bounded,
      fixed,
      category,
      generic,
      genericEventTypes,
    },
    diagnostics: [],
  };
}

function expectedTraceSummaryCoverageDiagnostics(
  left: Pick<TraceSummaryCoverageView, "generic">,
  right: Pick<TraceSummaryCoverageView, "generic">,
): string[] {
  const genericDelta = right.generic - left.generic;
  return [
    ...(genericDelta > 0
      ? ["candidate_generic_summary_fallback_increased"]
      : []),
    ...(right.generic > 0
      ? ["candidate_generic_summary_fallback_present"]
      : []),
  ];
}

function expectedTraceSummaryCoverageStatus(
  left: Pick<TraceSummaryCoverageView, "generic">,
  right: Pick<TraceSummaryCoverageView, "generic">,
): TraceSummaryCoverageDeltaStatus {
  const genericDelta = right.generic - left.generic;
  return genericDelta > 0
    ? "regressed"
    : right.generic > 0
      ? "generic_present"
      : "clean";
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function nonNegativeOrNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function safeDeltaStatus(
  value: unknown,
): TraceSummaryCoverageDeltaStatus | undefined {
  return value === "clean" ||
    value === "generic_present" ||
    value === "regressed"
    ? value
    : undefined;
}

function safeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (item): item is string => typeof item === "string",
  );
  return strings.length === value.length &&
    strings.every((item) => /^[A-Za-z0-9_.:-]{1,180}$/u.test(item)) &&
    sameStringArray(strings, [...strings].sort())
    ? strings
    : undefined;
}

function sha256String(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function declaredContentSha256(input: unknown): {
  declaredContentSha256?: string;
} {
  if (!record(input)) return {};
  const value = input["contentSha256"];
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? { declaredContentSha256: value }
    : {};
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function classifiedSummary(
  event: RunEvent,
  summary: string | undefined,
  fixedFallbackSource: TraceEventSummarySource,
): TraceEventSummaryView {
  if (!summary || summary === event.category) {
    return { text: event.category, source: "category" };
  }
  if (summary.endsWith(" receipt")) {
    return { text: summary, source: fixedFallbackSource };
  }
  return { text: summary, source: "bounded" };
}

function genericSummary(event: RunEvent): TraceEventSummaryView {
  if (
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return { text: event.category, source: "category" };
  }
  for (const key of [
    "text",
    "message",
    "reason",
    "objective",
    "model",
    "source",
    "description",
    "result",
    "summary",
    "error",
    "toolName",
    "name",
    "trustStatus",
    "status",
  ]) {
    const value = event.payload[key];
    if (typeof value === "string" && value.trim()) {
      return {
        text: value.replace(/\s+/g, " ").trim().slice(0, 100),
        source: "generic",
      };
    }
  }
  return { text: event.category, source: "category" };
}
