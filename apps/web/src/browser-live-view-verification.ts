import {
  BROWSER_PAGE_DIAGNOSIS_STATUSES,
  type BrowserLiveViewReceipt,
  type BrowserPageDiagnosisStatus,
} from "@napier/contracts/browser-live-view";

import { canonicalJson, sha256Text } from "./stable-digest";

const HASH = /^[a-f0-9]{64}$/u;
export const MAX_LIVE_VIEW_BYTES = 8 * 1024 * 1024;

export async function verifyBrowserLiveView(input: {
  path: string;
  threadId: string;
  runId: string;
  bytes: ArrayBuffer;
  receipt: BrowserLiveViewReceipt;
}): Promise<void> {
  if (
    input.receipt.threadId !== input.threadId ||
    input.receipt.runId !== input.runId
  ) {
    throw new Error(`Browser live view identity mismatch for ${input.path}`);
  }
  if (
    input.bytes.byteLength !== input.receipt.imageBytes ||
    input.bytes.byteLength < 1 ||
    input.bytes.byteLength > MAX_LIVE_VIEW_BYTES ||
    (await sha256ArrayBuffer(input.bytes)) !== input.receipt.imageSha256
  ) {
    throw new Error(`Browser live view image hash mismatch for ${input.path}`);
  }
  if (!pngMatchesViewport(input.bytes, input.receipt)) {
    throw new Error(`Browser live view dimensions mismatch for ${input.path}`);
  }
  if (
    input.receipt.pageDiagnosis.takeoverRecommended !==
      (input.receipt.pageDiagnosis.status !== "none") ||
    (input.receipt.pageDiagnosis.signalCount === 0) !==
      (input.receipt.pageDiagnosis.status === "none")
  ) {
    throw new Error("Browser live view response contract is invalid");
  }
  const { contentSha256: _contentSha256, ...content } = input.receipt;
  if (
    (await sha256Text(canonicalJson(content))) !== input.receipt.contentSha256
  ) {
    throw new Error(
      `Browser live view receipt hash mismatch for ${input.path}`,
    );
  }
}

export function validateBrowserLiveViewReceipt(
  value: unknown,
): BrowserLiveViewReceipt {
  const source = requiredRecord(value);
  const diagnosis = requiredRecord(source["pageDiagnosis"]);
  exactKeys(source, [
    "kind",
    "schemaVersion",
    "threadId",
    "runId",
    "sessionIdSha256",
    "sessionOperation",
    "activeTabId",
    "tabCount",
    "tabSetSha256",
    "imageSha256",
    "imageBytes",
    "mimeType",
    "viewportWidth",
    "viewportHeight",
    "capturedAt",
    "currentUrlSha256",
    "currentOriginSha256",
    "titleSha256",
    "browserExecutableSha256",
    "browserVersionSha256",
    "limitsSha256",
    "networkRequestCount",
    "blockedRequestCount",
    "pageDiagnosis",
    "contentSha256",
  ]);
  exactKeys(diagnosis, [
    "status",
    "signalCount",
    "signalsSha256",
    "takeoverRecommended",
  ]);
  assertReceiptCore(source);
  assertReceiptPage(source);
  assertReceiptRuntime(source);
  assertDiagnosis(diagnosis);
  return source as unknown as BrowserLiveViewReceipt;
}

function assertReceiptCore(value: Record<string, unknown>): void {
  if (
    value["kind"] !== "napier.browser-live-view" ||
    value["schemaVersion"] !== 4 ||
    !resource(value["threadId"], "thread") ||
    !resource(value["runId"], "run") ||
    !digest(value["sessionIdSha256"]) ||
    !integer(value["sessionOperation"], 0, 64) ||
    !tabId(value["activeTabId"]) ||
    !integer(value["tabCount"], 1, 4) ||
    !digest(value["tabSetSha256"]) ||
    !digest(value["contentSha256"])
  ) {
    throw new Error("Browser live view receipt is invalid");
  }
}

function assertReceiptPage(value: Record<string, unknown>): void {
  if (
    !digest(value["imageSha256"]) ||
    !integer(value["imageBytes"], 1, MAX_LIVE_VIEW_BYTES) ||
    value["mimeType"] !== "image/png" ||
    !integer(value["viewportWidth"], 1, 4_096) ||
    !integer(value["viewportHeight"], 1, 4_096) ||
    !timestamp(value["capturedAt"]) ||
    !digest(value["currentUrlSha256"]) ||
    !digest(value["currentOriginSha256"]) ||
    !digest(value["titleSha256"])
  ) {
    throw new Error("Browser live view receipt is invalid");
  }
}

function assertReceiptRuntime(value: Record<string, unknown>): void {
  if (
    !digest(value["browserExecutableSha256"]) ||
    !digest(value["browserVersionSha256"]) ||
    !digest(value["limitsSha256"]) ||
    !integer(value["networkRequestCount"], 0, 10_000) ||
    !integer(value["blockedRequestCount"], 0, 10_000)
  ) {
    throw new Error("Browser live view receipt is invalid");
  }
}

function assertDiagnosis(value: Record<string, unknown>): void {
  if (!diagnosisStatus(value["status"])) {
    throw new Error("Browser live view page diagnosis is invalid");
  }
  if (
    !integer(value["signalCount"], 0, 12) ||
    !digest(value["signalsSha256"]) ||
    typeof value["takeoverRecommended"] !== "boolean"
  ) {
    throw new Error("Browser live view receipt is invalid");
  }
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (!record(value)) {
    throw new Error("Browser live view receipt is invalid");
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error("Browser live view receipt is invalid");
  }
}

