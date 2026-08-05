import {
  browserObservationEvidence,
  browserObservationSummaryParts,
  type BrowserObservationTraceView,
} from "./browser-observation-event-view";

export interface BrowserToolEventTraceView extends BrowserObservationTraceView {
  browserAction?:
    | "start"
    | "navigate"
    | "back"
    | "forward"
    | "tab_new"
    | "tab_list"
    | "tab_switch"
    | "tab_close"
    | "wait"
    | "find"
    | "scroll"
    | "snapshot"
    | "click"
    | "type"
    | "select"
    | "upload"
    | "download"
    | "screenshot"
    | "close";
  browserSessionMode?: "run_persistent";
  browserSessionReused?: boolean;
  browserSessionOperation?: number;
  browserSessionIdSha256?: string;
  browserActiveTabId?: string;
  browserTabCount?: number;
  browserTabSetSha256?: string;
  browserExecutableSha256?: string;
  browserVersionSha256?: string;
  browserLimitsSha256?: string;
  browserCurrentUrlSha256?: string;
  browserCurrentOriginSha256?: string;
  browserTitleSha256?: string;
  browserPageDiagnosis?: "none" | "login_required" | "challenge_detected";
  browserPageDiagnosisSignalCount?: number;
  browserPageDiagnosisSignalsSha256?: string;
  browserTakeoverRecommended?: boolean;
  browserSnapshotSha256?: string;
  browserSnapshotChars?: number;
  browserSnapshotTruncated?: boolean;
  browserScreenshotSha256?: string;
  browserScreenshotBytes?: number;
  browserFilePathSha256?: string;
  browserFileSha256?: string;
  browserFileBytes?: number;
  browserSuggestedFilenameSha256?: string;
  browserBlockedRequestCount?: number;
  browserNetworkRequestCount?: number;
  browserNetworkConnectCount?: number;
  browserNetworkRejectedCount?: number;
  browserNetworkTransferredBytes?: number;
  browserNetworkDestinationCount?: number;
  browserNetworkDestinationsSha256?: string;
  browserCrossOriginAuthorized?: boolean;
}

const ACTIONS = new Set<BrowserToolEventTraceView["browserAction"]>([
  "start",
  "navigate",
  "back",
  "forward",
  "tab_new",
  "tab_list",
  "tab_switch",
  "tab_close",
  "wait",
  "find",
  "scroll",
  "snapshot",
  "click",
  "type",
  "select",
  "upload",
  "download",
  "screenshot",
  "close",
]);

