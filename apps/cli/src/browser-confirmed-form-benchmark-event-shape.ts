import type { RunEvent } from "@napier/contracts";
import { parseBrowserInteractionConfirmation } from "@napier/contracts/browser-interaction-confirmation";

const EVENT_KEYS = keySet(
  "id threadId runId seq type category visibility createdAt payload",
);
const PROJECTED_TOOL_KEYS = keySet(
  "kind schemaVersion toolName status action sourcePayloadSha256 sessionOperation sessionIdSha256 currentUrlSha256 titleSha256",
);
const LEGACY_TOOL_KEYS = keySet(
  "callId toolName status outputTextSha256 outputTextBytes outputSha256 outputBytes outputRedacted resultSha256 details",
);
const DETAILS_REQUIRED_KEYS = keySet(
  "kind schemaVersion action sessionMode sessionReused sessionOperation sessionIdSha256 activeTabId tabCount tabSetSha256 browserExecutableSha256 browserVersionSha256 limitsSha256 currentUrlSha256 currentOriginSha256 titleSha256 pageDiagnosis blockedRequestCount network crossOriginAuthorized",
);
const DETAILS_OPTIONAL_KEYS = keySet(
  "snapshotSha256 snapshotChars snapshotTruncated findQuerySha256 findQueryChars findMatchCount findMatchesSha256 findScannedChars findTruncated scrollDeltaY scrollPositionY scrollViewportHeight scrollDocumentHeight scrollAtStart scrollAtEnd viewportTextSha256 viewportTextChars viewportTextTruncated screenshotSha256 screenshotBytes file suggestedFilenameSha256 consoleEntryCount consoleErrorCount consoleWarningCount consoleEntriesSha256 consoleTruncated workspacePreviewEntryPathSha256 workspacePreviewEntrySha256 workspacePreviewEntryBytes",
);
const DIAGNOSIS_KEYS = keySet(
  "status signalCount signalsSha256 takeoverRecommended",
);
const NETWORK_KEYS = keySet(
  "requestCount connectCount rejectedCount transferredBytes destinationCount destinationsSha256",
);
const FILE_KEYS = keySet("pathSha256 fileSha256 fileBytes");
const EVALUATION_KEYS = keySet(
  "kind schemaVersion caseId caseSha256 status runStatus cliExitCode assistantOutputMatch confirmationPromptCount approvalInputCount confirmationEventCount confirmationOrderValid confirmationActions confirmationEffects browserActions browserWriteActions browserOperationOrderValid browserOutcomeUrlMatch browserOutcomeTitleMatch browserSingleSession firstConfirmationMs totalDurationMs maxDurationMs credentialReferenceCount credentialProviderMatch credentialLocatorMatch credentialAvailable replayValid credentialLeakDetected credentialPersistenceLeakDetected privateValueLeakDetected diagnostics contentSha256",
);

export function validBrowserConfirmedFormRunEvent(
  value: unknown,
): value is RunEvent {
  return (
    exactRecord(value, EVENT_KEYS) &&
    resourceId(value["id"]) &&
    resourceId(value["threadId"]) &&
    resourceId(value["runId"]) &&
    positiveInteger(value["seq"]) &&
    boundedText(value["type"], 1, 200) &&
    boundedText(value["category"], 1, 40) &&
    boundedText(value["visibility"], 1, 40) &&
    isoDate(value["createdAt"]) &&
    validEventPayload(value["type"], value["payload"])
  );
}

function validEventPayload(type: string, value: unknown): boolean {
  if (type.startsWith("browser.interaction_confirmation.")) {
    const confirmation = parseBrowserInteractionConfirmation(value);
    return (
      confirmation !== undefined &&
      type === `browser.interaction_confirmation.${confirmation.status}`
    );
  }
  if (
    type === "tool.completed" ||
    type === "tool.failed" ||
    type === "tool.blocked"
  ) {
    return (
      validProjectedToolPayload(type, value) ||
      validLegacyToolPayload(type, value)
    );
  }
  if (
    type === "run.completed" ||
    type === "run.failed" ||
    type === "run.cancelled" ||
    type === "run.interrupted"
  ) {
    return exactRecord(value, ["status"]) && runStatus(value["status"]);
  }
  if (type === "benchmark.browser.confirmed_form.evaluated") {
    return validEvaluationPayload(value);
  }
  return false;
}

