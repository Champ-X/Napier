export interface ResearchSourceToolEventTraceView {
  researchSourceAction?:
    | "capture"
    | "capture_fetch"
    | "cite"
    | "verify_report"
    | "list";
  researchSourceKind?: "browser" | "web_fetch";
  researchSourceId?: string;
  researchCitationId?: string;
  researchCitationTokenSha256?: string;
  researchSourceContentSha256?: string;
  researchSourceUrlSha256?: string;
  researchSourceOriginSha256?: string;
  researchSourceTitleSha256?: string;
  researchSourceTextSha256?: string;
  researchSourceLineCount?: number;
  researchSourceTextChars?: number;
  researchSourceTruncated?: boolean;
  researchCitationStartLine?: number;
  researchCitationEndLine?: number;
  researchCitationQuoteSha256?: string;
  researchCitationClaimSha256?: string;
  researchReportPathSha256?: string;
  researchReportFileSha256?: string;
  researchReportFileBytes?: number;
  researchReportCitationCount?: number;
  researchReportCitationSetSha256?: string;
  researchSourceCount?: number;
  researchCitationCount?: number;
  researchSourceSetSha256?: string;
  researchBrowserSessionOperation?: number;
  researchBrowserSessionIdSha256?: string;
  researchBrowserExecutableSha256?: string;
  researchBrowserVersionSha256?: string;
  researchBrowserLimitsSha256?: string;
  researchBrowserNetworkDestinationsSha256?: string;
  researchWebSourceContentSha256?: string;
  researchWebSourceBodySha256?: string;
  researchWebSourceFormat?: "html" | "markdown" | "json" | "text" | "pdf";
  researchWebSourceLineCount?: number;
}

const ACTIONS = new Set<
  ResearchSourceToolEventTraceView["researchSourceAction"]
>(["capture", "capture_fetch", "cite", "verify_report", "list"]);
const SOURCE_ID = /^source_[a-z0-9]{8,80}$/u;
const CITATION_ID = /^citation_[a-z0-9]{8,80}$/u;
const SOURCE_FIELDS = [
  "sourceId",
  "sourceContentSha256",
  "sourceUrlSha256",
  "sourceOriginSha256",
  "sourceTitleSha256",
  "sourceTextSha256",
  "sourceLineCount",
  "sourceTextChars",
  "sourceTruncated",
  "browserSessionOperation",
  "browserSessionIdSha256",
  "browserExecutableSha256",
  "browserVersionSha256",
  "browserLimitsSha256",
  "browserNetworkDestinationsSha256",
] as const;
const CITATION_FIELDS = [
  "citationId",
  "citationTokenSha256",
  "citationStartLine",
  "citationEndLine",
  "citationQuoteSha256",
  "citationClaimSha256",
] as const;
const BROWSER_FIELDS = [
  "browserSessionOperation",
  "browserSessionIdSha256",
  "browserExecutableSha256",
  "browserVersionSha256",
  "browserLimitsSha256",
  "browserNetworkDestinationsSha256",
] as const;
const WEB_FETCH_FIELDS = [
  "webSourceContentSha256",
  "webSourceBodySha256",
  "webSourceFormat",
  "webSourceLineCount",
] as const;
const REPORT_FIELDS = [
  "reportPathSha256",
  "reportFileSha256",
  "reportFileBytes",
  "reportCitationCount",
  "reportCitationSetSha256",
] as const;

export function researchSourceEventEvidence(
  value: unknown,
): ResearchSourceToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const action = ACTIONS.has(
    value["action"] as ResearchSourceToolEventTraceView["researchSourceAction"],
  )
    ? (value[
        "action"
      ] as ResearchSourceToolEventTraceView["researchSourceAction"])
    : undefined;
  const sourceCount = integer(value["sourceCount"], 0, 16);
  const citationCount = integer(value["citationCount"], 0, 64);
  if (
    value["kind"] !== "napier.research-source" ||
    value["schemaVersion"] !== 1 ||
    !action ||
    sourceCount === undefined ||
    citationCount === undefined ||
    (sourceCount === 0 && citationCount !== 0) ||
    !sha256(value["sourceSetSha256"])
  ) {
    return undefined;
  }
  const counts = { sourceCount, citationCount };
  if (action === "list") return listEvidence(value, counts);
  if (action === "verify_report") {
    return reportEvidence(value, counts);
  }
  return sourceOrCitationEvidence(value, action, counts);
}