export function browserEventEvidence(
  value: unknown,
): BrowserToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const envelope = browserEventEnvelope(value);
  if (!envelope) return undefined;
  const { action, operation, blockedRequestCount, network } = envelope;
  const snapshot = optionalSnapshot(value);
  const observation = browserObservationEvidence(
    action === "find" || action === "scroll" ? action : "other",
    value,
  );
  const screenshot = optionalScreenshot(value);
  const file = optionalFile(value["file"]);
  const diagnosis = pageDiagnosis(value["pageDiagnosis"]);
  const optionalEvidence = {
    snapshot,
    observation,
    screenshot,
    file,
    diagnosis,
  };
  if (!validBrowserOptionalEvidence(optionalEvidence)) {
    return undefined;
  }
  const suggestedFilenameSha256 =
    value["suggestedFilenameSha256"] === undefined
      ? undefined
      : sha256(value["suggestedFilenameSha256"])
        ? value["suggestedFilenameSha256"]
        : null;
  const snapshotExpected =
    action !== "screenshot" &&
    action !== "close" &&
    action !== "find" &&
    action !== "scroll";
  const screenshotExpected = action === "screenshot";
  const fileExpected = action === "upload" || action === "download";
  if (
    suggestedFilenameSha256 === null ||
    Boolean(snapshot) !== snapshotExpected ||
    Boolean(screenshot) !== screenshotExpected ||
    Boolean(file) !== fileExpected ||
    Boolean(suggestedFilenameSha256) !== (action === "download") ||
    network.connectCount > network.requestCount ||
    network.rejectedCount > network.requestCount ||
    network.destinationCount > network.requestCount
  ) {
    return undefined;
  }
  return {
    browserAction: action,
    browserSessionMode: "run_persistent",
    browserSessionReused: value["sessionReused"] as boolean,
    browserSessionOperation: operation,
    browserSessionIdSha256: value["sessionIdSha256"] as string,
    browserActiveTabId: value["activeTabId"] as string,
    browserTabCount: value["tabCount"] as number,
    browserTabSetSha256: value["tabSetSha256"] as string,
    browserExecutableSha256: value["browserExecutableSha256"] as string,
    browserVersionSha256: value["browserVersionSha256"] as string,
    browserLimitsSha256: value["limitsSha256"] as string,
    browserCurrentUrlSha256: value["currentUrlSha256"] as string,
    browserCurrentOriginSha256: value["currentOriginSha256"] as string,
    browserTitleSha256: value["titleSha256"] as string,
    browserPageDiagnosis: optionalEvidence.diagnosis.status,
    browserPageDiagnosisSignalCount: optionalEvidence.diagnosis.signalCount,
    browserPageDiagnosisSignalsSha256: optionalEvidence.diagnosis.signalsSha256,
    browserTakeoverRecommended: optionalEvidence.diagnosis.takeoverRecommended,
    ...(snapshot ?? {}),
    ...(observation ?? {}),
    ...(screenshot ?? {}),
    ...(file ?? {}),
    ...(suggestedFilenameSha256
      ? { browserSuggestedFilenameSha256: suggestedFilenameSha256 }
      : {}),
    browserBlockedRequestCount: blockedRequestCount,
    browserNetworkRequestCount: network.requestCount,
    browserNetworkConnectCount: network.connectCount,
    browserNetworkRejectedCount: network.rejectedCount,
    browserNetworkTransferredBytes: network.transferredBytes,
    browserNetworkDestinationCount: network.destinationCount,
    browserNetworkDestinationsSha256: network.destinationsSha256,
    browserCrossOriginAuthorized: value["crossOriginAuthorized"] as boolean,
  };
}

function browserEventEnvelope(value: Record<string, unknown>):
  | {
      action: NonNullable<BrowserToolEventTraceView["browserAction"]>;
      operation: number;
      blockedRequestCount: number;
      network: {
        requestCount: number;
        connectCount: number;
        rejectedCount: number;
        transferredBytes: number;
        destinationCount: number;
        destinationsSha256: string;
      };
    }
  | undefined {
  const action = ACTIONS.has(
    value["action"] as BrowserToolEventTraceView["browserAction"],
  )
    ? (value["action"] as NonNullable<
        BrowserToolEventTraceView["browserAction"]
      >)
    : undefined;
  const operation = integer(value["sessionOperation"], 1, 64);
  const blockedRequestCount = integer(value["blockedRequestCount"], 0, 10_000);
  const network = record(value["network"]) ? value["network"] : undefined;
  const requestCount = integer(network?.["requestCount"], 0, 10_000);
  const connectCount = integer(network?.["connectCount"], 0, 10_000);
  const rejectedCount = integer(network?.["rejectedCount"], 0, 10_000);
  const transferredBytes = integer(
    network?.["transferredBytes"],
    0,
    256 * 1024 * 1024,
  );
  const destinationCount = integer(network?.["destinationCount"], 0, 10_000);
  if (
    value["kind"] !== "napier.browser-session-operation" ||
    value["schemaVersion"] !== 3 ||
    !action ||
    value["sessionMode"] !== "run_persistent" ||
    typeof value["sessionReused"] !== "boolean" ||
    operation === undefined ||
    value["sessionReused"] !== operation > 1 ||
    !tabId(value["activeTabId"]) ||
    integer(value["tabCount"], 1, 4) === undefined ||
    !sha256(value["tabSetSha256"]) ||
    !validBrowserHashes(value) ||
    blockedRequestCount === undefined ||
    !network ||
    requestCount === undefined ||
    connectCount === undefined ||
    rejectedCount === undefined ||
    transferredBytes === undefined ||
    destinationCount === undefined ||
    !sha256(network["destinationsSha256"]) ||
    typeof value["crossOriginAuthorized"] !== "boolean"
  ) {
    return undefined;
  }
  return {
    action,
    operation,
    blockedRequestCount,
    network: {
      requestCount,
      connectCount,
      rejectedCount,
      transferredBytes,
      destinationCount,
      destinationsSha256: network["destinationsSha256"],
    },
  };
}