function validProjectedToolPayload(type: string, value: unknown): boolean {
  if (
    !exactOptionalRecord(
      value,
      PROJECTED_TOOL_KEYS.slice(0, 6),
      PROJECTED_TOOL_KEYS.slice(6),
    )
  ) {
    return false;
  }
  return (
    value["kind"] === "napier.browser-confirmed-form-operation-event" &&
    value["schemaVersion"] === 1 &&
    value["toolName"] === "browser" &&
    toolStatus(value["status"]) &&
    eventTypeMatchesStatus(type, value["status"]) &&
    browserAction(value["action"]) &&
    digest(value["sourcePayloadSha256"]) &&
    optionalNonNegativeInteger(value["sessionOperation"]) &&
    optionalDigest(value["sessionIdSha256"]) &&
    optionalDigest(value["currentUrlSha256"]) &&
    optionalDigest(value["titleSha256"])
  );
}

function validLegacyToolPayload(type: string, value: unknown): boolean {
  return (
    type === "tool.completed" &&
    exactRecord(value, LEGACY_TOOL_KEYS) &&
    callId(value["callId"]) &&
    value["toolName"] === "browser" &&
    value["status"] === "completed" &&
    digest(value["outputTextSha256"]) &&
    nonNegativeInteger(value["outputTextBytes"]) &&
    digest(value["outputSha256"]) &&
    nonNegativeInteger(value["outputBytes"]) &&
    value["outputRedacted"] === true &&
    digest(value["resultSha256"]) &&
    validLegacyBrowserDetails(value["details"])
  );
}

function validLegacyBrowserDetails(value: unknown): boolean {
  if (
    !exactOptionalRecord(value, DETAILS_REQUIRED_KEYS, DETAILS_OPTIONAL_KEYS)
  ) {
    return false;
  }
  return (
    value["kind"] === "napier.browser-session-operation" &&
    value["schemaVersion"] === 3 &&
    browserAction(value["action"]) &&
    value["sessionMode"] === "run_persistent" &&
    typeof value["sessionReused"] === "boolean" &&
    nonNegativeInteger(value["sessionOperation"]) &&
    digest(value["sessionIdSha256"]) &&
    tabId(value["activeTabId"]) &&
    positiveInteger(value["tabCount"]) &&
    digest(value["tabSetSha256"]) &&
    digest(value["browserExecutableSha256"]) &&
    digest(value["browserVersionSha256"]) &&
    digest(value["limitsSha256"]) &&
    digest(value["currentUrlSha256"]) &&
    digest(value["currentOriginSha256"]) &&
    digest(value["titleSha256"]) &&
    validDiagnosis(value["pageDiagnosis"]) &&
    nonNegativeInteger(value["blockedRequestCount"]) &&
    validNetwork(value["network"]) &&
    typeof value["crossOriginAuthorized"] === "boolean" &&
    validDetailsOptionals(value)
  );
}

function validDetailsOptionals(value: Record<string, unknown>): boolean {
  const digestKeys = [
    "snapshotSha256",
    "findQuerySha256",
    "findMatchesSha256",
    "viewportTextSha256",
    "screenshotSha256",
    "suggestedFilenameSha256",
    "consoleEntriesSha256",
    "workspacePreviewEntryPathSha256",
    "workspacePreviewEntrySha256",
  ];
  const integerKeys = [
    "snapshotChars",
    "findQueryChars",
    "findMatchCount",
    "findScannedChars",
    "scrollDeltaY",
    "scrollPositionY",
    "scrollViewportHeight",
    "scrollDocumentHeight",
    "viewportTextChars",
    "screenshotBytes",
    "consoleEntryCount",
    "consoleErrorCount",
    "consoleWarningCount",
    "workspacePreviewEntryBytes",
  ];
  const booleanKeys = [
    "snapshotTruncated",
    "findTruncated",
    "scrollAtStart",
    "scrollAtEnd",
    "viewportTextTruncated",
    "consoleTruncated",
  ];
  return (
    digestKeys.every((key) => optionalDigest(value[key])) &&
    integerKeys.every((key) => optionalInteger(value[key])) &&
    booleanKeys.every((key) => optionalBoolean(value[key])) &&
    (value["file"] === undefined || validFile(value["file"]))
  );
}

