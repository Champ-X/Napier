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
    input["schemaVersion"] !== 1 ||
    input["threadId"] !== threadId ||
    input["runId"] !== runId ||
    !hash(input["pauseStateSha256"]) ||
    !hash(input["sessionIdSha256"]) ||
    !count(input["sessionOperation"]) ||
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
    input["schemaVersion"] !== 1 ||
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
    input["sessionIdSha256"] !== request.expectedSessionIdSha256 ||
    input["sessionOperation"] !== request.expectedSessionOperation + 1 ||
    input["crossOriginAuthorized"] !==
      ("allowCrossOrigin" in request && request.allowCrossOrigin === true) ||
    !(await actionReceiptEvidence(input, request))
  ) {
    throw invalid();
  }
  return input as unknown as BrowserTakeoverActionReceipt;
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
    typeof input["crossOriginAuthorized"] === "boolean" &&
    timestamp(input["requestedAt"]) &&
    timestamp(input["settledAt"]) &&
    hash(input["sessionIdSha256"]) &&
    count(input["sessionOperation"]) &&
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
  return request.action === "back";
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

function optionalCount(value: unknown): boolean {
  return value === undefined || count(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function invalid(): Error {
  return new Error("Browser takeover response is invalid");
}
