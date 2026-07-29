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
  verificationStatus?: string;
  format?: string;
  declaredFormat?: string;
  observedFormat?: string;
  truncated?: boolean;
  declaredTruncated?: boolean;
  observedTruncated?: boolean;
  pathSha256?: string;
  sha256?: string;
  expectedSha256?: string;
  declaredSha256?: string;
  recomputedDeclaredSha256?: string;
  observedSha256?: string;
  textSha256?: string;
  columnSetSha256?: string;
  declaredColumnSetSha256?: string;
  recomputedDeclaredColumnSetSha256?: string;
  observedColumnSetSha256?: string;
  sampleSha256?: string;
  declaredSampleSha256?: string;
  recomputedDeclaredSampleSha256?: string;
  observedSampleSha256?: string;
  diagnosticsSha256?: string;
  declaredEntrySetSha256?: string;
  observedEntrySetSha256?: string;
  sizeBytes?: number;
  declaredSizeBytes?: number;
  expectedSizeBytes?: number;
  observedSizeBytes?: number;
  lineCount?: number;
  rowCount?: number;
  declaredRowCount?: number;
  observedRowCount?: number;
  columnCount?: number;
  declaredColumnCount?: number;
  observedColumnCount?: number;
  diagnosticCount?: number;
  entryCount?: number;
  declaredEntryCount?: number;
  observedEntryCount?: number;
  fileCount?: number;
  declaredFileCount?: number;
  observedFileCount?: number;
  directoryCount?: number;
  declaredDirectoryCount?: number;
  observedDirectoryCount?: number;
}

