export const BROWSER_INTERACTION_ACTIONS = [
  "click",
  "type",
  "select",
  "upload",
  "download",
  "save_screenshot",
] as const;

export type BrowserInteractionAction =
  (typeof BROWSER_INTERACTION_ACTIONS)[number];

export type BrowserInteractionConfirmationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

export interface BrowserInteractionConfirmationPreview {
  targetKind?: "ref" | "selector";
  targetSha256?: string;
  textSha256?: string;
  textBytes?: number;
  valueCount?: number;
  valueSetSha256?: string;
  pathSha256?: string;
  fileSha256?: string;
  fileBytes?: number;
  pageStateSha256?: string;
  sourceImageSha256?: string;
  crossOriginAuthorized: boolean;
}

export interface BrowserInteractionConfirmation {
  kind: "napier.browser-interaction-confirmation";
  schemaVersion: 1;
  id: `browser_confirm_${string}`;
  threadId: string;
  runId: string;
  callId: string;
  action: BrowserInteractionAction;
  argumentsSha256: string;
  preview: BrowserInteractionConfirmationPreview;
  status: BrowserInteractionConfirmationStatus;
  requestedAt: string;
  expiresAt: string;
  requestSha256: string;
  decidedAt?: string;
  decisionSha256?: string;
  contentSha256: string;
}

export interface DecideBrowserInteractionConfirmationRequest {
  decision: "approve" | "reject";
  expectedRequestSha256: string;
}

const HASH = /^[a-f0-9]{64}$/u;
const ID = /^browser_confirm_[a-z0-9_-]{8,80}$/u;
const CONFIRMATION_KEYS = new Set([
  "kind",
  "schemaVersion",
  "id",
  "threadId",
  "runId",
  "callId",
  "action",
  "argumentsSha256",
  "preview",
  "status",
  "requestedAt",
  "expiresAt",
  "requestSha256",
  "decidedAt",
  "decisionSha256",
  "contentSha256",
]);

export function parseBrowserInteractionConfirmation(
  input: unknown,
): BrowserInteractionConfirmation | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const value = input as Record<string, unknown>;
  if (!validConfirmationIdentity(value) || !validConfirmationEvidence(value)) {
    return undefined;
  }
  return value as unknown as BrowserInteractionConfirmation;
}

function validConfirmationIdentity(value: Record<string, unknown>): boolean {
  const action = value["action"];
  return (
    Object.keys(value).every((key) => CONFIRMATION_KEYS.has(key)) &&
    value["kind"] === "napier.browser-interaction-confirmation" &&
    value["schemaVersion"] === 1 &&
    typeof value["id"] === "string" &&
    ID.test(value["id"]) &&
    typeof value["threadId"] === "string" &&
    typeof value["runId"] === "string" &&
    typeof value["callId"] === "string" &&
    typeof action === "string" &&
    BROWSER_INTERACTION_ACTIONS.includes(action as BrowserInteractionAction)
  );
}

function validConfirmationEvidence(value: Record<string, unknown>): boolean {
  const status = value["status"];
  return (
    validStatus(status) &&
    hash(value["argumentsSha256"]) &&
    validPreview(value["preview"]) &&
    typeof value["requestedAt"] === "string" &&
    typeof value["expiresAt"] === "string" &&
    hash(value["requestSha256"]) &&
    validDecisionFields(value, status) &&
    hash(value["contentSha256"])
  );
}

function validStatus(
  value: unknown,
): value is BrowserInteractionConfirmationStatus {
  return (
    value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "expired" ||
    value === "cancelled"
  );
}

function validDecisionFields(
  value: Record<string, unknown>,
  status: BrowserInteractionConfirmationStatus,
): boolean {
  return status === "pending"
    ? value["decidedAt"] === undefined && value["decisionSha256"] === undefined
    : typeof value["decidedAt"] === "string" && hash(value["decisionSha256"]);
}

function validPreview(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const preview = value as Record<string, unknown>;
  const keys = new Set([
    "targetKind",
    "targetSha256",
    "textSha256",
    "textBytes",
    "valueCount",
    "valueSetSha256",
    "pathSha256",
    "fileSha256",
    "fileBytes",
    "pageStateSha256",
    "sourceImageSha256",
    "crossOriginAuthorized",
  ]);
  return (
    Object.keys(preview).every((key) => keys.has(key)) &&
    typeof preview["crossOriginAuthorized"] === "boolean" &&
    validPreviewTarget(preview) &&
    [
      preview["targetSha256"],
      preview["textSha256"],
      preview["valueSetSha256"],
      preview["pathSha256"],
      preview["fileSha256"],
      preview["pageStateSha256"],
      preview["sourceImageSha256"],
    ].every((entry) => entry === undefined || hash(entry)) &&
    (preview["fileSha256"] === undefined) ===
      (preview["fileBytes"] === undefined) &&
    validOptionalCount(preview["textBytes"]) &&
    validOptionalCount(preview["valueCount"]) &&
    validOptionalCount(preview["fileBytes"])
  );
}

function validPreviewTarget(preview: Record<string, unknown>): boolean {
  return preview["targetKind"] === undefined
    ? preview["targetSha256"] === undefined
    : (preview["targetKind"] === "ref" ||
        preview["targetKind"] === "selector") &&
        hash(preview["targetSha256"]);
}

function validOptionalCount(value: unknown): boolean {
  return (
    value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0)
  );
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}
