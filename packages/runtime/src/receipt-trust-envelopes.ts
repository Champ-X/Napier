import { createHash } from "node:crypto";

import {
  NAPIER_API_VERSION,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem,
  type ReceiptTrustAnchor,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  type TrustedReceipt,
  type TrustedReceiptEnvelope,
  type TrustedReceiptKind,
  type TrustedReceiptVerification,
} from "@napier/contracts";

import { validateEvaluationCasebookQualificationReceipt } from "./evaluation-casebook-qualification.js";
import { validateEvaluationSuiteGateReceipt } from "./evaluation-suites.js";
import {
  validateReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt,
  validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
  validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval,
  validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
  validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
  validateReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
} from "./receipt-trust-directory-subscriptions.js";
import {
  signTrustedReceiptWithValidator,
  validateReceiptTrustAnchorDirectoryMetadataReceipt,
  validateTrustedReceiptEnvelopeWithValidator,
  verifyTrustedReceiptEnvelopeWithValidator,
  type ValidatedTrustedReceipt,
} from "./receipt-trust.js";

export {
  MAX_QUALIFICATION_BASELINES_PER_CASEBOOK,
  MAX_RECEIPT_TRUST_ANCHORS,
  MAX_TRUSTED_RECEIPT_BYTES,
  createEvaluationQualificationBaseline,
  createReceiptTrustAnchor,
  createReceiptTrustAnchorDirectory,
  createReceiptTrustAnchorDirectoryMetadataReceipt,
  hashEvaluationQualificationBaseline,
  hashReceiptTrustAnchor,
  hashReceiptTrustAnchorDirectoryMetadataReceipt,
  hashReceiptTrustAnchorDirectoryVerificationPolicy,
  hashTrustedReceiptEnvelope,
  normalizeReceiptTrustAnchorDirectoryVerificationPolicy,
  receiptTrustAnchorsFromDirectory,
  revokeReceiptTrustAnchor,
  validateEvaluationQualificationBaseline,
  validateReceiptTrustAnchor,
  validateReceiptTrustAnchorDirectory,
  validateReceiptTrustAnchorDirectoryMetadataReceipt,
  verifyReceiptTrustAnchorDirectory,
  verifyReceiptTrustAnchorDirectoryMetadata,
} from "./receipt-trust.js";

export function signTrustedReceipt<Receipt extends TrustedReceipt>(
  receipt: Receipt,
  anchor: ReceiptTrustAnchor,
  environment: NodeJS.ProcessEnv = process.env,
): TrustedReceiptEnvelope<Receipt> {
  return signTrustedReceiptWithValidator(
    receipt,
    anchor,
    validateTrustedReceipt,
    environment,
  );
}

export function validateTrustedReceiptEnvelope(
  value: unknown,
): TrustedReceiptEnvelope {
  return validateTrustedReceiptEnvelopeWithValidator(
    value,
    validateTrustedReceipt,
  );
}

export function verifyTrustedReceiptEnvelope(
  value: unknown,
  anchors: ReceiptTrustAnchor[],
): TrustedReceiptVerification {
  return verifyTrustedReceiptEnvelopeWithValidator(
    value,
    anchors,
    validateTrustedReceipt,
  );
}

const RECEIPT_VALIDATORS: Readonly<
  Record<
    string,
    {
      receiptKind: TrustedReceiptKind;
      validate(value: unknown): TrustedReceipt;
    }
  >
> = {
  "napier.evaluation-gate-receipt": {
    receiptKind: "evaluation_gate",
    validate: validateEvaluationSuiteGateReceipt,
  },
  "napier.evaluation-casebook-qualification-receipt": {
    receiptKind: "casebook_qualification",
    validate: validateEvaluationCasebookQualificationReceipt,
  },
  "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-proof-bundle":
    {
      receiptKind: "policy_retirement_proof_bundle",
      validate:
        validateExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle,
    },
  "napier.receipt-trust-anchor-directory-metadata-receipt": {
    receiptKind: "receipt_trust_anchor_directory_metadata",
    validate: validateReceiptTrustAnchorDirectoryMetadataReceipt,
  },
  "napier.receipt-trust-anchor-directory-quorum-promotion": {
    receiptKind: "receipt_trust_anchor_directory_quorum_promotion",
    validate: validateReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
  },
  "napier.receipt-trust-anchor-directory-quorum-activation-decision": {
    receiptKind: "receipt_trust_anchor_directory_quorum_activation_decision",
    validate:
      validateReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt,
  },
  "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal":
    {
      receiptKind:
        "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal",
      validate: (value) =>
        validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal(
          value,
        ) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal,
    },
  "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval":
    {
      receiptKind:
        "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval",
      validate: (value) =>
        validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval(
          value,
        ) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval,
    },
  "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval-policy-review":
    {
      receiptKind:
        "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval_policy_review",
      validate: (value) =>
        validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview(
          value,
        ) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
    },
  "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint":
    {
      receiptKind:
        "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint",
      validate: (value) =>
        validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
          value,
        ) as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
    },
  "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-registry-quorum":
    {
      receiptKind:
        "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint_registry_quorum",
      validate:
        validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
    },
};

function validateTrustedReceipt(value: unknown): ValidatedTrustedReceipt {
  if (!isRecord(value) || typeof value["kind"] !== "string") {
    throw new Error("Trusted receipt payload is invalid");
  }
  const validator = RECEIPT_VALIDATORS[value["kind"]];
  if (!validator) throw new Error("Trusted receipt kind is unsupported");
  return {
    receipt: validator.validate(value),
    receiptKind: validator.receiptKind,
  };
}

function validateExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle(
  value: unknown,
): ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle {
  if (!isRecord(value)) {
    throw new Error("Policy retirement proof bundle is invalid");
  }
  assertAllowedKeys(value, [
    "kind",
    "schemaVersion",
    "apiVersion",
    "generatedAt",
    "status",
    "diagnostics",
    "historyCount",
    "validHistoryCount",
    "invalidHistoryCount",
    "distinctHistoryCount",
    "distinctPortfolioSetCount",
    "distinctCurrentOverrideSetCount",
    "distinctRetirementSetCount",
    "historySetSha256",
    "portfolioSetBundleSha256",
    "currentOverrideSetBundleSha256",
    "retirementSetBundleSha256",
    "histories",
    "contentSha256",
  ]);
  const proofBundle =
    value as unknown as ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle;
  if (!validPolicyRetirementProofBundle(proofBundle)) {
    throw new Error("Policy retirement proof bundle is invalid");
  }
  const histories = proofBundle.histories.map(
    validateExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem,
  );
  if (
    histories.filter((history) => history.status === "valid").length !==
      proofBundle.validHistoryCount ||
    histories.filter((history) => history.status === "invalid").length !==
      proofBundle.invalidHistoryCount
  ) {
    throw new Error("Policy retirement proof bundle counts are invalid");
  }
  const {
    contentSha256: _contentSha256,
    generatedAt: _generatedAt,
    ...content
  } = {
    ...proofBundle,
    histories,
  };
  if (sha256(canonicalJson(content)) !== proofBundle.contentSha256) {
    throw new Error("Policy retirement proof bundle hash mismatch");
  }
  return structuredClone({
    ...proofBundle,
    histories,
  });
}

function validPolicyRetirementProofBundle(
  proofBundle: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle,
): boolean {
  return (
    proofBundle.kind ===
      "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-proof-bundle" &&
    proofBundle.schemaVersion === 1 &&
    proofBundle.apiVersion === NAPIER_API_VERSION &&
    validTimestamp(proofBundle.generatedAt) &&
    ["aligned", "divergent", "invalid"].includes(proofBundle.status) &&
    validDiagnostics(proofBundle.diagnostics) &&
    [
      proofBundle.historyCount,
      proofBundle.validHistoryCount,
      proofBundle.invalidHistoryCount,
      proofBundle.distinctHistoryCount,
      proofBundle.distinctPortfolioSetCount,
      proofBundle.distinctCurrentOverrideSetCount,
      proofBundle.distinctRetirementSetCount,
    ].every(nonNegativeInteger) &&
    [
      proofBundle.historySetSha256,
      proofBundle.portfolioSetBundleSha256,
      proofBundle.currentOverrideSetBundleSha256,
      proofBundle.retirementSetBundleSha256,
      proofBundle.contentSha256,
    ].every(isSha256) &&
    Array.isArray(proofBundle.histories) &&
    proofBundle.histories.length === proofBundle.historyCount
  );
}

function validateExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem(
  value: unknown,
): ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem {
  if (!isRecord(value)) {
    throw new Error("Policy retirement proof bundle history is invalid");
  }
  assertAllowedKeys(value, [
    "index",
    "status",
    "diagnostics",
    "declaredContentSha256",
    "recomputedContentSha256",
    "declaredPortfolioSetSha256",
    "declaredCurrentOverrideSetSha256",
    "declaredRetirementSetSha256",
    "recomputedRetirementSetSha256",
    "retirementCount",
    "recomputedRetirementCount",
    "latestRetiredAt",
    "recomputedLatestRetiredAt",
    "itemSha256",
  ]);
  const item =
    value as unknown as ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem;
  if (
    !nonNegativeInteger(item.index) ||
    (item.status !== "valid" && item.status !== "invalid") ||
    !validDiagnostics(item.diagnostics) ||
    !optionalSha256(item.declaredContentSha256) ||
    !optionalSha256(item.recomputedContentSha256) ||
    !optionalSha256(item.declaredPortfolioSetSha256) ||
    !optionalSha256(item.declaredCurrentOverrideSetSha256) ||
    !optionalSha256(item.declaredRetirementSetSha256) ||
    !optionalSha256(item.recomputedRetirementSetSha256) ||
    !optionalNonNegativeInteger(item.retirementCount) ||
    !optionalNonNegativeInteger(item.recomputedRetirementCount) ||
    !optionalTimestamp(item.latestRetiredAt) ||
    !optionalTimestamp(item.recomputedLatestRetiredAt) ||
    !isSha256(item.itemSha256)
  ) {
    throw new Error("Policy retirement proof bundle history is invalid");
  }
  const { itemSha256: _itemSha256, ...content } = item;
  if (sha256(canonicalJson(content)) !== item.itemSha256) {
    throw new Error("Policy retirement proof bundle history hash mismatch");
  }
  return structuredClone(item);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function optionalTimestamp(value: unknown): boolean {
  return value === undefined || validTimestamp(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || nonNegativeInteger(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function optionalSha256(value: unknown): boolean {
  return value === undefined || isSha256(value);
}

function validDiagnostics(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every(
      (diagnostic) =>
        typeof diagnostic === "string" && /^[a-z0-9_]{1,80}$/u.test(diagnostic),
    )
  );
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error("Trusted receipt contains unsupported fields");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