function validBrowserHashes(value: Record<string, unknown>): boolean {
  return [
    "sessionIdSha256",
    "browserExecutableSha256",
    "browserVersionSha256",
    "limitsSha256",
    "currentUrlSha256",
    "currentOriginSha256",
    "titleSha256",
  ].every((field) => sha256(value[field]));
}

export function browserSummaryParts(view: BrowserToolEventTraceView): string[] {
  return [
    ...(view.browserAction ? [`browser ${view.browserAction}`] : []),
    ...(view.browserSessionReused ? ["browser-session-reused"] : []),
    ...(view.browserSessionOperation !== undefined
      ? [`browser-operation ${view.browserSessionOperation}`]
      : []),
    ...(view.browserActiveTabId
      ? [`active-tab ${view.browserActiveTabId}`]
      : []),
    ...(view.browserTabCount !== undefined
      ? [`tabs ${view.browserTabCount}`]
      : []),
    ...(view.browserPageDiagnosis && view.browserPageDiagnosis !== "none"
      ? [`page-${view.browserPageDiagnosis.replaceAll("_", "-")}`]
      : []),
    ...(view.browserTakeoverRecommended ? ["takeover-recommended"] : []),
    ...(view.browserCrossOriginAuthorized ? ["cross-origin-authorized"] : []),
    ...(view.browserBlockedRequestCount !== undefined
      ? [`blocked-requests ${view.browserBlockedRequestCount}`]
      : []),
    ...(view.browserNetworkRequestCount !== undefined
      ? [`network-requests ${view.browserNetworkRequestCount}`]
      : []),
    ...(view.browserNetworkConnectCount !== undefined
      ? [`tunnels ${view.browserNetworkConnectCount}`]
      : []),
    ...(view.browserNetworkRejectedCount !== undefined
      ? [`network-rejected ${view.browserNetworkRejectedCount}`]
      : []),
    ...(view.browserNetworkTransferredBytes !== undefined
      ? [`network-bytes ${view.browserNetworkTransferredBytes}`]
      : []),
    ...(view.browserNetworkDestinationCount !== undefined
      ? [`destinations ${view.browserNetworkDestinationCount}`]
      : []),
    ...(view.browserSnapshotChars !== undefined
      ? [`snapshot-chars ${view.browserSnapshotChars}`]
      : []),
    ...(view.browserSnapshotTruncated ? ["snapshot-truncated"] : []),
    ...browserObservationSummaryParts(view),
    ...(view.browserScreenshotBytes !== undefined
      ? [`screenshot-bytes ${view.browserScreenshotBytes}`]
      : []),
    ...(view.browserFileBytes !== undefined
      ? [`file-bytes ${view.browserFileBytes}`]
      : []),
    ...hash("browser-session", view.browserSessionIdSha256),
    ...hash("browser-tabs", view.browserTabSetSha256),
    ...hash("browser-origin", view.browserCurrentOriginSha256),
    ...hash("browser-page-diagnosis", view.browserPageDiagnosisSignalsSha256),
    ...hash("browser-snapshot", view.browserSnapshotSha256),
    ...hash("browser-find-query", view.browserFindQuerySha256),
    ...hash("browser-find-matches", view.browserFindMatchesSha256),
    ...hash("browser-viewport", view.browserViewportTextSha256),
    ...hash("browser-screenshot", view.browserScreenshotSha256),
    ...hash("browser-file", view.browserFileSha256),
    ...hash("browser-destinations", view.browserNetworkDestinationsSha256),
  ];
}

