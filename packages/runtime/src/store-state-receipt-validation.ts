import {
  type ReceiptTrustAnchorDirectoryQuorumActivationSelection,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  type ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
} from "@napier/contracts";
import { receiptTrustAnchorDirectoryQuorumPromotionBaselineKey } from "./receipt-trust-anchor-repository.js";
import {
  receiptTrustCheckpointRegistryQuorumBaselineKey,
  receiptTrustRotationApprovalPolicyBaselineKey,
} from "./receipt-trust-checkpoint-baseline-repository.js";
import {
  MAX_RECEIPT_TRUST_CHECKPOINT_REGISTRY_QUORUM_BASELINES,
  MAX_RECEIPT_TRUST_CHECKPOINT_SUBSCRIPTIONS,
  MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS,
  MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_PROMOTION_BASELINES,
  MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS,
  MAX_RECEIPT_TRUST_ROTATION_PROPOSAL_SUBSCRIPTIONS,
  validatePersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription,
  validatePersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  validatePersistedReceiptTrustAnchorDirectorySubscription,
  validateReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord,
  validateReceiptTrustAnchorDirectoryQuorumActivationSelection,
  validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  validateReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
} from "./receipt-trust-directory-subscriptions.js";
import {
  MAX_RECEIPT_TRUST_ANCHORS,
  validateReceiptTrustAnchor,
} from "./receipt-trust-envelopes.js";
import type { PersistedStoreState } from "./store-state.js";
export function validatePersistedReceiptTrustState(
  state: PersistedStoreState,
): void {
  validateTrustAnchors(state);
  validateDirectorySubscriptions(state);
  validateCheckpointSubscriptions(state);
  validateRotationSubscriptions(state);
  validateCheckpointBaselines(state);
  validatePromotionBaselines(state);
  validateRotationApprovalBaselines(state);
  validateActivationDecisions(state);
  validateActivationSelections(state);
}

function validateTrustAnchors(state: PersistedStoreState): void {
  if (state.receiptTrustAnchors.length > MAX_RECEIPT_TRUST_ANCHORS) {
    throw new Error("Persisted receipt trust anchor limit is exceeded");
  }
  const trustAnchorIds = new Set<string>();
  const trustAnchorKeyIds = new Set<string>();
  const trustAnchorSigningSources = new Set<string>();
  for (const anchor of state.receiptTrustAnchors) {
    validateReceiptTrustAnchor(anchor);
    const signingSource = anchor.signingSource?.variable;
    if (
      trustAnchorIds.has(anchor.id) ||
      trustAnchorKeyIds.has(anchor.keyId) ||
      (signingSource !== undefined &&
        trustAnchorSigningSources.has(signingSource))
    ) {
      throw new Error(`Duplicate persisted receipt trust anchor: ${anchor.id}`);
    }
    trustAnchorIds.add(anchor.id);
    trustAnchorKeyIds.add(anchor.keyId);
    if (signingSource) trustAnchorSigningSources.add(signingSource);
  }
}

function validateDirectorySubscriptions(state: PersistedStoreState): void {
  if (
    state.receiptTrustAnchorDirectorySubscriptions.length >
    MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS
  ) {
    throw new Error(
      "Persisted receipt trust anchor directory subscription limit is exceeded",
    );
  }
  const trustDirectorySubscriptionIds = new Set<string>();
  const trustDirectorySubscriptionSourceHashes = new Set<string>();
  for (const input of state.receiptTrustAnchorDirectorySubscriptions) {
    const subscription =
      validatePersistedReceiptTrustAnchorDirectorySubscription(input);
    if (
      trustDirectorySubscriptionIds.has(subscription.id) ||
      trustDirectorySubscriptionSourceHashes.has(
        subscription.sourceUrlSha256,
      ) ||
      !state.threads.some((thread) => thread.id === subscription.auditThreadId)
    ) {
      throw new Error(
        `Duplicate persisted receipt trust anchor directory subscription: ${subscription.id}`,
      );
    }
    trustDirectorySubscriptionIds.add(subscription.id);
    trustDirectorySubscriptionSourceHashes.add(subscription.sourceUrlSha256);
    Object.assign(input, subscription);
  }
}

