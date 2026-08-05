import type {
  BrowserTakeoverActionReceipt,
  BrowserTakeoverSnapshot,
  ExecuteBrowserTakeoverActionRequest,
} from "@napier/contracts/browser-takeover";

import { requestJson } from "./api-client";
import { canonicalJson, sha256Text } from "./stable-digest";

export async function getBrowserTakeoverSnapshot(
  threadId: string,
  runId: string,
): Promise<BrowserTakeoverSnapshot> {
  return await validateSnapshot(
    await requestJson<unknown>(
      `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/browser-session-control/takeover`,
    ),
    threadId,
    runId,
  );
}

export async function executeBrowserTakeoverAction(
  threadId: string,
  runId: string,
  request: ExecuteBrowserTakeoverActionRequest,
): Promise<BrowserTakeoverActionReceipt> {
  return validateReceipt(
    await requestJson<unknown>(
      `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/browser-session-control/takeover`,
      { method: "POST", body: JSON.stringify(request) },
    ),
    threadId,
    runId,
    request,
  );
}

async function validateSnapshot(
  input: unknown,
  threadId: string,
  runId: string,
): Promise<BrowserTakeoverSnapshot> {
  if (!record(input)) throw invalid();
  const keys = new Set([
    "kind",
    "schemaVersion",
    "threadId",
    "runId",
    "pauseStateSha256",
    "sessionIdSha256",
    "sessionOperation",
    "activeTabId",
    "tabCount",
    "tabSetSha256",
    "tabs",
    "snapshot",
    "snapshotSha256",
    "snapshotChars",
    "snapshotTruncated",
    "currentUrlSha256",
    "currentOriginSha256",
    "titleSha256",
    "capturedAt",
    "contentSha256",
  ]);
  if (
    Object.keys(input).some((key) => !keys.has(key)) ||
    input["kind"] !== "napier.browser-takeover-snapshot" ||
    input["schemaVersion"] !== 2 ||
    input["threadId"] !== threadId ||
    input["runId"] !== runId ||
    !hash(input["pauseStateSha256"]) ||
    !hash(input["sessionIdSha256"]) ||
    !count(input["sessionOperation"]) ||
    !tabId(input["activeTabId"]) ||
    !boundedCount(input["tabCount"], 1, 4) ||
    !hash(input["tabSetSha256"]) ||
    !takeoverTabs(input["tabs"], input["activeTabId"], input["tabCount"]) ||
    !(await tabSetMatches(input["tabs"], input["tabSetSha256"])) ||
    typeof input["snapshot"] !== "string" ||
    !hash(input["snapshotSha256"]) ||
    input["snapshotSha256"] !== (await sha256Text(input["snapshot"])) ||
    input["snapshotChars"] !== input["snapshot"].length ||
    typeof input["snapshotTruncated"] !== "boolean" ||
    !hash(input["currentUrlSha256"]) ||
    !hash(input["currentOriginSha256"]) ||
    !hash(input["titleSha256"]) ||
    !timestamp(input["capturedAt"]) ||
    !hash(input["contentSha256"])
  ) {
    throw invalid();
  }
  return input as unknown as BrowserTakeoverSnapshot;
}

function validateReceipt(
  input: unknown,
  threadId: string,
  runId: string,
  request: ExecuteBrowserTakeoverActionRequest,
): Promise<BrowserTakeoverActionReceipt> {
  if (!record(input)) throw invalid();
  return validateReceiptEvidence(input, threadId, runId, request);
}

async function validateReceiptEvidence(
  input: Record<string, unknown>,
  threadId: string,
  runId: string,
  request: ExecuteBrowserTakeoverActionRequest,
): Promise<BrowserTakeoverActionReceipt> {
  if (
    Object.keys(input).some((key) => !RECEIPT_KEYS.has(key)) ||
    input["kind"] !== "napier.browser-takeover-action" ||
    input["schemaVersion"] !== 2 ||
    typeof input["id"] !== "string" ||
    !/^browser_takeover_[a-z0-9_-]{8,80}$/u.test(input["id"]) ||
    input["threadId"] !== threadId ||
    input["runId"] !== runId ||
    input["action"] !== request.action ||
    input["status"] !== "completed" ||
    !receiptEvidence(input) ||
    input["requestSha256"] !== (await sha256Text(canonicalJson(request))) ||
    input["pauseStateSha256"] !== request.expectedPauseStateSha256 ||
    input["sourceSessionIdSha256"] !== request.expectedSessionIdSha256 ||
    input["sourceSessionOperation"] !== request.expectedSessionOperation ||
    input["sourceSnapshotSha256"] !== request.expectedSnapshotSha256 ||
    input["sourceActiveTabId"] !== request.expectedActiveTabId ||
    input["sourceTabCount"] !== request.expectedTabCount ||
    input["sourceTabSetSha256"] !== request.expectedTabSetSha256 ||
    input["sessionIdSha256"] !== request.expectedSessionIdSha256 ||
    input["sessionOperation"] !== request.expectedSessionOperation + 1 ||
    !validTabTransition(input, request) ||
    input["crossOriginAuthorized"] !==
      ("allowCrossOrigin" in request && request.allowCrossOrigin === true) ||
    !(await actionReceiptEvidence(input, request))
  ) {
    throw invalid();
  }
  return input as unknown as BrowserTakeoverActionReceipt;
}

