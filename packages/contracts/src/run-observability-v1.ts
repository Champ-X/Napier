import type { RunEvent } from "./execution-core.js";
import type { RunConfigurationDelta, RunMetricDelta } from "./execution-runs.js";
import type { RunReplaySnapshot } from "./workspace-control-v1.js";

export type OtlpAnyValue = { stringValue: string } | { boolValue: boolean } | { intValue: string } | { doubleValue: number };

export interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

export interface OtlpSpanEvent {
  timeUnixNano: string;
  name: string;
  attributes: OtlpKeyValue[];
  droppedAttributesCount: number;
}

export interface OtlpSpanStatus {
  code: 0 | 1 | 2;
  message?: string;
}

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceState: string;
  name: string;
  kind: 1 | 3;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpKeyValue[];
  droppedAttributesCount: number;
  events: OtlpSpanEvent[];
  droppedEventsCount: number;
  links: [];
  droppedLinksCount: number;
  status: OtlpSpanStatus;
  flags: 1;
}

export interface OtlpExportTraceServiceRequest {
  resourceSpans: Array<{
    resource: {
      attributes: OtlpKeyValue[];
      droppedAttributesCount: number;
    };
    scopeSpans: Array<{
      scope: {
        name: string;
        version: string;
      };
      spans: OtlpSpan[];
      schemaUrl: string;
    }>;
    schemaUrl: string;
  }>;
}

export interface OpenTelemetryTraceArtifact {
  kind: "napier.opentelemetry-trace";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  threadId: string;
  runId?: string;
  traceId: string;
  eventRange: {
    fromSeq: number;
    toSeq: number;
    eventCount: number;
    eventStreamSha256: string;
  };
  spanCount: number;
  redaction: {
    mode: "metadata_only";
    contentCapture: false;
    excludedEventTypes: string[];
    excludedPayloadKeys: string[];
  };
  otlp: OtlpExportTraceServiceRequest;
  contentSha256: string;
}

export interface ExportOpenTelemetryTraceRequest {
  runId?: string;
}

export interface VerifyOpenTelemetryTraceArtifactRequest {
  artifact: OpenTelemetryTraceArtifact;
}

export type OpenTelemetryTraceArtifactVerificationStatus = "valid" | "invalid";

export interface OpenTelemetryTraceArtifactVerification {
  status: OpenTelemetryTraceArtifactVerificationStatus;
  diagnostics: string[];
  spanCount: number;
  eventCount: number;
  threadId?: string;
  runId?: string;
  traceId?: string;
  contentSha256?: string;
  eventStreamSha256?: string;
  eventAnchorSetSha256?: string;
}

export type RunContextCoverageStatus = "clean" | "partial" | "missing" | "regressed";

export interface RunContextCoverageSummary {
  modelResponseCount: number;
  envelopeCount: number;
  embeddedEnvelopeCount: number;
  boundResponseCount: number;
  unboundResponseCount: number;
  coverageRate: number;
}

export interface RunContextCoverageDelta {
  status: RunContextCoverageStatus;
  left: RunContextCoverageSummary;
  right: RunContextCoverageSummary;
  coverageRateDelta: number;
  embeddedEnvelopeDelta: number;
  diagnostics: string[];
}

export type TraceSummaryBoundarySource = "dedicated" | "generic";

export type RunTraceSummaryBoundaryStatus = "clean" | "generic_present" | "regressed";

export interface RunTraceSummaryBoundaryCoverage {
  total: number;
  dedicated: number;
  generic: number;
  genericEventTypes: string[];
}

export interface RunTraceSummaryBoundaryDelta {
  status: RunTraceSummaryBoundaryStatus;
  left: RunTraceSummaryBoundaryCoverage;
  right: RunTraceSummaryBoundaryCoverage;
  dedicatedDelta: number;
  genericDelta: number;
  diagnostics: string[];
  genericEventTypes: string[];
}