function validateCheckpointSubscriptions(state: PersistedStoreState): void {
  if (
    state
      .receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions
      .length > MAX_RECEIPT_TRUST_CHECKPOINT_SUBSCRIPTIONS
  ) {
    throw new Error(
      "Persisted receipt trust anchor directory quorum activation selection checkpoint subscription limit is exceeded",
    );
  }
  const trustCheckpointSubscriptionIds = new Set<string>();
  const trustCheckpointSubscriptionSourceHashes = new Set<string>();
  for (const input of state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions) {
    const subscription =
      validatePersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
        input,
      );
    if (
      trustCheckpointSubscriptionIds.has(subscription.id) ||
      trustCheckpointSubscriptionSourceHashes.has(
        subscription.sourceUrlSha256,
      ) ||
      !state.threads.some((thread) => thread.id === subscription.auditThreadId)
    ) {
      throw new Error(
        `Duplicate persisted receipt trust anchor directory quorum activation selection checkpoint subscription: ${subscription.id}`,
      );
    }
    trustCheckpointSubscriptionIds.add(subscription.id);
    trustCheckpointSubscriptionSourceHashes.add(subscription.sourceUrlSha256);
    Object.assign(input, subscription);
  }
}

function validateRotationSubscriptions(state: PersistedStoreState): void {
  if (
    state
      .receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions
      .length > MAX_RECEIPT_TRUST_ROTATION_PROPOSAL_SUBSCRIPTIONS
  ) {
    throw new Error(
      "Persisted receipt trust anchor directory quorum activation selection rotation proposal subscription limit is exceeded",
    );
  }
  const trustRotationProposalSubscriptionIds = new Set<string>();
  const trustRotationProposalSubscriptionSourceHashes = new Set<string>();
  for (const input of state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions) {
    const subscription =
      validatePersistedReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription(
        input,
      );
    if (
      trustRotationProposalSubscriptionIds.has(subscription.id) ||
      trustRotationProposalSubscriptionSourceHashes.has(
        subscription.sourceUrlSha256,
      ) ||
      !state.threads.some((thread) => thread.id === subscription.auditThreadId)
    ) {
      throw new Error(
        `Duplicate persisted receipt trust anchor directory quorum activation selection rotation proposal subscription: ${subscription.id}`,
      );
    }
    trustRotationProposalSubscriptionIds.add(subscription.id);
    trustRotationProposalSubscriptionSourceHashes.add(
      subscription.sourceUrlSha256,
    );
    Object.assign(input, subscription);
  }
}

function validateCheckpointBaselines(state: PersistedStoreState): void {
  if (
    state
      .receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines
      .length > MAX_RECEIPT_TRUST_CHECKPOINT_REGISTRY_QUORUM_BASELINES
  ) {
    throw new Error(
      "Persisted receipt trust checkpoint registry quorum baseline limit is exceeded",
    );
  }
  const checkpointRegistryQuorumBaselineIds = new Set<string>();
  const checkpointRegistryQuorumBaselineKeys = new Set<string>();
  let latestCheckpointRegistryQuorumBaseline:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline
    | undefined;
  for (const input of state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines) {
    const baseline =
      validateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
        input,
        state.receiptTrustAnchors,
      );
    const baselineKey = receiptTrustCheckpointRegistryQuorumBaselineKey(
      baseline.envelope,
    );
    if (
      checkpointRegistryQuorumBaselineIds.has(baseline.id) ||
      checkpointRegistryQuorumBaselineKeys.has(baselineKey) ||
      !state.threads.some(
        (thread) => thread.id === baseline.promotedByThreadId,
      ) ||
      baseline.supersedesBaselineId !==
        latestCheckpointRegistryQuorumBaseline?.id
    ) {
      throw new Error(
        `Persisted receipt trust checkpoint registry quorum baseline is invalid: ${baseline.id}`,
      );
    }
    checkpointRegistryQuorumBaselineIds.add(baseline.id);
    checkpointRegistryQuorumBaselineKeys.add(baselineKey);
    latestCheckpointRegistryQuorumBaseline = baseline;
    Object.assign(input, baseline);
  }
}