function validTabTransition(
  input: Record<string, unknown>,
  request: ExecuteBrowserTakeoverActionRequest,
): boolean {
  const activeTabId = input["activeTabId"];
  const tabCount = input["tabCount"];
  const tabSetSha256 = input["tabSetSha256"];
  if (request.action === "tab_new") {
    return (
      tabCount === request.expectedTabCount + 1 &&
      tabSetSha256 !== request.expectedTabSetSha256 &&
      activeTabId !== request.expectedActiveTabId
    );
  }
  if (request.action === "tab_switch") {
    return (
      tabCount === request.expectedTabCount &&
      tabSetSha256 === request.expectedTabSetSha256 &&
      activeTabId === request.tabId
    );
  }
  if (request.action === "tab_close") {
    return (
      tabCount === request.expectedTabCount - 1 &&
      tabSetSha256 !== request.expectedTabSetSha256 &&
      activeTabId !== request.tabId &&
      (request.tabId === request.expectedActiveTabId ||
        activeTabId === request.expectedActiveTabId)
    );
  }
  return (
    tabCount === request.expectedTabCount &&
    tabSetSha256 === request.expectedTabSetSha256 &&
    activeTabId === request.expectedActiveTabId
  );
}

const RECEIPT_KEYS = new Set([
  "kind",
  "schemaVersion",
  "id",
  "threadId",
  "runId",
  "action",
  "status",
  "requestSha256",
  "pauseStateSha256",
  "sourceSessionIdSha256",
  "sourceSessionOperation",
  "sourceSnapshotSha256",
  "sourceActiveTabId",
  "sourceTabCount",
  "sourceTabSetSha256",
  "sourceLiveImageSha256",
  "viewportWidth",
  "viewportHeight",
  "coordinateXSha256",
  "coordinateYSha256",
  "key",
  "targetTabIdSha256",
  "targetUrlSha256",
  "targetOriginSha256",
  "targetRefSha256",
  "textSha256",
  "textBytes",
  "valueSetSha256",
  "valueCount",
  "direction",
  "pixels",
  "durationMs",
  "crossOriginAuthorized",
  "requestedAt",
  "settledAt",
  "sessionIdSha256",
  "sessionOperation",
  "activeTabId",
  "tabCount",
  "tabSetSha256",
  "currentUrlSha256",
  "currentOriginSha256",
  "titleSha256",
  "snapshotSha256",
  "snapshotChars",
  "snapshotTruncated",
  "failureCode",
  "contentSha256",
]);

function receiptEvidence(input: Record<string, unknown>): boolean {
  return (
    hash(input["requestSha256"]) &&
    hash(input["pauseStateSha256"]) &&
    hash(input["sourceSessionIdSha256"]) &&
    count(input["sourceSessionOperation"]) &&
    hash(input["sourceSnapshotSha256"]) &&
    tabId(input["sourceActiveTabId"]) &&
    boundedCount(input["sourceTabCount"], 1, 4) &&
    hash(input["sourceTabSetSha256"]) &&
    typeof input["crossOriginAuthorized"] === "boolean" &&
    timestamp(input["requestedAt"]) &&
    timestamp(input["settledAt"]) &&
    hash(input["sessionIdSha256"]) &&
    count(input["sessionOperation"]) &&
    tabId(input["activeTabId"]) &&
    boundedCount(input["tabCount"], 1, 4) &&
    hash(input["tabSetSha256"]) &&
    hash(input["currentUrlSha256"]) &&
    hash(input["currentOriginSha256"]) &&
    hash(input["titleSha256"]) &&
    optionalHash(input["snapshotSha256"]) &&
    optionalCount(input["snapshotChars"]) &&
    (input["snapshotTruncated"] === undefined ||
      typeof input["snapshotTruncated"] === "boolean") &&
    input["failureCode"] === undefined &&
    hash(input["contentSha256"])
  );
}

