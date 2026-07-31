export interface ResearchSourceToolEventTraceView {
  researchSourceAction?: "capture" | "cite" | "list";
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
  researchSourceCount?: number;
  researchCitationCount?: number;
  researchSourceSetSha256?: string;
  researchBrowserSessionOperation?: number;
  researchBrowserSessionIdSha256?: string;
  researchBrowserExecutableSha256?: string;
  researchBrowserVersionSha256?: string;
  researchBrowserLimitsSha256?: string;
  researchBrowserNetworkDestinationsSha256?: string;
}

const ACTIONS = new Set<
  ResearchSourceToolEventTraceView["researchSourceAction"]
>(["capture", "cite", "list"]);
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
  if (action === "list") {
    if (
      SOURCE_FIELDS.some((field) => value[field] !== undefined) ||
      CITATION_FIELDS.some((field) => value[field] !== undefined)
    ) {
      return undefined;
    }
    return {
      researchSourceAction: action,
      researchSourceCount: sourceCount,
      researchCitationCount: citationCount,
      researchSourceSetSha256: value["sourceSetSha256"],
    };
  }

  const sourceId =
    typeof value["sourceId"] === "string" && SOURCE_ID.test(value["sourceId"])
      ? value["sourceId"]
      : undefined;
  const sourceLineCount = integer(value["sourceLineCount"], 1, 400);
  const sourceTextChars = integer(value["sourceTextChars"], 1, 24_000);
  const browserSessionOperation = integer(
    value["browserSessionOperation"],
    1,
    64,
  );
  if (
    !sourceId ||
    !sha256(value["sourceContentSha256"]) ||
    !sha256(value["sourceUrlSha256"]) ||
    !sha256(value["sourceOriginSha256"]) ||
    !sha256(value["sourceTitleSha256"]) ||
    !sha256(value["sourceTextSha256"]) ||
    sourceLineCount === undefined ||
    sourceTextChars === undefined ||
    sourceTextChars < sourceLineCount * 2 - 1 ||
    typeof value["sourceTruncated"] !== "boolean" ||
    sourceCount < 1 ||
    browserSessionOperation === undefined ||
    !sha256(value["browserSessionIdSha256"]) ||
    !sha256(value["browserExecutableSha256"]) ||
    !sha256(value["browserVersionSha256"]) ||
    !sha256(value["browserLimitsSha256"]) ||
    !sha256(value["browserNetworkDestinationsSha256"])
  ) {
    return undefined;
  }
  const sourceEvidence: ResearchSourceToolEventTraceView = {
    researchSourceAction: action,
    researchSourceId: sourceId,
    researchSourceContentSha256: value["sourceContentSha256"],
    researchSourceUrlSha256: value["sourceUrlSha256"],
    researchSourceOriginSha256: value["sourceOriginSha256"],
    researchSourceTitleSha256: value["sourceTitleSha256"],
    researchSourceTextSha256: value["sourceTextSha256"],
    researchSourceLineCount: sourceLineCount,
    researchSourceTextChars: sourceTextChars,
    researchSourceTruncated: value["sourceTruncated"],
    researchSourceCount: sourceCount,
    researchCitationCount: citationCount,
    researchSourceSetSha256: value["sourceSetSha256"],
    researchBrowserSessionOperation: browserSessionOperation,
    researchBrowserSessionIdSha256: value["browserSessionIdSha256"],
    researchBrowserExecutableSha256: value["browserExecutableSha256"],
    researchBrowserVersionSha256: value["browserVersionSha256"],
    researchBrowserLimitsSha256: value["browserLimitsSha256"],
    researchBrowserNetworkDestinationsSha256:
      value["browserNetworkDestinationsSha256"],
  };
  if (action === "capture") {
    return CITATION_FIELDS.some((field) => value[field] !== undefined)
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
    citationCount < 1
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

export function researchSourceSummaryParts(
  view: ResearchSourceToolEventTraceView,
): string[] {
  return [
    ...(view.researchSourceAction
      ? [`research-source ${view.researchSourceAction}`]
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
    ...(view.researchBrowserSessionOperation !== undefined
      ? [`browser-operation ${view.researchBrowserSessionOperation}`]
      : []),
    ...hash("source-content", view.researchSourceContentSha256),
    ...hash("source-set", view.researchSourceSetSha256),
    ...hash("citation-quote", view.researchCitationQuoteSha256),
    ...hash("citation-claim", view.researchCitationClaimSha256),
    ...hash("browser-session", view.researchBrowserSessionIdSha256),
    ...hash(
      "browser-destinations",
      view.researchBrowserNetworkDestinationsSha256,
    ),
  ];
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