function validatePromotionBaselines(state: PersistedStoreState): void {
  if (
    state.receiptTrustAnchorDirectoryQuorumPromotionBaselines.length >
    MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_PROMOTION_BASELINES
  ) {
    throw new Error(
      "Persisted receipt trust anchor directory quorum promotion baseline limit is exceeded",
    );
  }
  const trustDirectoryQuorumPromotionBaselineIds = new Set<string>();
  const trustDirectoryQuorumPromotionBaselineKeys = new Set<string>();
  let latestTrustDirectoryQuorumPromotionBaseline:
    | ReceiptTrustAnchorDirectoryQuorumPromotionBaseline
    | undefined;
  for (const input of state.receiptTrustAnchorDirectoryQuorumPromotionBaselines) {
    const baseline = validateReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
      input,
      state.receiptTrustAnchors,
    );
    const baselineKey = receiptTrustAnchorDirectoryQuorumPromotionBaselineKey(
      baseline.envelope,
    );
    if (
      trustDirectoryQuorumPromotionBaselineIds.has(baseline.id) ||
      trustDirectoryQuorumPromotionBaselineKeys.has(baselineKey) ||
      !state.threads.some(
        (thread) => thread.id === baseline.promotedByThreadId,
      ) ||
      baseline.supersedesBaselineId !==
        latestTrustDirectoryQuorumPromotionBaseline?.id
    ) {
      throw new Error(
        `Persisted receipt trust anchor directory quorum promotion baseline is invalid: ${baseline.id}`,
      );
    }
    trustDirectoryQuorumPromotionBaselineIds.add(baseline.id);
    trustDirectoryQuorumPromotionBaselineKeys.add(baselineKey);
    latestTrustDirectoryQuorumPromotionBaseline = baseline;
    Object.assign(input, baseline);
  }
}

function validateRotationApprovalBaselines(state: PersistedStoreState): void {
  if (
    state
      .receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines
      .length > MAX_RECEIPT_TRUST_CHECKPOINT_REGISTRY_QUORUM_BASELINES
  ) {
    throw new Error(
      "Persisted receipt trust rotation approval policy baseline limit is exceeded",
    );
  }
  const rotationApprovalPolicyBaselineIds = new Set<string>();
  const rotationApprovalPolicyBaselineKeys = new Set<string>();
  const rotationApprovalPolicyBaselinesBySha256 = new Map<
    string,
    ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline
  >();
  let latestRotationApprovalPolicyBaseline:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline
    | undefined;
  for (const input of state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines) {
    const baseline =
      validateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
        input,
        state.receiptTrustAnchors,
      );
    const baselineKey = receiptTrustRotationApprovalPolicyBaselineKey(
      baseline.envelope,
    );
    if (
      rotationApprovalPolicyBaselineIds.has(baseline.id) ||
      rotationApprovalPolicyBaselineKeys.has(baselineKey) ||
      !state.threads.some(
        (thread) => thread.id === baseline.promotedByThreadId,
      ) ||
      baseline.supersedesBaselineId !== latestRotationApprovalPolicyBaseline?.id
    ) {
      throw new Error(
        `Persisted receipt trust rotation approval policy baseline is invalid: ${baseline.id}`,
      );
    }
    rotationApprovalPolicyBaselineIds.add(baseline.id);
    rotationApprovalPolicyBaselineKeys.add(baselineKey);
    rotationApprovalPolicyBaselinesBySha256.set(
      baseline.contentSha256,
      baseline,
    );
    latestRotationApprovalPolicyBaseline = baseline;
    Object.assign(input, baseline);
  }
  for (const subscription of state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptions) {
    const pending = subscription.pendingApprovalPolicyApply;
    if (!pending) continue;
    const baseline = rotationApprovalPolicyBaselinesBySha256.get(
      pending.approvalPolicyBaselineSha256,
    );
    if (
      !baseline ||
      baseline.approvalPolicySha256 !== pending.approvalPolicySha256
    ) {
      throw new Error(
        `Persisted receipt trust rotation approval policy apply baseline reference is invalid: ${subscription.id}`,
      );
    }
  }
}

function validateActivationDecisions(state: PersistedStoreState): void {
  if (
    state.receiptTrustAnchorDirectoryQuorumActivationDecisions.length >
    MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS
  ) {
    throw new Error(
      "Persisted receipt trust anchor directory quorum activation decision limit is exceeded",
    );
  }
  const trustDirectoryQuorumActivationDecisionIds = new Set<string>();
  const trustDirectoryQuorumActivationDecisionEnvelopeHashes =
    new Set<string>();
  for (const input of state.receiptTrustAnchorDirectoryQuorumActivationDecisions) {
    const record =
      validateReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord(input);
    if (
      trustDirectoryQuorumActivationDecisionIds.has(record.id) ||
      trustDirectoryQuorumActivationDecisionEnvelopeHashes.has(
        record.envelope.contentSha256,
      ) ||
      !state.threads.some((thread) => thread.id === record.signedByThreadId) ||
      !state.receiptTrustAnchorDirectoryQuorumPromotionBaselines.some(
        (baseline) => baseline.contentSha256 === record.baseline.contentSha256,
      )
    ) {
      throw new Error(
        `Persisted receipt trust anchor directory quorum activation decision is invalid: ${record.id}`,
      );
    }
    trustDirectoryQuorumActivationDecisionIds.add(record.id);
    trustDirectoryQuorumActivationDecisionEnvelopeHashes.add(
      record.envelope.contentSha256,
    );
    Object.assign(input, record);
  }
}