export function receiptFromHeaders(
  response: Response,
  observedBytes: number,
): BrowserLiveViewReceipt {
  const receipt = validateBrowserLiveViewReceipt({
    kind: "napier.browser-live-view",
    schemaVersion: 4,
    threadId: required(response, "X-Napier-Thread-Id"),
    runId: required(response, "X-Napier-Run-Id"),
    sessionIdSha256: required(response, "X-Napier-Browser-Session-SHA256"),
    sessionOperation: number(response, "X-Napier-Browser-Session-Operation"),
    activeTabId: required(response, "X-Napier-Browser-Active-Tab-Id"),
    tabCount: number(response, "X-Napier-Browser-Tab-Count"),
    tabSetSha256: required(response, "X-Napier-Browser-Tab-Set-SHA256"),
    imageSha256: required(response, "X-Napier-Content-SHA256"),
    imageBytes: number(response, "Content-Length"),
    mimeType: response.headers.get("Content-Type")?.split(";")[0]?.trim(),
    viewportWidth: number(response, "X-Napier-Browser-Viewport-Width"),
    viewportHeight: number(response, "X-Napier-Browser-Viewport-Height"),
    capturedAt: required(response, "X-Napier-Browser-Captured-At"),
    currentUrlSha256: required(response, "X-Napier-Browser-URL-SHA256"),
    currentOriginSha256: required(response, "X-Napier-Browser-Origin-SHA256"),
    titleSha256: required(response, "X-Napier-Browser-Title-SHA256"),
    browserExecutableSha256: required(
      response,
      "X-Napier-Browser-Executable-SHA256",
    ),
    browserVersionSha256: required(response, "X-Napier-Browser-Version-SHA256"),
    limitsSha256: required(response, "X-Napier-Browser-Limits-SHA256"),
    networkRequestCount: number(
      response,
      "X-Napier-Browser-Network-Request-Count",
    ),
    blockedRequestCount: number(
      response,
      "X-Napier-Browser-Blocked-Request-Count",
    ),
    pageDiagnosis: {
      status: required(response, "X-Napier-Browser-Page-Diagnosis"),
      signalCount: number(
        response,
        "X-Napier-Browser-Page-Diagnosis-Signal-Count",
      ),
      signalsSha256: required(
        response,
        "X-Napier-Browser-Page-Diagnosis-Signals-SHA256",
      ),
      takeoverRecommended: headerBoolean(
        response,
        "X-Napier-Browser-Takeover-Recommended",
      ),
    },
    contentSha256: required(response, "X-Napier-Browser-Live-Receipt-SHA256"),
  });
  if (
    response.headers.get("Cache-Control") !== "no-store" ||
    response.headers.get("X-Content-Type-Options") !== "nosniff" ||
    response.headers.get("X-Napier-Content-SHA256-Mode") !== "body" ||
    receipt.imageBytes !== observedBytes
  ) {
    throw new Error("Browser live view response contract is invalid");
  }
  return receipt;
}

export function decodeCanonicalBase64(value: string): ArrayBuffer {
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value) ||
    value.length % 4 !== 0 ||
    value.length > Math.ceil(MAX_LIVE_VIEW_BYTES / 3) * 4
  ) {
    throw new Error("Browser live view image encoding is invalid");
  }
  const decoded = atob(value);
  const bytes = Uint8Array.from(decoded, (character) =>
    character.charCodeAt(0),
  );
  if (bytes.byteLength === 0 || bytesToBase64(bytes) !== value) {
    throw new Error("Browser live view image encoding is invalid");
  }
  return bytes.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let value = "";
  for (let index = 0; index < bytes.byteLength; index += 32_768) {
    value += String.fromCharCode(...bytes.subarray(index, index + 32_768));
  }
  return btoa(value);
}

async function sha256ArrayBuffer(value: ArrayBuffer): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(result)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function pngMatchesViewport(
  value: ArrayBuffer,
  receipt: Pick<BrowserLiveViewReceipt, "viewportWidth" | "viewportHeight">,
): boolean {
  if (value.byteLength < 24) return false;
  const bytes = new Uint8Array(value);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) return false;
  const view = new DataView(value);
  return (
    view.getUint32(16) === receipt.viewportWidth &&
    view.getUint32(20) === receipt.viewportHeight
  );
}

function required(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (!value) throw new Error(`Browser live view ${name} is missing`);
  return value;
}

function number(response: Response, name: string): number {
  return Number(required(response, name));
}

function headerBoolean(response: Response, name: string): boolean {
  const value = required(response, name);
  if (value !== "true" && value !== "false") {
    throw new Error(`Browser live view ${name} is invalid`);
  }
  return value === "true";
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function diagnosisStatus(value: unknown): value is BrowserPageDiagnosisStatus {
  return BROWSER_PAGE_DIAGNOSIS_STATUSES.includes(
    value as BrowserPageDiagnosisStatus,
  );
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function resource(value: unknown, prefix: "thread" | "run"): value is string {
  return (
    typeof value === "string" &&
    new RegExp(`^${prefix}_[a-z0-9]{4,80}$`, "u").test(value)
  );
}

function tabId(value: unknown): value is string {
  return typeof value === "string" && /^tab_[1-9][0-9]{0,3}$/u.test(value);
}