function validBrowserOptionalEvidence(input: {
  snapshot: ReturnType<typeof optionalSnapshot>;
  observation: ReturnType<typeof browserObservationEvidence>;
  screenshot: ReturnType<typeof optionalScreenshot>;
  file: ReturnType<typeof optionalFile>;
  diagnosis: ReturnType<typeof pageDiagnosis>;
}): input is typeof input & {
  diagnosis: NonNullable<typeof input.diagnosis>;
} {
  return (
    input.snapshot !== null &&
    input.observation !== null &&
    input.screenshot !== null &&
    input.file !== null &&
    input.diagnosis !== undefined
  );
}

function pageDiagnosis(value: unknown):
  | {
      status: "none" | "login_required" | "challenge_detected";
      signalCount: number;
      signalsSha256: string;
      takeoverRecommended: boolean;
    }
  | undefined {
  if (!record(value)) return undefined;
  const status =
    value["status"] === "none" ||
    value["status"] === "login_required" ||
    value["status"] === "challenge_detected"
      ? value["status"]
      : undefined;
  const signalCount = integer(value["signalCount"], 0, 12);
  if (
    !status ||
    signalCount === undefined ||
    !sha256(value["signalsSha256"]) ||
    typeof value["takeoverRecommended"] !== "boolean" ||
    value["takeoverRecommended"] !== (status !== "none") ||
    (signalCount === 0) !== (status === "none")
  ) {
    return undefined;
  }
  return {
    status,
    signalCount,
    signalsSha256: value["signalsSha256"],
    takeoverRecommended: value["takeoverRecommended"],
  };
}

function tabId(value: unknown): value is string {
  return typeof value === "string" && /^tab_[1-9][0-9]{0,3}$/u.test(value);
}

function optionalSnapshot(
  value: Record<string, unknown>,
):
  | Pick<
      BrowserToolEventTraceView,
      | "browserSnapshotSha256"
      | "browserSnapshotChars"
      | "browserSnapshotTruncated"
    >
  | null
  | undefined {
  const present =
    value["snapshotSha256"] !== undefined ||
    value["snapshotChars"] !== undefined ||
    value["snapshotTruncated"] !== undefined;
  if (!present) return undefined;
  const chars = integer(value["snapshotChars"], 0, 32_000);
  if (
    !sha256(value["snapshotSha256"]) ||
    chars === undefined ||
    typeof value["snapshotTruncated"] !== "boolean"
  ) {
    return null;
  }
  return {
    browserSnapshotSha256: value["snapshotSha256"],
    browserSnapshotChars: chars,
    browserSnapshotTruncated: value["snapshotTruncated"],
  };
}

function optionalScreenshot(
  value: Record<string, unknown>,
):
  | Pick<
      BrowserToolEventTraceView,
      "browserScreenshotSha256" | "browserScreenshotBytes"
    >
  | null
  | undefined {
  const present =
    value["screenshotSha256"] !== undefined ||
    value["screenshotBytes"] !== undefined;
  if (!present) return undefined;
  const bytes = integer(value["screenshotBytes"], 0, 8 * 1024 * 1024);
  if (!sha256(value["screenshotSha256"]) || bytes === undefined) return null;
  return {
    browserScreenshotSha256: value["screenshotSha256"],
    browserScreenshotBytes: bytes,
  };
}

function optionalFile(
  value: unknown,
):
  | Pick<
      BrowserToolEventTraceView,
      "browserFilePathSha256" | "browserFileSha256" | "browserFileBytes"
    >
  | null
  | undefined {
  if (value === undefined) return undefined;
  if (!record(value)) return null;
  const bytes = integer(value["fileBytes"], 0, 32 * 1024 * 1024);
  if (
    !sha256(value["pathSha256"]) ||
    !sha256(value["fileSha256"]) ||
    bytes === undefined
  ) {
    return null;
  }
  return {
    browserFilePathSha256: value["pathSha256"],
    browserFileSha256: value["fileSha256"],
    browserFileBytes: bytes,
  };
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
