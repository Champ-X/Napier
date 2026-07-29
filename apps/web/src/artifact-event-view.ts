import type { RunEvent } from "@napier/contracts";
import { structuredDataFormatLabel } from "./structured-data-format-view";

export interface ArtifactEventTraceView {
  action: string;
  planId?: string;
  artifactId?: string;
  planRevision?: number;
  status?: string;
  kind?: string;
  result?: string;
  format?: string;
  truncated?: boolean;
  pathSha256?: string;
  sha256?: string;
  expectedSha256?: string;
  observedSha256?: string;
  textSha256?: string;
  columnSetSha256?: string;
  sampleSha256?: string;
  sizeBytes?: number;
  lineCount?: number;
  rowCount?: number;
  columnCount?: number;
  entryCount?: number;
  fileCount?: number;
  directoryCount?: number;
}

const ARTIFACT_EVENT =
  /^artifact\.(data_profiled|directory_manifested|drift_checked|exported|previewed)$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,120}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ARTIFACT_RECEIPT_SUMMARY = "artifact receipt";

export function artifactEventTraceView(
  event: RunEvent,
): ArtifactEventTraceView | undefined {
  if (!ARTIFACT_EVENT.test(event.type)) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  return {
    action: event.type.slice("artifact.".length),
    ...safeIdField(event.payload, "planId"),
    ...safeIdField(event.payload, "artifactId"),
    ...integerField(event.payload, "planRevision"),
    ...safeTokenField(event.payload, "status"),
    ...safeTokenField(event.payload, "kind"),
    ...safeTokenField(event.payload, "result"),
    ...safeTokenField(event.payload, "format"),
    ...booleanField(event.payload, "truncated"),
    ...shaField(event.payload, "pathSha256"),
    ...shaField(event.payload, "sha256"),
    ...shaField(event.payload, "expectedSha256"),
    ...shaField(event.payload, "observedSha256"),
    ...shaField(event.payload, "textSha256"),
    ...shaField(event.payload, "columnSetSha256"),
    ...shaField(event.payload, "sampleSha256"),
    ...integerField(event.payload, "sizeBytes"),
    ...integerField(event.payload, "lineCount"),
    ...integerField(event.payload, "rowCount"),
    ...integerField(event.payload, "columnCount"),
    ...integerField(event.payload, "entryCount"),
    ...integerField(event.payload, "fileCount"),
    ...integerField(event.payload, "directoryCount"),
  };
}

export function artifactEventTraceSummary(event: RunEvent): string | undefined {
  if (!event.type.startsWith("artifact.")) return undefined;
  if (!ARTIFACT_EVENT.test(event.type)) return event.category;
  const view = artifactEventTraceView(event);
  if (!view) return ARTIFACT_RECEIPT_SUMMARY;
  return [
    `artifact / ${view.action}`,
    ...idSummary("plan", view.planId),
    ...idSummary("artifact", view.artifactId),
    ...(view.planRevision !== undefined ? [`plan-r${view.planRevision}`] : []),
    ...(view.status ? [`status ${view.status}`] : []),
    ...(view.kind ? [`kind ${view.kind}`] : []),
    ...(view.result ? [`result ${view.result}`] : []),
    ...(view.format
      ? [`format ${structuredDataFormatLabel(view.format)}`]
      : []),
    ...(view.truncated !== undefined ? [`truncated ${view.truncated}`] : []),
    ...(view.sizeBytes !== undefined ? [`size-bytes ${view.sizeBytes}`] : []),
    ...(view.lineCount !== undefined ? [`lines ${view.lineCount}`] : []),
    ...(view.rowCount !== undefined ? [`rows ${view.rowCount}`] : []),
    ...(view.columnCount !== undefined ? [`columns ${view.columnCount}`] : []),
    ...(view.entryCount !== undefined ? [`entries ${view.entryCount}`] : []),
    ...(view.fileCount !== undefined ? [`files ${view.fileCount}`] : []),
    ...(view.directoryCount !== undefined
      ? [`directories ${view.directoryCount}`]
      : []),
    ...hashSummary("path", view.pathSha256),
    ...hashSummary("artifact", view.sha256),
    ...hashSummary("expected", view.expectedSha256),
    ...hashSummary("observed", view.observedSha256),
    ...hashSummary("text", view.textSha256),
    ...hashSummary("columns", view.columnSetSha256),
    ...hashSummary("sample", view.sampleSha256),
  ].join(" / ");
}

function safeIdField(
  payload: Record<string, unknown>,
  key: keyof ArtifactEventTraceView,
): Partial<ArtifactEventTraceView> {
  const value = payload[key];
  return typeof value === "string" && SAFE_TOKEN.test(value)
    ? { [key]: value }
    : {};
}

function safeTokenField(
  payload: Record<string, unknown>,
  key: keyof ArtifactEventTraceView,
): Partial<ArtifactEventTraceView> {
  const value = payload[key];
  return typeof value === "string" && SAFE_TOKEN.test(value)
    ? { [key]: value }
    : {};
}

function shaField(
  payload: Record<string, unknown>,
  key: keyof ArtifactEventTraceView,
): Partial<ArtifactEventTraceView> {
  const value = payload[key];
  return typeof value === "string" && SHA256.test(value)
    ? { [key]: value }
    : {};
}

function integerField(
  payload: Record<string, unknown>,
  key: keyof ArtifactEventTraceView,
): Partial<ArtifactEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { [key]: value }
    : {};
}

function booleanField(
  payload: Record<string, unknown>,
  key: keyof ArtifactEventTraceView,
): Partial<ArtifactEventTraceView> {
  const value = payload[key];
  return typeof value === "boolean" ? { [key]: value } : {};
}

function idSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(-10)}`] : [];
}

function hashSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}