async function actionReceiptEvidence(
  input: Record<string, unknown>,
  request: ExecuteBrowserTakeoverActionRequest,
): Promise<boolean> {
  if (request.action === "click") {
    return input["targetRefSha256"] === (await sha256Text(request.ref));
  }
  if (request.action === "visual_click") {
    return (
      input["sourceLiveImageSha256"] === request.expectedLiveImageSha256 &&
      input["viewportWidth"] === request.expectedViewportWidth &&
      input["viewportHeight"] === request.expectedViewportHeight &&
      input["coordinateXSha256"] === (await sha256Text(String(request.x))) &&
      input["coordinateYSha256"] === (await sha256Text(String(request.y)))
    );
  }
  if (request.action === "keypress") {
    return input["key"] === request.key;
  }
  if (request.action === "type") {
    return (
      input["targetRefSha256"] === (await sha256Text(request.ref)) &&
      input["textSha256"] === (await sha256Text(request.text)) &&
      input["textBytes"] === new TextEncoder().encode(request.text).byteLength
    );
  }
  if (request.action === "select") {
    return (
      input["targetRefSha256"] === (await sha256Text(request.ref)) &&
      input["valueSetSha256"] ===
        (await sha256Text(canonicalJson(request.values))) &&
      input["valueCount"] === request.values.length
    );
  }
  if (request.action === "scroll") {
    return (
      input["direction"] === request.direction &&
      input["pixels"] === request.pixels
    );
  }
  if (request.action === "wait") {
    return input["durationMs"] === request.durationMs;
  }
  if (request.action === "tab_new") {
    const url = new URL(request.url);
    return (
      input["targetUrlSha256"] === (await sha256Text(url.href)) &&
      input["targetOriginSha256"] === (await sha256Text(url.origin))
    );
  }
  if (request.action === "tab_switch" || request.action === "tab_close") {
    return input["targetTabIdSha256"] === (await sha256Text(request.tabId));
  }
  return request.action === "back" || request.action === "forward";
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function optionalHash(value: unknown): boolean {
  return value === undefined || hash(value);
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function boundedCount(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return count(value) && value >= minimum && value <= maximum;
}

function tabId(value: unknown): value is string {
  return typeof value === "string" && /^tab_[1-9][0-9]{0,3}$/u.test(value);
}

function takeoverTabs(
  value: unknown,
  activeTabId: unknown,
  tabCount: unknown,
): boolean {
  if (
    !Array.isArray(value) ||
    !tabId(activeTabId) ||
    !boundedCount(tabCount, 1, 4) ||
    value.length !== tabCount
  ) {
    return false;
  }
  const ids = new Set<string>();
  return (
    value.every((entry) => {
      if (!record(entry)) return false;
      const keys = new Set([
        "tabId",
        "active",
        "url",
        "currentUrlSha256",
        "title",
        "titleSha256",
      ]);
      const id = entry["tabId"];
      if (
        Object.keys(entry).some((key) => !keys.has(key)) ||
        !tabId(id) ||
        ids.has(id) ||
        typeof entry["active"] !== "boolean" ||
        typeof entry["url"] !== "string" ||
        !hash(entry["currentUrlSha256"]) ||
        typeof entry["title"] !== "string" ||
        !hash(entry["titleSha256"])
      ) {
        return false;
      }
      ids.add(id);
      return true;
    }) &&
    value.filter((entry) => record(entry) && entry["active"] === true)
      .length === 1 &&
    value.some(
      (entry) =>
        record(entry) &&
        entry["active"] === true &&
        entry["tabId"] === activeTabId,
    )
  );
}

async function tabSetMatches(
  value: unknown,
  expected: unknown,
): Promise<boolean> {
  if (!Array.isArray(value) || !hash(expected)) return false;
  const ids: string[] = [];
  for (const entry of value) {
    if (!record(entry) || !tabId(entry["tabId"])) return false;
    if (
      typeof entry["url"] !== "string" ||
      entry["currentUrlSha256"] !== (await sha256Text(entry["url"])) ||
      typeof entry["title"] !== "string" ||
      entry["titleSha256"] !== (await sha256Text(entry["title"]))
    ) {
      return false;
    }
    ids.push(entry["tabId"]);
  }
  return (await sha256Text(canonicalJson(ids))) === expected;
}

function optionalCount(value: unknown): boolean {
  return value === undefined || count(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function invalid(): Error {
  return new Error("Browser takeover response is invalid");
}