export interface RunEvaluationGovernanceBinding {
  kind: "napier.run-evaluation-governance";
  schemaVersion: 1;
  contextCoverageStatus: RunContextCoverageStatus;
  contextCoverageRateDelta: number;
  contextCoverageDiagnosticsSha256: string;
  contextCoverageDeltaSha256: string;
  traceSummaryBoundaryStatus?: RunTraceSummaryBoundaryStatus;
  traceSummaryBoundaryGenericDelta?: number;
  traceSummaryBoundaryDiagnosticsSha256?: string;
  traceSummaryBoundaryDeltaSha256?: string;
  contentSha256: string;
}

export interface RunComparison {
  threadId: string;
  left: RunReplaySnapshot;
  right: RunReplaySnapshot;
  metricDelta: RunMetricDelta;
  outputChanged: boolean;
  eventTypeDelta: Record<string, number>;
  addedToolNames: string[];
  removedToolNames: string[];
  configurationDelta: RunConfigurationDelta;
  contextCoverageDelta: RunContextCoverageDelta;
  traceSummaryBoundaryDelta: RunTraceSummaryBoundaryDelta;
  harness: import("./run-harness-effects.js").RunHarnessComparison;
}

const TRACE_SUMMARY_BOUNDARY_EXACT_EVENT_TYPES = new Set(["trace.otlp.exported", "thread.imported", "model.response"]);

const TRACE_SUMMARY_BOUNDARY_EVENT_PREFIXES = [
  "message.",
  "system.",
  "agent.",
  "branch.",
  "schedule.",
  "channel.",
  "credential.",
  "extension.",
  "skill.",
  "prompt.",
  "inspector.",
  "receipt.",
  "receipt_trust.",
  "context.",
  "evaluation.",
  "plan.",
  "workflow.",
  "tool.",
  "goal.",
  "memory.",
  "operator.decision.",
  "run.control.",
  "run.",
  "workspace.process.",
  "workspace.file.",
  "subagent.",
  "model.advisor.",
  "model.",
];

export function traceSummaryBoundarySource(event: Pick<RunEvent, "type"> | string): TraceSummaryBoundarySource {
  const type = typeof event === "string" ? event : event.type;
  return TRACE_SUMMARY_BOUNDARY_EXACT_EVENT_TYPES.has(type) || TRACE_SUMMARY_BOUNDARY_EVENT_PREFIXES.some((prefix) => type.startsWith(prefix)) ? "dedicated" : "generic";
}

export function traceSummaryBoundaryCoverage(events: readonly Pick<RunEvent, "type">[]): RunTraceSummaryBoundaryCoverage {
  const genericTypes = new Set<string>();
  let dedicated = 0;
  let generic = 0;
  for (const event of events) {
    if (traceSummaryBoundarySource(event) === "dedicated") {
      dedicated += 1;
      continue;
    }
    generic += 1;
    genericTypes.add(event.type);
  }
  return {
    total: events.length,
    dedicated,
    generic,
    genericEventTypes: [...genericTypes].sort(),
  };
}

export function traceSummaryBoundaryDelta(leftEvents: readonly Pick<RunEvent, "type">[], rightEvents: readonly Pick<RunEvent, "type">[]): RunTraceSummaryBoundaryDelta {
  const left = traceSummaryBoundaryCoverage(leftEvents);
  const right = traceSummaryBoundaryCoverage(rightEvents);
  const genericDelta = right.generic - left.generic;
  const diagnostics = [...(genericDelta > 0 ? ["candidate_trace_summary_generic_fallback_increased"] : []), ...(right.generic > 0 ? ["candidate_trace_summary_generic_fallback_present"] : [])];
  return {
    status: genericDelta > 0 ? "regressed" : right.generic > 0 ? "generic_present" : "clean",
    left,
    right,
    dedicatedDelta: right.dedicated - left.dedicated,
    genericDelta,
    diagnostics,
    genericEventTypes: right.genericEventTypes,
  };
}