function validateActivationSelections(state: PersistedStoreState): void {
  if (
    state.receiptTrustAnchorDirectoryQuorumActivationSelections.length >
    MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS
  ) {
    throw new Error(
      "Persisted receipt trust anchor directory quorum activation selection limit is exceeded",
    );
  }
  const trustDirectoryQuorumActivationSelectionIds = new Set<string>();
  const trustDirectoryQuorumActivationSelectionHashes = new Set<string>();
  let latestTrustDirectoryQuorumActivationSelection:
    | ReceiptTrustAnchorDirectoryQuorumActivationSelection
    | undefined;
  for (const input of state.receiptTrustAnchorDirectoryQuorumActivationSelections) {
    const selection =
      validateReceiptTrustAnchorDirectoryQuorumActivationSelection(input);
    const record =
      state.receiptTrustAnchorDirectoryQuorumActivationDecisions.find(
        (candidate) => candidate.id === selection.activationDecisionRecordId,
      );
    if (
      trustDirectoryQuorumActivationSelectionIds.has(selection.id) ||
      trustDirectoryQuorumActivationSelectionHashes.has(
        selection.contentSha256,
      ) ||
      !record ||
      record.contentSha256 !== selection.activationDecisionRecordSha256 ||
      record.envelope.contentSha256 !==
        selection.activationDecisionEnvelopeSha256 ||
      record.envelope.receipt.contentSha256 !==
        selection.activationDecisionReceiptSha256 ||
      !state.threads.some(
        (thread) => thread.id === selection.activatedByThreadId,
      ) ||
      (latestTrustDirectoryQuorumActivationSelection !== undefined &&
        selection.previousSelectionSha256 !==
          latestTrustDirectoryQuorumActivationSelection.contentSha256)
    ) {
      throw new Error(
        `Persisted receipt trust anchor directory quorum activation selection history is invalid: ${selection.id}`,
      );
    }
    trustDirectoryQuorumActivationSelectionIds.add(selection.id);
    trustDirectoryQuorumActivationSelectionHashes.add(selection.contentSha256);
    latestTrustDirectoryQuorumActivationSelection = selection;
    Object.assign(input, selection);
  }
  if (state.receiptTrustAnchorDirectoryQuorumActivationSelection) {
    const selection =
      validateReceiptTrustAnchorDirectoryQuorumActivationSelection(
        state.receiptTrustAnchorDirectoryQuorumActivationSelection,
      );
    const record =
      state.receiptTrustAnchorDirectoryQuorumActivationDecisions.find(
        (candidate) => candidate.id === selection.activationDecisionRecordId,
      );
    if (
      !record ||
      record.contentSha256 !== selection.activationDecisionRecordSha256 ||
      record.envelope.contentSha256 !==
        selection.activationDecisionEnvelopeSha256 ||
      record.envelope.receipt.contentSha256 !==
        selection.activationDecisionReceiptSha256 ||
      !state.threads.some(
        (thread) => thread.id === selection.activatedByThreadId,
      )
    ) {
      throw new Error(
        `Persisted receipt trust anchor directory quorum activation selection is invalid: ${selection.id}`,
      );
    }
    Object.assign(
      state.receiptTrustAnchorDirectoryQuorumActivationSelection,
      selection,
    );
  }
  if (
    latestTrustDirectoryQuorumActivationSelection &&
    state.receiptTrustAnchorDirectoryQuorumActivationSelection
      ?.contentSha256 !==
      latestTrustDirectoryQuorumActivationSelection.contentSha256
  ) {
    throw new Error(
      "Persisted receipt trust anchor directory quorum activation selection history tail is invalid",
    );
  }
  if (
    !latestTrustDirectoryQuorumActivationSelection &&
    state.receiptTrustAnchorDirectoryQuorumActivationSelection
  ) {
    throw new Error(
      "Persisted receipt trust anchor directory quorum activation selection history is missing",
    );
  }
}
