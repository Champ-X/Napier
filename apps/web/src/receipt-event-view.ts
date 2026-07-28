import type { RunEvent } from "@napier/contracts";

export interface ReceiptEventTraceView {
  action: string;
  receiptKind?: string;
  status?: string;
  refreshStatus?: string;
  keyId?: string;
  algorithm?: string;
  trustAnchorId?: string;
  subscriptionId?: string;
  activationDecisionRecordId?: string;
  subscriptionRevision?: number;
  transparencyEntryCount?: number;
  activeSelectionCount?: number;
  affectedExtensionCount?: number;
  anchorCount?: number;
  trustedCount?: number;
  revokedCount?: number;
  signingCapable?: boolean;
  applied?: boolean;
  receiptSha256?: string;
  receiptArtifactSha256?: string;
  statementSha256?: string;
  envelopeSha256?: string;
  directorySha256?: string;
  anchorSetSha256?: string;
  sourceUrlSha256?: string;
  sourceOriginSha256?: string;
  subscriptionSha256?: string;
  policySha256?: string;
  refreshResultSha256?: string;
  transparencyTailSha256?: string;
  activeDirectorySha256?: string;
  activeAnchorSetSha256?: string;
  activeEnvelopeSha256?: string;
  activeCheckpointSha256?: string;
  activeSelectionChainTailSha256?: string;
  activeProposalSha256?: string;
  activePreflightSha256?: string;
  discoverySha256?: string;
  failureSha256?: string;
  approvalEnvelopeSha256?: string;
  approvalSha256?: string;
  proposalSha256?: string;
  preflightSha256?: string;
  resultSha256?: string;
  selectionSha256?: string;
  selectionStateSha256?: string;
  previousSelectionSha256?: string;
  policyReviewSha256?: string;
  approvalPolicyBaselineSha256?: string;
  applyResultSha256?: string;
  approvalEnvelopeSetSha256?: string;
  approvalPolicySha256?: string;
  anchorSha256?: string;
  affectedExtensionIdsSha256?: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:/@-]{1,180}$/u;
const RECEIPT_SUMMARY = "receipt trust receipt";

export function receiptEventTraceView(
  event: RunEvent,
): ReceiptEventTraceView | undefined {
  if (!isReceiptEvent(event.type)) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  return {
    action: event.type,
    ...safeTokenField(event.payload, "receiptKind"),
    ...safeTokenField(event.payload, "status"),
    ...safeTokenField(event.payload, "refreshStatus"),
    ...safeTokenField(event.payload, "keyId"),
    ...safeTokenField(event.payload, "algorithm"),
    ...safeTokenField(event.payload, "trustAnchorId"),
    ...safeTokenField(event.payload, "subscriptionId"),
    ...safeTokenField(event.payload, "activationDecisionRecordId"),
    ...integerField(event.payload, "subscriptionRevision"),
    ...integerField(event.payload, "transparencyEntryCount"),
    ...integerField(event.payload, "activeSelectionCount"),
    ...integerField(event.payload, "affectedExtensionCount"),
    ...integerField(event.payload, "anchorCount"),
    ...integerField(event.payload, "trustedCount"),
    ...integerField(event.payload, "revokedCount"),
    ...booleanField(event.payload, "signingCapable"),
    ...booleanField(event.payload, "applied"),
    ...shaField(event.payload, "receiptSha256"),
    ...shaField(event.payload, "receiptArtifactSha256"),
    ...shaField(event.payload, "statementSha256"),
    ...shaField(event.payload, "envelopeSha256"),
    ...shaField(event.payload, "directorySha256"),
    ...shaField(event.payload, "anchorSetSha256"),
    ...shaField(event.payload, "sourceUrlSha256"),
    ...shaField(event.payload, "sourceOriginSha256"),
    ...shaField(event.payload, "subscriptionSha256"),
    ...shaField(event.payload, "policySha256"),
    ...shaField(event.payload, "refreshResultSha256"),
    ...shaField(event.payload, "transparencyTailSha256"),
    ...shaField(event.payload, "activeDirectorySha256"),
    ...shaField(event.payload, "activeAnchorSetSha256"),
    ...shaField(event.payload, "activeEnvelopeSha256"),
    ...shaField(event.payload, "activeCheckpointSha256"),
    ...shaField(event.payload, "activeSelectionChainTailSha256"),
    ...shaField(event.payload, "activeProposalSha256"),
    ...shaField(event.payload, "activePreflightSha256"),
    ...shaField(event.payload, "discoverySha256"),
    ...shaField(event.payload, "failureSha256"),
    ...shaField(event.payload, "approvalEnvelopeSha256"),
    ...shaField(event.payload, "approvalSha256"),
    ...shaField(event.payload, "proposalSha256"),
    ...shaField(event.payload, "preflightSha256"),
    ...shaField(event.payload, "resultSha256"),
    ...shaField(event.payload, "selectionSha256"),
    ...shaField(event.payload, "selectionStateSha256"),
    ...shaField(event.payload, "previousSelectionSha256"),
    ...shaField(event.payload, "policyReviewSha256"),
    ...shaField(event.payload, "approvalPolicyBaselineSha256"),
    ...shaField(event.payload, "applyResultSha256"),
    ...shaField(event.payload, "approvalEnvelopeSetSha256"),
    ...shaField(event.payload, "approvalPolicySha256"),
    ...shaField(event.payload, "anchorSha256"),
    ...shaField(event.payload, "affectedExtensionIdsSha256"),
  };
}