function validDiagnosis(value: unknown): boolean {
  return (
    exactRecord(value, DIAGNOSIS_KEYS) &&
    ["none", "login_required", "challenge_detected"].includes(
      String(value["status"]),
    ) &&
    nonNegativeInteger(value["signalCount"]) &&
    digest(value["signalsSha256"]) &&
    typeof value["takeoverRecommended"] === "boolean"
  );
}

function validNetwork(value: unknown): boolean {
  return (
    exactRecord(value, NETWORK_KEYS) &&
    [
      "requestCount",
      "connectCount",
      "rejectedCount",
      "transferredBytes",
      "destinationCount",
    ].every((key) => nonNegativeInteger(value[key])) &&
    digest(value["destinationsSha256"])
  );
}

function validFile(value: unknown): boolean {
  return (
    exactRecord(value, FILE_KEYS) &&
    digest(value["pathSha256"]) &&
    digest(value["fileSha256"]) &&
    nonNegativeInteger(value["fileBytes"])
  );
}

function validEvaluationPayload(value: unknown): boolean {
  if (!exactRecord(value, EVALUATION_KEYS)) return false;
  return (
    value["kind"] === "napier.browser-confirmed-form-benchmark-evaluation" &&
    value["schemaVersion"] === 1 &&
    resourceId(value["caseId"]) &&
    digest(value["caseSha256"]) &&
    resultStatus(value["status"]) &&
    runStatus(value["runStatus"]) &&
    Number.isSafeInteger(value["cliExitCode"]) &&
    [
      "assistantOutputMatch",
      "confirmationOrderValid",
      "browserOperationOrderValid",
      "browserOutcomeUrlMatch",
      "browserOutcomeTitleMatch",
      "browserSingleSession",
      "credentialProviderMatch",
      "credentialLocatorMatch",
      "credentialAvailable",
      "replayValid",
      "credentialLeakDetected",
      "credentialPersistenceLeakDetected",
      "privateValueLeakDetected",
    ].every((key) => typeof value[key] === "boolean") &&
    [
      "confirmationPromptCount",
      "approvalInputCount",
      "confirmationEventCount",
      "firstConfirmationMs",
      "totalDurationMs",
      "maxDurationMs",
      "credentialReferenceCount",
    ].every((key) => nonNegativeInteger(value[key])) &&
    stringArray(value["confirmationActions"], 0, 16) &&
    stringArray(value["confirmationEffects"], 0, 16) &&
    stringArray(value["browserActions"], 0, 64) &&
    stringArray(value["browserWriteActions"], 0, 16) &&
    stringArray(value["diagnostics"], 0, 64) &&
    digest(value["contentSha256"])
  );
}

function eventTypeMatchesStatus(type: string, status: unknown): boolean {
  return (
    (type === "tool.completed" && status === "completed") ||
    (type === "tool.failed" && status === "failed") ||
    (type === "tool.blocked" && status === "blocked")
  );
}

function toolStatus(value: unknown): boolean {
  return value === "completed" || value === "failed" || value === "blocked";
}

function browserAction(value: unknown): boolean {
  return typeof value === "string" && /^[a-z][a-z_]{1,39}$/u.test(value);
}

function tabId(value: unknown): boolean {
  return typeof value === "string" && /^tab_[1-9][0-9]{0,3}$/u.test(value);
}

function callId(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 120 &&
    /^call_[A-Za-z0-9_:-]+$/u.test(value)
  );
}

function stringArray(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every((item) => boundedText(item, 1, 100))
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

function exactOptionalRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
): value is Record<string, unknown> {
  if (!record(value) || required.some((key) => !Object.hasOwn(value, key))) {
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  return Object.keys(value).every((key) => allowed.has(key));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_:-]{2,100}$/u.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function optionalDigest(value: unknown): boolean {
  return value === undefined || digest(value);
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || nonNegativeInteger(value);
}

function optionalInteger(value: unknown): boolean {
  return value === undefined || Number.isSafeInteger(value);
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function resultStatus(value: unknown): boolean {
  return value === "passed" || value === "failed" || value === "inconclusive";
}

function runStatus(value: unknown): boolean {
  return (
    value === "completed" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "interrupted"
  );
}

function isoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function keySet(value: string): readonly string[] {
  return value.split(" ");
}
