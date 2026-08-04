import type { RunEvent } from "@napier/contracts";
import {
  BROWSER_INTERACTION_ACTIONS,
  type BrowserInteractionConfirmation,
} from "@napier/contracts/browser-interaction-confirmation";

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

export function openBrowserInteractionConfirmation(
  events: readonly RunEvent[],
): BrowserInteractionConfirmation | undefined {
  const settled = new Set<string>();
  for (const event of events.slice().reverse()) {
    if (!event.type.startsWith("browser.interaction_confirmation.")) continue;
    const confirmation = parseBrowserInteractionConfirmation(event.payload);
    if (
      !confirmation ||
      confirmation.threadId !== event.threadId ||
      confirmation.runId !== event.runId ||
      event.type !== `browser.interaction_confirmation.${confirmation.status}`
    ) {
      continue;
    }
    if (confirmation.status !== "pending") {
      settled.add(confirmation.id);
      continue;
    }
    if (!settled.has(confirmation.id)) return confirmation;
  }
  return undefined;
}

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
    exactConfirmationKeys(value) &&
    value["kind"] === "napier.browser-interaction-confirmation" &&
    value["schemaVersion"] === 1 &&
    typeof value["id"] === "string" &&
    ID.test(value["id"]) &&
    typeof value["threadId"] === "string" &&
    typeof value["runId"] === "string" &&
    typeof value["callId"] === "string" &&
    typeof action === "string" &&
    BROWSER_INTERACTION_ACTIONS.includes(
      action as BrowserInteractionConfirmation["action"],
    )
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
  status: unknown,
): status is BrowserInteractionConfirmation["status"] {
  return (
    status === "pending" ||
    status === "approved" ||
    status === "rejected" ||
    status === "expired" ||
    status === "cancelled"
  );
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function exactConfirmationKeys(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => CONFIRMATION_KEYS.has(key));
}

function validDecisionFields(
  value: Record<string, unknown>,
  status: unknown,
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
    "crossOriginAuthorized",
  ]);
  const hashFields = [
    preview["targetSha256"],
    preview["textSha256"],
    preview["valueSetSha256"],
    preview["pathSha256"],
  ];
  return (
    Object.keys(preview).every((key) => keys.has(key)) &&
    typeof preview["crossOriginAuthorized"] === "boolean" &&
    validPreviewTarget(preview) &&
    validPreviewEvidence(preview, hashFields)
  );
}

function validPreviewEvidence(
  preview: Record<string, unknown>,
  hashFields: unknown[],
): boolean {
  return (
    hashFields.every((entry) => entry === undefined || hash(entry)) &&
    validOptionalCount(preview["textBytes"]) &&
    validOptionalCount(preview["valueCount"])
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