export function receiptEventTraceSummary(event: RunEvent): string | undefined {
  if (!isReceiptEvent(event.type)) return undefined;
  const view = receiptEventTraceView(event);
  if (!view) return RECEIPT_SUMMARY;
  return [
    `receipt / ${view.action.replace(/^receipt[._]/u, "")}`,
    ...(view.receiptKind ? [`kind ${view.receiptKind}`] : []),
    ...idSummary("anchor", view.trustAnchorId),
    ...idSummary("subscription", view.subscriptionId),
    ...idSummary("decision", view.activationDecisionRecordId),
    ...(view.status ? [`status ${view.status}`] : []),
    ...(view.refreshStatus ? [`refresh ${view.refreshStatus}`] : []),
    ...(view.keyId ? [`key ${view.keyId}`] : []),
    ...(view.algorithm ? [`algorithm ${view.algorithm}`] : []),
    ...numberSummaries(view),
    ...booleanSummaries(view),
    ...hashSummaries(view),
  ].join(" / ");
}

function isReceiptEvent(type: string): boolean {
  return type.startsWith("receipt.") || type.startsWith("receipt_trust.");
}

function numberSummaries(view: ReceiptEventTraceView): string[] {
  return [
    ...(view.subscriptionRevision !== undefined
      ? [`subscription-revision ${view.subscriptionRevision}`]
      : []),
    ...(view.transparencyEntryCount !== undefined
      ? [`transparency-entries ${view.transparencyEntryCount}`]
      : []),
    ...(view.activeSelectionCount !== undefined
      ? [`active-selections ${view.activeSelectionCount}`]
      : []),
    ...(view.affectedExtensionCount !== undefined
      ? [`affected-extensions ${view.affectedExtensionCount}`]
      : []),
    ...(view.anchorCount !== undefined ? [`anchors ${view.anchorCount}`] : []),
    ...(view.trustedCount !== undefined
      ? [`trusted ${view.trustedCount}`]
      : []),
    ...(view.revokedCount !== undefined
      ? [`revoked ${view.revokedCount}`]
      : []),
  ];
}

function booleanSummaries(view: ReceiptEventTraceView): string[] {
  return [
    ...(view.signingCapable !== undefined
      ? [`signing-capable ${view.signingCapable}`]
      : []),
    ...(view.applied !== undefined ? [`applied ${view.applied}`] : []),
  ];
}

function hashSummaries(view: ReceiptEventTraceView): string[] {
  return [
    ...hashSummary("receipt", view.receiptSha256),
    ...hashSummary("receipt-artifact", view.receiptArtifactSha256),
    ...hashSummary("statement", view.statementSha256),
    ...hashSummary("envelope", view.envelopeSha256),
    ...hashSummary("directory", view.directorySha256),
    ...hashSummary("anchor-set", view.anchorSetSha256),
    ...hashSummary("source-url", view.sourceUrlSha256),
    ...hashSummary("source-origin", view.sourceOriginSha256),
    ...hashSummary("subscription", view.subscriptionSha256),
    ...hashSummary("policy", view.policySha256),
    ...hashSummary("refresh-result", view.refreshResultSha256),
    ...hashSummary("transparency-tail", view.transparencyTailSha256),
    ...hashSummary("active-directory", view.activeDirectorySha256),
    ...hashSummary("active-anchor-set", view.activeAnchorSetSha256),
    ...hashSummary("active-envelope", view.activeEnvelopeSha256),
    ...hashSummary("active-checkpoint", view.activeCheckpointSha256),
    ...hashSummary("active-selection-chain", view.activeSelectionChainTailSha256),
    ...hashSummary("active-proposal", view.activeProposalSha256),
    ...hashSummary("active-preflight", view.activePreflightSha256),
    ...hashSummary("discovery", view.discoverySha256),
    ...hashSummary("failure", view.failureSha256),
    ...hashSummary("approval-envelope", view.approvalEnvelopeSha256),
    ...hashSummary("approval", view.approvalSha256),
    ...hashSummary("proposal", view.proposalSha256),
    ...hashSummary("preflight", view.preflightSha256),
    ...hashSummary("result", view.resultSha256),
    ...hashSummary("selection", view.selectionSha256),
    ...hashSummary("selection-state", view.selectionStateSha256),
    ...hashSummary("previous-selection", view.previousSelectionSha256),
    ...hashSummary("policy-review", view.policyReviewSha256),
    ...hashSummary("approval-policy-baseline", view.approvalPolicyBaselineSha256),
    ...hashSummary("apply-result", view.applyResultSha256),
    ...hashSummary("approval-envelope-set", view.approvalEnvelopeSetSha256),
    ...hashSummary("approval-policy", view.approvalPolicySha256),
    ...hashSummary("anchor", view.anchorSha256),
    ...hashSummary("affected", view.affectedExtensionIdsSha256),
  ];
}

function idSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(-10)}`] : [];
}

function hashSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function safeTokenField(
  payload: Record<string, unknown>,
  key: keyof ReceiptEventTraceView,
): Partial<ReceiptEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function integerField(
  payload: Record<string, unknown>,
  key: keyof ReceiptEventTraceView,
): Partial<ReceiptEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { [key]: value }
    : {};
}

function booleanField(
  payload: Record<string, unknown>,
  key: keyof ReceiptEventTraceView,
): Partial<ReceiptEventTraceView> {
  const value = payload[key];
  return typeof value === "boolean" ? { [key]: value } : {};
}

function shaField(
  payload: Record<string, unknown>,
  key: keyof ReceiptEventTraceView,
): Partial<ReceiptEventTraceView> {
  const value = sha256(payload[key]);
  return value ? { [key]: value } : {};
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value) ? value : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}