const ARTIFACT_EVENT =
  /^artifact\.(data_profile_verified|data_profiled|directory_manifest_verified|directory_manifested|drift_checked|exported|file_verified|previewed)$/u;
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
    ...safeTokenField(event.payload, "verificationStatus"),
    ...safeTokenField(event.payload, "format"),
    ...safeTokenField(event.payload, "declaredFormat"),
    ...safeTokenField(event.payload, "observedFormat"),
    ...booleanField(event.payload, "truncated"),
    ...booleanField(event.payload, "declaredTruncated"),
    ...booleanField(event.payload, "observedTruncated"),
    ...shaField(event.payload, "pathSha256"),
    ...shaField(event.payload, "sha256"),
    ...shaField(event.payload, "expectedSha256"),
    ...shaField(event.payload, "declaredSha256"),
    ...shaField(event.payload, "recomputedDeclaredSha256"),
    ...shaField(event.payload, "observedSha256"),
    ...shaField(event.payload, "textSha256"),
    ...shaField(event.payload, "columnSetSha256"),
    ...shaField(event.payload, "declaredColumnSetSha256"),
    ...shaField(event.payload, "recomputedDeclaredColumnSetSha256"),
    ...shaField(event.payload, "observedColumnSetSha256"),
    ...shaField(event.payload, "sampleSha256"),
    ...shaField(event.payload, "declaredSampleSha256"),
    ...shaField(event.payload, "recomputedDeclaredSampleSha256"),
    ...shaField(event.payload, "observedSampleSha256"),
    ...shaField(event.payload, "diagnosticsSha256"),
    ...shaField(event.payload, "declaredEntrySetSha256"),
    ...shaField(event.payload, "observedEntrySetSha256"),
    ...integerField(event.payload, "sizeBytes"),
    ...integerField(event.payload, "declaredSizeBytes"),
    ...integerField(event.payload, "expectedSizeBytes"),
    ...integerField(event.payload, "observedSizeBytes"),
    ...integerField(event.payload, "lineCount"),
    ...integerField(event.payload, "rowCount"),
    ...integerField(event.payload, "declaredRowCount"),
    ...integerField(event.payload, "observedRowCount"),
    ...integerField(event.payload, "columnCount"),
    ...integerField(event.payload, "declaredColumnCount"),
    ...integerField(event.payload, "observedColumnCount"),
    ...integerField(event.payload, "diagnosticCount"),
    ...integerField(event.payload, "entryCount"),
    ...integerField(event.payload, "declaredEntryCount"),
    ...integerField(event.payload, "observedEntryCount"),
    ...integerField(event.payload, "fileCount"),
    ...integerField(event.payload, "declaredFileCount"),
    ...integerField(event.payload, "observedFileCount"),
    ...integerField(event.payload, "directoryCount"),
    ...integerField(event.payload, "declaredDirectoryCount"),
    ...integerField(event.payload, "observedDirectoryCount"),
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
    ...(view.verificationStatus
      ? [`verification ${view.verificationStatus}`]
      : []),
    ...(view.format
      ? [`format ${structuredDataFormatLabel(view.format)}`]
      : []),
    ...(view.declaredFormat || view.observedFormat
      ? [
          `formats ${formatDataFormatPair(view.declaredFormat, view.observedFormat)}`,
        ]
      : []),
    ...(view.truncated !== undefined ? [`truncated ${view.truncated}`] : []),
    ...(view.declaredTruncated !== undefined ||
    view.observedTruncated !== undefined
      ? [
          `truncated ${formatBooleanPair(view.declaredTruncated, view.observedTruncated)}`,
        ]
      : []),
    ...(view.sizeBytes !== undefined ? [`size-bytes ${view.sizeBytes}`] : []),
    ...(view.declaredSizeBytes !== undefined
      ? [
          `size-bytes ${formatNumberPair(view.declaredSizeBytes, view.observedSizeBytes)}`,
        ]
      : []),
    ...(view.expectedSizeBytes !== undefined
      ? [
          `size-bytes ${formatNumberPair(view.expectedSizeBytes, view.observedSizeBytes)}`,
        ]
      : []),
    ...(view.lineCount !== undefined ? [`lines ${view.lineCount}`] : []),
    ...(view.rowCount !== undefined ? [`rows ${view.rowCount}`] : []),
    ...(view.declaredRowCount !== undefined ||
    view.observedRowCount !== undefined
      ? [
          `rows ${formatNumberPair(view.declaredRowCount, view.observedRowCount)}`,
        ]
      : []),
    ...(view.columnCount !== undefined ? [`columns ${view.columnCount}`] : []),
    ...(view.declaredColumnCount !== undefined ||
    view.observedColumnCount !== undefined
      ? [
          `columns ${formatNumberPair(view.declaredColumnCount, view.observedColumnCount)}`,
        ]
      : []),
    ...(view.diagnosticCount !== undefined
      ? [`diagnostics ${view.diagnosticCount}`]
      : []),
    ...(view.entryCount !== undefined ? [`entries ${view.entryCount}`] : []),
    ...(view.declaredEntryCount !== undefined ||
    view.observedEntryCount !== undefined
      ? [
          `entries ${formatNumberPair(view.declaredEntryCount, view.observedEntryCount)}`,
        ]
      : []),
    ...(view.fileCount !== undefined ? [`files ${view.fileCount}`] : []),
    ...(view.declaredFileCount !== undefined ||
    view.observedFileCount !== undefined
      ? [
          `files ${formatNumberPair(view.declaredFileCount, view.observedFileCount)}`,
        ]
      : []),
    ...(view.directoryCount !== undefined
      ? [`directories ${view.directoryCount}`]
      : []),
    ...(view.declaredDirectoryCount !== undefined ||
    view.observedDirectoryCount !== undefined
      ? [
          `directories ${formatNumberPair(view.declaredDirectoryCount, view.observedDirectoryCount)}`,
        ]
      : []),
    ...hashSummary("path", view.pathSha256),
    ...hashSummary("artifact", view.sha256),
    ...hashSummary("expected", view.expectedSha256),
    ...hashSummary("declared", view.declaredSha256),
    ...hashSummary("declared-self", view.recomputedDeclaredSha256),
    ...hashSummary("observed", view.observedSha256),
    ...hashSummary("text", view.textSha256),
    ...hashSummary("columns", view.columnSetSha256),
    ...hashSummary("declared-columns", view.declaredColumnSetSha256),
    ...hashSummary(
      "declared-columns-self",
      view.recomputedDeclaredColumnSetSha256,
    ),
    ...hashSummary("observed-columns", view.observedColumnSetSha256),
    ...hashSummary("sample", view.sampleSha256),
    ...hashSummary("declared-sample", view.declaredSampleSha256),
    ...hashSummary("declared-sample-self", view.recomputedDeclaredSampleSha256),
    ...hashSummary("observed-sample", view.observedSampleSha256),
    ...hashSummary("declared-entries", view.declaredEntrySetSha256),
    ...hashSummary("observed-entries", view.observedEntrySetSha256),
    ...hashSummary("diagnostics", view.diagnosticsSha256),
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

function formatNumberPair(
  declared: number | undefined,
  observed: number | undefined,
): string {
  return `${declared ?? "?"}->${observed ?? "?"}`;
}

function formatBooleanPair(
  declared: boolean | undefined,
  observed: boolean | undefined,
): string {
  return `${declared ?? "?"}->${observed ?? "?"}`;
}

function formatDataFormatPair(
  declared: string | undefined,
  observed: string | undefined,
): string {
  return `${formatDataFormat(declared)}->${formatDataFormat(observed)}`;
}

function formatDataFormat(value: string | undefined): string {
  return value ? structuredDataFormatLabel(value) : "?";
}
