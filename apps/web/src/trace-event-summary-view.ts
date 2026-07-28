import type { RunEvent } from "@napier/contracts";

import { agentEventTraceSummary } from "./agent-event-view";
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
import { subagentEventTraceSummary } from "./subagent-event-view";
import { threadImportedSummary } from "./thread-imported-view";
import { toolEventTraceSummary } from "./tool-event-view";

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
    return classifiedSummary(event, credentialEventTraceSummary(event), "fixed");
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
    return classifiedSummary(event, evaluationEventTraceSummary(event), "fixed");
  }
  if (event.type.startsWith("plan.")) {
    return classifiedSummary(event, planEventTraceSummary(event), "fixed");
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
  return genericSummary(event);
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
    ...(right.generic > 0 ? ["candidate_generic_summary_fallback_present"] : []),
  ];
  return {
    status:
      genericDelta > 0 ? "regressed" : right.generic > 0 ? "generic_present" : "clean",
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