function sourceOrCitationEvidence(
  value: Record<string, unknown>,
  action: "capture" | "capture_fetch" | "cite",
  counts: { sourceCount: number; citationCount: number },
): ResearchSourceToolEventTraceView | undefined {
  const sourceId =
    typeof value["sourceId"] === "string" && SOURCE_ID.test(value["sourceId"])
      ? value["sourceId"]
      : undefined;
  const sourceKind =
    value["sourceKind"] === "browser" || value["sourceKind"] === "web_fetch"
      ? value["sourceKind"]
      : undefined;
  const sourceLineCount = integer(value["sourceLineCount"], 1, 400);
  const sourceTextChars = integer(value["sourceTextChars"], 1, 24_000);
  if (
    !sourceId ||
    !sourceKind ||
    !sha256(value["sourceContentSha256"]) ||
    !sha256(value["sourceUrlSha256"]) ||
    !sha256(value["sourceOriginSha256"]) ||
    !sha256(value["sourceTitleSha256"]) ||
    !sha256(value["sourceTextSha256"]) ||
    sourceLineCount === undefined ||
    sourceTextChars === undefined ||
    sourceTextChars < sourceLineCount * 2 - 1 ||
    typeof value["sourceTruncated"] !== "boolean" ||
    counts.sourceCount < 1
  ) {
    return undefined;
  }
  const provenance = sourceProvenance(value, sourceKind);
  if (!provenance) return undefined;
  const sourceEvidence: ResearchSourceToolEventTraceView = {
    researchSourceAction: action,
    researchSourceKind: sourceKind,
    researchSourceId: sourceId,
    researchSourceContentSha256: value["sourceContentSha256"],
    researchSourceUrlSha256: value["sourceUrlSha256"],
    researchSourceOriginSha256: value["sourceOriginSha256"],
    researchSourceTitleSha256: value["sourceTitleSha256"],
    researchSourceTextSha256: value["sourceTextSha256"],
    researchSourceLineCount: sourceLineCount,
    researchSourceTextChars: sourceTextChars,
    researchSourceTruncated: value["sourceTruncated"],
    researchSourceCount: counts.sourceCount,
    researchCitationCount: counts.citationCount,
    researchSourceSetSha256: value["sourceSetSha256"] as string,
    ...provenance,
  };
  if (action === "capture" || action === "capture_fetch") {
    if (
      (action === "capture" && sourceKind !== "browser") ||
      (action === "capture_fetch" && sourceKind !== "web_fetch")
    ) {
      return undefined;
    }
    return CITATION_FIELDS.some((field) => value[field] !== undefined) ||
      REPORT_FIELDS.some((field) => value[field] !== undefined)
      ? undefined
      : sourceEvidence;
  }

  const citationId =
    typeof value["citationId"] === "string" &&
    CITATION_ID.test(value["citationId"])
      ? value["citationId"]
      : undefined;
  const startLine = integer(value["citationStartLine"], 1, 400);
  const endLine = integer(value["citationEndLine"], 1, 400);
  if (
    !citationId ||
    !sha256(value["citationTokenSha256"]) ||
    startLine === undefined ||
    endLine === undefined ||
    endLine < startLine ||
    endLine > sourceLineCount ||
    endLine - startLine + 1 > 40 ||
    !sha256(value["citationQuoteSha256"]) ||
    !sha256(value["citationClaimSha256"]) ||
    counts.citationCount < 1 ||
    REPORT_FIELDS.some((field) => value[field] !== undefined)
  ) {
    return undefined;
  }
  return {
    ...sourceEvidence,
    researchCitationId: citationId,
    researchCitationTokenSha256: value["citationTokenSha256"],
    researchCitationStartLine: startLine,
    researchCitationEndLine: endLine,
    researchCitationQuoteSha256: value["citationQuoteSha256"],
    researchCitationClaimSha256: value["citationClaimSha256"],
  };
}

function listEvidence(
  value: Record<string, unknown>,
  counts: { sourceCount: number; citationCount: number },
): ResearchSourceToolEventTraceView | undefined {
  if (
    SOURCE_FIELDS.some((field) => value[field] !== undefined) ||
    CITATION_FIELDS.some((field) => value[field] !== undefined) ||
    value["sourceKind"] !== undefined ||
    WEB_FETCH_FIELDS.some((field) => value[field] !== undefined) ||
    REPORT_FIELDS.some((field) => value[field] !== undefined)
  ) {
    return undefined;
  }
  return {
    researchSourceAction: "list",
    researchSourceCount: counts.sourceCount,
    researchCitationCount: counts.citationCount,
    researchSourceSetSha256: value["sourceSetSha256"] as string,
  };
}

function reportEvidence(
  value: Record<string, unknown>,
  counts: { sourceCount: number; citationCount: number },
): ResearchSourceToolEventTraceView | undefined {
  const reportFileBytes = integer(value["reportFileBytes"], 1, 256 * 1024);
  const reportCitationCount = integer(value["reportCitationCount"], 1, 64);
  if (
    SOURCE_FIELDS.some((field) => value[field] !== undefined) ||
    CITATION_FIELDS.some((field) => value[field] !== undefined) ||
    value["sourceKind"] !== undefined ||
    WEB_FETCH_FIELDS.some((field) => value[field] !== undefined) ||
    counts.sourceCount < 1 ||
    counts.citationCount < 1 ||
    !sha256(value["reportPathSha256"]) ||
    !sha256(value["reportFileSha256"]) ||
    reportFileBytes === undefined ||
    reportCitationCount === undefined ||
    reportCitationCount > counts.citationCount ||
    !sha256(value["reportCitationSetSha256"])
  ) {
    return undefined;
  }
  return {
    researchSourceAction: "verify_report",
    researchSourceCount: counts.sourceCount,
    researchCitationCount: counts.citationCount,
    researchSourceSetSha256: value["sourceSetSha256"] as string,
    researchReportPathSha256: value["reportPathSha256"] as string,
    researchReportFileSha256: value["reportFileSha256"] as string,
    researchReportFileBytes: reportFileBytes,
    researchReportCitationCount: reportCitationCount,
    researchReportCitationSetSha256: value["reportCitationSetSha256"] as string,
  };
}

