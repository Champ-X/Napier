export const BROWSER_INTERACTION_ACTIONS = [
  "click",
  "type",
  "select",
  "upload",
  "download",
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