export function researchSourceSummaryParts(
  view: ResearchSourceToolEventTraceView,
): string[] {
  return [
    ...(view.researchSourceAction
      ? [`research-source ${view.researchSourceAction}`]
      : []),
    ...(view.researchSourceKind
      ? [`source-kind ${view.researchSourceKind}`]
      : []),
    ...(view.researchSourceCount !== undefined
      ? [`sources ${view.researchSourceCount}`]
      : []),
    ...(view.researchCitationCount !== undefined
      ? [`citations ${view.researchCitationCount}`]
      : []),
    ...(view.researchSourceLineCount !== undefined
      ? [`source-lines ${view.researchSourceLineCount}`]
      : []),
    ...(view.researchSourceTextChars !== undefined
      ? [`source-chars ${view.researchSourceTextChars}`]
      : []),
    ...(view.researchSourceTruncated ? ["source-truncated"] : []),
    ...(view.researchCitationStartLine !== undefined &&
    view.researchCitationEndLine !== undefined
      ? [
          `citation-range ${view.researchCitationStartLine}-${view.researchCitationEndLine}`,
        ]
      : []),
    ...(view.researchReportFileBytes !== undefined
      ? [`report-bytes ${view.researchReportFileBytes}`]
      : []),
    ...(view.researchReportCitationCount !== undefined
      ? [`report-citations ${view.researchReportCitationCount}`]
      : []),
    ...(view.researchBrowserSessionOperation !== undefined
      ? [`browser-operation ${view.researchBrowserSessionOperation}`]
      : []),
    ...(view.researchWebSourceFormat
      ? [`web-source-format ${view.researchWebSourceFormat}`]
      : []),
    ...(view.researchWebSourceLineCount !== undefined
      ? [`web-source-lines ${view.researchWebSourceLineCount}`]
      : []),
    ...hash("source-content", view.researchSourceContentSha256),
    ...hash("source-set", view.researchSourceSetSha256),
    ...hash("citation-quote", view.researchCitationQuoteSha256),
    ...hash("citation-claim", view.researchCitationClaimSha256),
    ...hash("report-path", view.researchReportPathSha256),
    ...hash("report-file", view.researchReportFileSha256),
    ...hash("report-citation-set", view.researchReportCitationSetSha256),
    ...hash("browser-session", view.researchBrowserSessionIdSha256),
    ...hash(
      "browser-destinations",
      view.researchBrowserNetworkDestinationsSha256,
    ),
    ...hash("web-source-content", view.researchWebSourceContentSha256),
    ...hash("web-source-body", view.researchWebSourceBodySha256),
  ];
}

function sourceProvenance(
  value: Record<string, unknown>,
  sourceKind: "browser" | "web_fetch",
): ResearchSourceToolEventTraceView | undefined {
  if (sourceKind === "browser") {
    const operation = integer(value["browserSessionOperation"], 1, 64);
    if (
      operation === undefined ||
      !sha256(value["browserSessionIdSha256"]) ||
      !sha256(value["browserExecutableSha256"]) ||
      !sha256(value["browserVersionSha256"]) ||
      !sha256(value["browserLimitsSha256"]) ||
      !sha256(value["browserNetworkDestinationsSha256"]) ||
      WEB_FETCH_FIELDS.some((field) => value[field] !== undefined)
    ) {
      return undefined;
    }
    return {
      researchBrowserSessionOperation: operation,
      researchBrowserSessionIdSha256: value["browserSessionIdSha256"],
      researchBrowserExecutableSha256: value["browserExecutableSha256"],
      researchBrowserVersionSha256: value["browserVersionSha256"],
      researchBrowserLimitsSha256: value["browserLimitsSha256"],
      researchBrowserNetworkDestinationsSha256:
        value["browserNetworkDestinationsSha256"],
    };
  }
  const format = value["webSourceFormat"];
  const lineCount = integer(value["webSourceLineCount"], 1, 20_000);
  if (
    !isWebSourceFormat(format) ||
    lineCount === undefined ||
    !sha256(value["webSourceContentSha256"]) ||
    !sha256(value["webSourceBodySha256"]) ||
    BROWSER_FIELDS.some((field) => value[field] !== undefined)
  ) {
    return undefined;
  }
  return {
    researchWebSourceContentSha256: value["webSourceContentSha256"],
    researchWebSourceBodySha256: value["webSourceBodySha256"],
    researchWebSourceFormat: format,
    researchWebSourceLineCount: lineCount,
  };
}

function isWebSourceFormat(
  value: unknown,
): value is NonNullable<
  ResearchSourceToolEventTraceView["researchWebSourceFormat"]
> {
  return ["html", "markdown", "json", "text", "pdf"].includes(String(value));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
    ? Number(value)
    : undefined;
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function hash(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}
