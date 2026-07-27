import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  Check,
  Download,
  KeyRound,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";

import type {
  CreateReceiptTrustAnchorSource,
  ReceiptTrustAnchor,
  ReceiptTrustAnchorDirectory,
  ReceiptTrustAnchorDirectoryDiscovery,
  ReceiptTrustAnchorDirectoryMetadataVerification,
  ReceiptTrustAnchorDirectoryQuorum,
  ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification,
  ReceiptTrustAnchorDirectorySubscription,
  ReceiptTrustAnchorDirectoryVerification,
  ReceiptTrustAnchorDirectoryVerificationPolicy,
  ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult,
  SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
  TrustedReceiptEnvelope,
  TrustedReceiptVerification,
} from "@napier/contracts";

import { copy } from "./copy";
import {
  applyReceiptTrustAnchorDirectoryQuorumActivationSelection,
  createReceiptTrustAnchor,
  createReceiptTrustAnchorDirectorySubscription,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  discoverReceiptTrustAnchorDirectory,
  discoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  evaluateReceiptTrustAnchorDirectoryQuorum,
  evaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
  getSignedReceiptTrustAnchorDirectoryMetadata,
  getReceiptTrustAnchorDirectory,
  getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
  getReceiptTrustAnchorDirectoryQuorumActivationSelectionState,
  getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  importReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  listReceiptTrustAnchorDirectoryQuorumPromotionBaselines,
  listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions,
  listReceiptTrustAnchorDirectorySubscriptions,
  refreshReceiptTrustAnchorDirectorySubscription,
  refreshReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  revokeReceiptTrustAnchor,
  reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation,
  signReceiptTrustAnchorDirectoryQuorumActivationDecision,
  signReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  updateReceiptTrustAnchorDirectorySubscription,
  updateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  verifyReceiptTrustAnchorDirectory,
  verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  verifyReceiptTrustAnchorDirectoryMetadata,
  verifyTrustedReceipt,
} from "./receipt-trust-api";
import { formatApiErrorMessage } from "./api-error";
import {
  qualifyReceiptTrustAnchorDirectoryDiscoveryRequest,
  qualifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryRequest,
  qualifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest,
  qualifyReceiptTrustAnchorDirectorySubscriptionRequest,
  buildReceiptTrustDirectoryBaselineImportPolicy,
  projectReceiptTrustDirectoryBaselineActivation,
} from "./receipt-trust-view-model";

const MAX_TRUSTED_RECEIPT_FILE_BYTES = 10 * 1024 * 1024 + 64 * 1024;
const MAX_RECEIPT_TRUST_DIRECTORY_FILE_BYTES = 2 * 1024 * 1024;

export default function ReceiptTrustPanel({
  threadId,
  anchors,
  selectedAnchorId,
  onSelect,
  onAnchors,
}: {
  threadId: string;
  anchors: ReceiptTrustAnchor[];
  selectedAnchorId: string;
  onSelect: (anchorId: string) => void;
  onAnchors: (anchors: ReceiptTrustAnchor[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [sourceType, setSourceType] =
    useState<CreateReceiptTrustAnchorSource["type"]>("environment");
  const [environmentVariable, setEnvironmentVariable] = useState("");
  const [publicKeySpki, setPublicKeySpki] = useState("");
  const [busyId, setBusyId] = useState<string>();
  const [pendingRevokeId, setPendingRevokeId] = useState<string>();
  const [verification, setVerification] =
    useState<TrustedReceiptVerification>();
  const [directoryVerification, setDirectoryVerification] =
    useState<ReceiptTrustAnchorDirectoryVerification>();
  const [directoryDiscovery, setDirectoryDiscovery] =
    useState<ReceiptTrustAnchorDirectoryDiscovery>();
  const [directoryMetadataVerification, setDirectoryMetadataVerification] =
    useState<ReceiptTrustAnchorDirectoryMetadataVerification>();
  const [directorySourceUrl, setDirectorySourceUrl] = useState("");
  const [directorySubscriptionLabel, setDirectorySubscriptionLabel] =
    useState("");
  const [directorySubscriptions, setDirectorySubscriptions] = useState<
    ReceiptTrustAnchorDirectorySubscription[]
  >([]);
  const [directoryQuorum, setDirectoryQuorum] =
    useState<ReceiptTrustAnchorDirectoryQuorum>();
  const [promotionBaselines, setPromotionBaselines] = useState<
    ReceiptTrustAnchorDirectoryQuorumPromotionBaseline[]
  >([]);
  const [baselineVerification, setBaselineVerification] =
    useState<ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification>();
  const [baselineImportResult, setBaselineImportResult] =
    useState<ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult>();
  const [baselineActivationDecision, setBaselineActivationDecision] =
    useState<SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult>();
  const [baselineActivationHistory, setBaselineActivationHistory] =
    useState<ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory>();
  const [
    baselineActivationHistoryVerification,
    setBaselineActivationHistoryVerification,
  ] =
    useState<ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification>();
  const [
    baselineActivationSelectionState,
    setBaselineActivationSelectionState,
  ] = useState<ReceiptTrustAnchorDirectoryQuorumActivationSelectionState>();
  const [
    baselineActivationSelectionDriftAudit,
    setBaselineActivationSelectionDriftAudit,
  ] = useState<ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit>();
  const [
    baselineActivationRotationReview,
    setBaselineActivationRotationReview,
  ] = useState<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview>();
  const [
    baselineActivationSelectionCheckpoint,
    setBaselineActivationSelectionCheckpoint,
  ] =
    useState<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint>();
  const [
    baselineActivationSelectionCheckpointVerification,
    setBaselineActivationSelectionCheckpointVerification,
  ] =
    useState<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification>();
  const [
    baselineActivationSelectionCheckpointEnvelope,
    setBaselineActivationSelectionCheckpointEnvelope,
  ] =
    useState<
      TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint>
    >();
  const [
    baselineActivationSelectionCheckpointDiscovery,
    setBaselineActivationSelectionCheckpointDiscovery,
  ] =
    useState<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery>();
  const [
    checkpointRegistryQuorum,
    setCheckpointRegistryQuorum,
  ] =
    useState<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum>();
  const [
    checkpointSubscriptions,
    setCheckpointSubscriptions,
  ] = useState<
    ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription[]
  >([]);
  const [expectedAnchorSetSha256, setExpectedAnchorSetSha256] = useState("");
  const [checkpointSourceUrl, setCheckpointSourceUrl] = useState("");
  const [checkpointSubscriptionLabel, setCheckpointSubscriptionLabel] =
    useState("");
  const [expectedCheckpointSha256, setExpectedCheckpointSha256] = useState("");
  const [externalDirectory, setExternalDirectory] =
    useState<ReceiptTrustAnchorDirectory>();
  const [externalDirectoryPolicy, setExternalDirectoryPolicy] =
    useState<ReceiptTrustAnchorDirectoryVerificationPolicy>();
  const [externalDirectorySubscriptionId, setExternalDirectorySubscriptionId] =
    useState<string>();
  const [error, setError] = useState<string>();
  const canCreate =
    Boolean(label.trim()) &&
    (sourceType === "environment"
      ? /^[A-Z_][A-Z0-9_]{1,127}$/.test(environmentVariable.trim())
      : Boolean(publicKeySpki.trim())) &&
    !busyId;
  const discoveryRequest = qualifyReceiptTrustAnchorDirectoryDiscoveryRequest(
    directorySourceUrl,
    expectedAnchorSetSha256,
  );
  const subscriptionRequest =
    qualifyReceiptTrustAnchorDirectorySubscriptionRequest(
      threadId,
      directorySubscriptionLabel,
      directorySourceUrl,
      expectedAnchorSetSha256,
    );
  const canDiscover = Boolean(discoveryRequest) && !busyId;
  const canSubscribe = Boolean(subscriptionRequest) && !busyId;
  const canSignDirectoryMetadata =
    Boolean(selectedAnchorId) &&
    anchors.some(
      (anchor) =>
        anchor.id === selectedAnchorId &&
        anchor.status === "trusted" &&
        Boolean(anchor.signingSource),
    ) &&
    !busyId;
  const baselineActivation = useMemo(
    () =>
      projectReceiptTrustDirectoryBaselineActivation(
        promotionBaselines,
        directorySubscriptions,
      ),
    [promotionBaselines, directorySubscriptions],
  );
  const latestBaseline = baselineActivation.latestBaseline;
  const canSignActivationDecision =
    Boolean(latestBaseline) &&
    Boolean(selectedAnchorId) &&
    anchors.some(
      (anchor) =>
        anchor.id === selectedAnchorId &&
        anchor.status === "trusted" &&
        Boolean(anchor.signingSource),
    ) &&
    !busyId;
  const latestApprovedActivationRecord = useMemo(
    () =>
      baselineActivationHistory?.records
        .filter((record) => record.envelope.receipt.decision === "approved")
        .at(-1),
    [baselineActivationHistory],
  );
  const canApplyActivationSelection =
    Boolean(latestApprovedActivationRecord) && !busyId;
  const canReviewActivationSelectionRotation =
    Boolean(latestApprovedActivationRecord) && !busyId;
  const selectedTrustedAnchorKeyId = anchors.find(
    (anchor) => anchor.id === selectedAnchorId && anchor.status === "trusted",
  )?.keyId;
  const canSignActivationSelectionCheckpoint =
    Boolean(selectedAnchorId) &&
    anchors.some(
      (anchor) =>
        anchor.id === selectedAnchorId &&
        anchor.status === "trusted" &&
        Boolean(anchor.signingSource),
    ) &&
    !busyId;
  const checkpointDiscoveryRequest =
    qualifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryRequest(
      checkpointSourceUrl,
      expectedCheckpointSha256,
      baselineActivationSelectionCheckpoint,
      selectedTrustedAnchorKeyId,
      externalDirectory,
      externalDirectoryPolicy,
    );
  const canDiscoverActivationSelectionCheckpoint =
    Boolean(checkpointDiscoveryRequest) && !busyId;
  const checkpointSubscriptionRequest =
    qualifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest(
      threadId,
      checkpointSubscriptionLabel,
      checkpointSourceUrl,
      expectedCheckpointSha256,
      baselineActivationSelectionCheckpoint,
      selectedTrustedAnchorKeyId,
    );
  const canSubscribeActivationSelectionCheckpoint =
    Boolean(checkpointSubscriptionRequest) && !busyId;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listReceiptTrustAnchorDirectorySubscriptions(),
      listReceiptTrustAnchorDirectoryQuorumPromotionBaselines(),
      getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory(),
      getReceiptTrustAnchorDirectoryQuorumActivationSelectionState(),
      getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(),
      getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(),
      listReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptions(),
    ])
      .then(
        ([
          subscriptions,
          baselines,
          activationHistory,
          activationSelectionState,
          activationSelectionDriftAudit,
          activationSelectionCheckpoint,
          activationSelectionCheckpointSubscriptions,
        ]) => {
          if (cancelled) return;
          setDirectorySubscriptions(subscriptions);
          setPromotionBaselines(baselines);
          setBaselineActivationHistory(activationHistory);
          setBaselineActivationSelectionState(activationSelectionState);
          setBaselineActivationSelectionDriftAudit(
            activationSelectionDriftAudit,
          );
          setBaselineActivationSelectionCheckpoint(
            activationSelectionCheckpoint,
          );
          setCheckpointSubscriptions(activationSelectionCheckpointSubscriptions);
          const active = subscriptions
            .filter(
              (subscription) =>
                subscription.status === "active" &&
                Boolean(subscription.lastGoodDiscovery?.directory),
            )
            .sort((left, right) =>
              right.updatedAt.localeCompare(left.updatedAt),
            )
            .at(0);
          if (active) activateSubscription(active);
        },
      )
      .catch((loadError) => {
        if (!cancelled) setError(toErrorMessage(loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  async function createAnchor(): Promise<void> {
    if (!canCreate) return;
    setBusyId("create");
    setError(undefined);
    try {
      const anchor = await createReceiptTrustAnchor({
        threadId,
        label,
        source:
          sourceType === "environment"
            ? {
                type: "environment",
                variable: environmentVariable.trim(),
              }
            : { type: "public_key", publicKeySpki: publicKeySpki.trim() },
      });
      const next = [...anchors, anchor].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
      );
      onAnchors(next);
      if (anchor.signingSource) onSelect(anchor.id);
      setLabel("");
      setEnvironmentVariable("");
      setPublicKeySpki("");
    } catch (createError) {
      setError(toErrorMessage(createError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function revokeAnchor(anchorId: string): Promise<void> {
    setBusyId(`revoke:${anchorId}`);
    setError(undefined);
    try {
      const updated = await revokeReceiptTrustAnchor(anchorId, threadId);
      const next = anchors.map((anchor) =>
        anchor.id === updated.id ? updated : anchor,
      );
      onAnchors(next);
      if (selectedAnchorId === updated.id) {
        onSelect(
          next.find(
            (anchor) =>
              anchor.status === "trusted" && Boolean(anchor.signingSource),
          )?.id ?? "",
        );
      }
      setPendingRevokeId(undefined);
    } catch (revokeError) {
      setError(toErrorMessage(revokeError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function verifyFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusyId("verify");
    setError(undefined);
    setVerification(undefined);
    try {
      if (file.size > MAX_TRUSTED_RECEIPT_FILE_BYTES) {
        throw new Error(copy.lab.trust.errors.tooLarge);
      }
      const envelope = JSON.parse(await file.text()) as unknown;
      setVerification(
        await verifyTrustedReceipt(
          envelope,
          externalDirectory,
          externalDirectoryPolicy,
        ),
      );
    } catch (verifyError) {
      setError(toErrorMessage(verifyError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function exportDirectory(): Promise<void> {
    setBusyId("directory");
    setError(undefined);
    try {
      const directory = await getReceiptTrustAnchorDirectory();
      downloadJson(
        directory,
        `napier-receipt-trust-anchor-directory-${directory.anchorSetSha256.slice(0, 12)}.json`,
      );
    } catch (directoryError) {
      setError(toErrorMessage(directoryError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function signDirectoryMetadata(): Promise<void> {
    if (!canSignDirectoryMetadata) return;
    setBusyId("sign-directory-metadata");
    setError(undefined);
    try {
      const envelope = await getSignedReceiptTrustAnchorDirectoryMetadata({
        threadId,
        trustAnchorId: selectedAnchorId,
        publisher: copy.lab.trust.directoryMetadataPublisher,
      });
      downloadJson(
        envelope,
        `napier-signed-anchor-directory-metadata-${envelope.contentSha256.slice(0, 12)}.json`,
      );
    } catch (signError) {
      setError(toErrorMessage(signError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function verifyDirectoryFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusyId("verify-directory");
    setError(undefined);
    setDirectoryVerification(undefined);
    setDirectoryMetadataVerification(undefined);
    try {
      if (file.size > MAX_RECEIPT_TRUST_DIRECTORY_FILE_BYTES) {
        throw new Error(copy.lab.trust.errors.directoryTooLarge);
      }
      const directory = JSON.parse(await file.text()) as unknown;
      const nextVerification = await verifyReceiptTrustAnchorDirectory({
        directory,
      });
      setDirectoryDiscovery(undefined);
      setDirectoryVerification(nextVerification);
      setExternalDirectory(
        nextVerification.status === "valid"
          ? (directory as ReceiptTrustAnchorDirectory)
          : undefined,
      );
      setExternalDirectoryPolicy(undefined);
      setExternalDirectorySubscriptionId(undefined);
    } catch (verifyError) {
      setError(toErrorMessage(verifyError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function verifyDirectoryMetadataFile(
    file: File | undefined,
  ): Promise<void> {
    if (!file) return;
    setBusyId("verify-directory-metadata");
    setError(undefined);
    setDirectoryMetadataVerification(undefined);
    try {
      if (file.size > MAX_TRUSTED_RECEIPT_FILE_BYTES) {
        throw new Error(copy.lab.trust.errors.tooLarge);
      }
      const envelope = JSON.parse(await file.text()) as unknown;
      const directory =
        externalDirectory ?? (await getReceiptTrustAnchorDirectory());
      const verification = await verifyReceiptTrustAnchorDirectoryMetadata({
        envelope,
        directory,
        ...(externalDirectoryPolicy
          ? { directoryPolicy: externalDirectoryPolicy }
          : {}),
        ...(externalDirectory
          ? {
              trustDirectory: externalDirectory,
              ...(externalDirectoryPolicy
                ? { trustDirectoryPolicy: externalDirectoryPolicy }
                : {}),
            }
          : {}),
      });
      setDirectoryMetadataVerification(verification);
    } catch (verifyError) {
      setError(toErrorMessage(verifyError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function discoverDirectory(): Promise<void> {
    if (!discoveryRequest || !canDiscover) return;
    setBusyId("discover-directory");
    setError(undefined);
    setDirectoryDiscovery(undefined);
    setDirectoryVerification(undefined);
    setDirectoryMetadataVerification(undefined);
    try {
      const discovery =
        await discoverReceiptTrustAnchorDirectory(discoveryRequest);
      setDirectoryDiscovery(discovery);
      setDirectoryVerification(discovery.verification);
      const acceptedDirectory =
        discovery.status === "valid" ? discovery.directory : undefined;
      setExternalDirectory(acceptedDirectory);
      setExternalDirectoryPolicy(
        acceptedDirectory ? discoveryRequest.policy : undefined,
      );
      setExternalDirectorySubscriptionId(undefined);
    } catch (discoveryError) {
      setExternalDirectory(undefined);
      setExternalDirectoryPolicy(undefined);
      setError(toErrorMessage(discoveryError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function createDirectorySubscription(): Promise<void> {
    if (!subscriptionRequest || !canSubscribe) return;
    setBusyId("subscribe-directory");
    setError(undefined);
    try {
      const subscription =
        await createReceiptTrustAnchorDirectorySubscription(
          subscriptionRequest,
        );
      upsertDirectorySubscription(subscription);
      setDirectoryQuorum(undefined);
      clearBaselineActivationEvidence();
      setDirectorySubscriptionLabel("");
      activateSubscription(subscription);
    } catch (subscriptionError) {
      setError(toErrorMessage(subscriptionError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function refreshDirectorySubscription(
    subscription: ReceiptTrustAnchorDirectorySubscription,
  ): Promise<void> {
    setBusyId(`refresh-subscription:${subscription.id}`);
    setError(undefined);
    try {
      const result = await refreshReceiptTrustAnchorDirectorySubscription(
        subscription.id,
        subscription.auditThreadId,
        subscription.revision,
      );
      upsertDirectorySubscription(result.subscription);
      setDirectoryQuorum(undefined);
      clearBaselineActivationEvidence();
      if (result.discovery) {
        setDirectoryDiscovery(result.discovery);
        setDirectoryVerification(result.discovery.verification);
      }
      if (
        result.subscription.status === "active" &&
        result.subscription.lastGoodDiscovery?.directory
      ) {
        activateSubscription(result.subscription);
      }
    } catch (refreshError) {
      setError(toErrorMessage(refreshError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function toggleDirectorySubscription(
    subscription: ReceiptTrustAnchorDirectorySubscription,
  ): Promise<void> {
    setBusyId(`toggle-subscription:${subscription.id}`);
    setError(undefined);
    try {
      const updated = await updateReceiptTrustAnchorDirectorySubscription(
        subscription.id,
        {
          threadId: subscription.auditThreadId,
          expectedRevision: subscription.revision,
          status: subscription.status === "active" ? "paused" : "active",
        },
      );
      upsertDirectorySubscription(updated);
      setDirectoryQuorum(undefined);
      clearBaselineActivationEvidence();
      if (updated.status === "active" && updated.lastGoodDiscovery?.directory) {
        activateSubscription(updated);
      } else if (externalDirectorySubscriptionId === updated.id) {
        clearExternalDirectory();
      }
    } catch (updateError) {
      setError(toErrorMessage(updateError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function createCheckpointSubscription(): Promise<void> {
    if (!checkpointSubscriptionRequest || !canSubscribeActivationSelectionCheckpoint)
      return;
    setBusyId("subscribe-activation-selection-checkpoint");
    setError(undefined);
    try {
      const subscription =
        await createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
          checkpointSubscriptionRequest,
        );
      upsertCheckpointSubscription(subscription);
      setCheckpointRegistryQuorum(undefined);
      setBaselineActivationSelectionCheckpointDiscovery(
        subscription.lastGoodDiscovery,
      );
      if (subscription.lastGoodDiscovery?.envelope) {
        setBaselineActivationSelectionCheckpointEnvelope(
          subscription.lastGoodDiscovery.envelope,
        );
        setBaselineActivationSelectionCheckpoint(
          subscription.lastGoodDiscovery.envelope.receipt,
        );
      }
      setCheckpointSubscriptionLabel("");
    } catch (subscriptionError) {
      setError(toErrorMessage(subscriptionError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function refreshCheckpointSubscription(
    subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  ): Promise<void> {
    setBusyId(`refresh-checkpoint-subscription:${subscription.id}`);
    setError(undefined);
    try {
      const result =
        await refreshReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
          subscription.id,
          subscription.auditThreadId,
          subscription.revision,
        );
      upsertCheckpointSubscription(result.subscription);
      setCheckpointRegistryQuorum(undefined);
      if (result.discovery) {
        setBaselineActivationSelectionCheckpointDiscovery(result.discovery);
        setBaselineActivationSelectionCheckpointVerification(
          result.discovery.checkpointVerification,
        );
        if (result.discovery.envelope) {
          setBaselineActivationSelectionCheckpointEnvelope(
            result.discovery.envelope,
          );
          if (result.discovery.status === "valid") {
            setBaselineActivationSelectionCheckpoint(
              result.discovery.envelope.receipt,
            );
          }
        }
      }
    } catch (refreshError) {
      setError(toErrorMessage(refreshError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function toggleCheckpointSubscription(
    subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  ): Promise<void> {
    setBusyId(`toggle-checkpoint-subscription:${subscription.id}`);
    setError(undefined);
    try {
      const updated =
        await updateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
          subscription.id,
          {
            threadId: subscription.auditThreadId,
            expectedRevision: subscription.revision,
            status: subscription.status === "active" ? "paused" : "active",
          },
        );
      upsertCheckpointSubscription(updated);
      setCheckpointRegistryQuorum(undefined);
    } catch (updateError) {
      setError(toErrorMessage(updateError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function evaluateCheckpointRegistryQuorum(): Promise<void> {
    setBusyId("evaluate-checkpoint-registry-quorum");
    setError(undefined);
    try {
      setCheckpointRegistryQuorum(
        await evaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum(),
      );
    } catch (quorumError) {
      setError(toErrorMessage(quorumError));
    } finally {
      setBusyId(undefined);
    }
  }

  function activateSubscription(
    subscription: ReceiptTrustAnchorDirectorySubscription,
  ): void {
    const discovery = subscription.lastGoodDiscovery;
    if (!discovery?.directory) return;
    setExternalDirectory(discovery.directory);
    setExternalDirectoryPolicy(subscription.policy);
    setExternalDirectorySubscriptionId(subscription.id);
    setDirectoryDiscovery(discovery);
    setDirectoryVerification(discovery.verification);
  }

  async function evaluateDirectoryQuorum(): Promise<void> {
    setBusyId("directory-quorum");
    setError(undefined);
    try {
      setDirectoryQuorum(await evaluateReceiptTrustAnchorDirectoryQuorum());
    } catch (quorumError) {
      setError(toErrorMessage(quorumError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function verifyLatestBaseline(): Promise<void> {
    if (!latestBaseline) return;
    setBusyId("verify-quorum-baseline");
    setError(undefined);
    setBaselineVerification(undefined);
    try {
      const verification =
        await verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline({
          baseline: latestBaseline,
          ...(externalDirectory
            ? {
                trustDirectory: externalDirectory,
                ...(externalDirectoryPolicy
                  ? { trustDirectoryPolicy: externalDirectoryPolicy }
                  : {}),
              }
            : {}),
        });
      setBaselineVerification(verification);
    } catch (verifyError) {
      setError(toErrorMessage(verifyError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function importQuorumBaselineFile(
    file: File | undefined,
  ): Promise<void> {
    if (!file) return;
    setBusyId("import-quorum-baseline");
    setError(undefined);
    setBaselineImportResult(undefined);
    setBaselineVerification(undefined);
    try {
      if (file.size > MAX_TRUSTED_RECEIPT_FILE_BYTES) {
        throw new Error(copy.lab.trust.errors.tooLarge);
      }
      const baseline = JSON.parse(
        await file.text(),
      ) as ReceiptTrustAnchorDirectoryQuorumPromotionBaseline;
      const result =
        await importReceiptTrustAnchorDirectoryQuorumPromotionBaseline({
          baseline,
          threadId,
          expectedCurrentBaselineSha256: latestBaseline?.contentSha256 ?? "",
          importPolicy: buildReceiptTrustDirectoryBaselineImportPolicy(
            baseline,
            directorySubscriptions,
            externalDirectory,
          ),
          ...(externalDirectory
            ? {
                trustDirectory: externalDirectory,
                ...(externalDirectoryPolicy
                  ? { trustDirectoryPolicy: externalDirectoryPolicy }
                  : {}),
              }
            : {}),
        });
      setBaselineImportResult(result);
      setBaselineActivationDecision(undefined);
      setBaselineVerification(result.verification);
      upsertPromotionBaseline(result.baseline);
    } catch (importError) {
      setError(toErrorMessage(importError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function signBaselineActivationDecision(): Promise<void> {
    if (!latestBaseline || !canSignActivationDecision) return;
    setBusyId("sign-quorum-baseline-activation");
    setError(undefined);
    setBaselineActivationDecision(undefined);
    setBaselineActivationHistoryVerification(undefined);
    try {
      const result =
        await signReceiptTrustAnchorDirectoryQuorumActivationDecision({
          threadId,
          trustAnchorId: selectedAnchorId,
          baselineId: latestBaseline.id,
          importPolicy: buildReceiptTrustDirectoryBaselineImportPolicy(
            latestBaseline,
            directorySubscriptions,
            externalDirectory,
          ),
          ...(externalDirectory
            ? {
                trustDirectory: externalDirectory,
                ...(externalDirectoryPolicy
                  ? { trustDirectoryPolicy: externalDirectoryPolicy }
                  : {}),
              }
            : {}),
        });
      setBaselineActivationDecision(result);
      setBaselineVerification(result.verification);
      downloadJson(
        result.envelope,
        `napier-quorum-baseline-activation-${result.envelope.receipt.contentSha256.slice(0, 12)}.json`,
      );
      try {
        await refreshBaselineActivationHistory();
      } catch (historyError) {
        setError(toErrorMessage(historyError));
      }
    } catch (signError) {
      setError(toErrorMessage(signError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function refreshBaselineActivationHistory(): Promise<ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory> {
    const history =
      await getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory();
    setBaselineActivationHistory(history);
    return history;
  }

  async function refreshActivationSelectionDriftAudit(): Promise<void> {
    setBusyId("refresh-activation-selection-drift");
    setError(undefined);
    try {
      setBaselineActivationSelectionDriftAudit(
        await getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(),
      );
    } catch (auditError) {
      setError(toErrorMessage(auditError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function reviewActivationSelectionRotation(): Promise<void> {
    if (
      !latestApprovedActivationRecord ||
      !canReviewActivationSelectionRotation
    ) {
      return;
    }
    setBusyId("review-activation-selection-rotation");
    setError(undefined);
    setBaselineActivationRotationReview(undefined);
    try {
      const review =
        await reviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotation(
          {
            activationDecisionRecordId: latestApprovedActivationRecord.id,
            expectedCurrentSelectionSha256:
              baselineActivationSelectionState?.currentSelectionSha256 ?? "",
          },
        );
      setBaselineActivationRotationReview(review);
      setBaselineActivationSelectionDriftAudit(review.driftAudit);
    } catch (reviewError) {
      setError(toErrorMessage(reviewError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function exportActivationSelectionTransparencyCheckpoint(): Promise<void> {
    setBusyId("export-activation-selection-checkpoint");
    setError(undefined);
    try {
      const checkpoint =
        await getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint();
      setBaselineActivationSelectionCheckpoint(checkpoint);
      downloadJson(
        checkpoint,
        `napier-quorum-activation-selection-checkpoint-${checkpoint.contentSha256.slice(0, 12)}.json`,
      );
    } catch (checkpointError) {
      setError(toErrorMessage(checkpointError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function verifyActivationSelectionTransparencyCheckpointFile(
    file: File | undefined,
  ): Promise<void> {
    if (!file) return;
    setBusyId("verify-activation-selection-checkpoint");
    setError(undefined);
    setBaselineActivationSelectionCheckpointVerification(undefined);
    try {
      if (file.size > MAX_TRUSTED_RECEIPT_FILE_BYTES) {
        throw new Error(copy.lab.trust.errors.tooLarge);
      }
      const checkpoint = JSON.parse(await file.text()) as unknown;
      const verification =
        await verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
          { checkpoint },
        );
      setBaselineActivationSelectionCheckpointVerification(verification);
    } catch (checkpointError) {
      setError(toErrorMessage(checkpointError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function signActivationSelectionTransparencyCheckpoint(): Promise<void> {
    if (!canSignActivationSelectionCheckpoint) return;
    setBusyId("sign-activation-selection-checkpoint");
    setError(undefined);
    setBaselineActivationSelectionCheckpointEnvelope(undefined);
    try {
      const envelope =
        await signReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
          {
            threadId,
            trustAnchorId: selectedAnchorId,
          },
        );
      setBaselineActivationSelectionCheckpoint(
        envelope.receipt as ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
      );
      setBaselineActivationSelectionCheckpointEnvelope(envelope);
      downloadJson(
        envelope,
        `napier-signed-quorum-activation-selection-checkpoint-${envelope.contentSha256.slice(0, 12)}.json`,
      );
    } catch (checkpointError) {
      setError(toErrorMessage(checkpointError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function discoverActivationSelectionTransparencyCheckpoint(): Promise<void> {
    if (!checkpointDiscoveryRequest || !canDiscoverActivationSelectionCheckpoint)
      return;
    setBusyId("discover-activation-selection-checkpoint");
    setError(undefined);
    setBaselineActivationSelectionCheckpointDiscovery(undefined);
    try {
      const discovery =
        await discoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
          checkpointDiscoveryRequest,
        );
      setBaselineActivationSelectionCheckpointDiscovery(discovery);
      setBaselineActivationSelectionCheckpointVerification(
        discovery.checkpointVerification,
      );
      if (discovery.envelope) {
        setBaselineActivationSelectionCheckpointEnvelope(discovery.envelope);
      }
      if (discovery.status === "valid" && discovery.envelope?.receipt) {
        setBaselineActivationSelectionCheckpoint(discovery.envelope.receipt);
      }
    } catch (checkpointError) {
      setError(toErrorMessage(checkpointError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function applyBaselineActivationSelection(): Promise<void> {
    if (!latestApprovedActivationRecord || !canApplyActivationSelection) {
      return;
    }
    setBusyId("apply-baseline-activation-selection");
    setError(undefined);
    try {
      const result =
        await applyReceiptTrustAnchorDirectoryQuorumActivationSelection({
          threadId,
          activationDecisionRecordId: latestApprovedActivationRecord.id,
          expectedCurrentSelectionSha256:
            baselineActivationSelectionState?.currentSelectionSha256 ?? "",
        });
      setBaselineActivationSelectionState(result.selectionState);
      setBaselineActivationRotationReview(undefined);
      try {
        const [driftAudit, checkpoint] = await Promise.all([
          getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(),
          getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(),
        ]);
        setBaselineActivationSelectionDriftAudit(driftAudit);
        setBaselineActivationSelectionCheckpoint(checkpoint);
      } catch (auditError) {
        setError(toErrorMessage(auditError));
      }
    } catch (applyError) {
      setError(toErrorMessage(applyError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function exportBaselineActivationHistory(): Promise<void> {
    setBusyId("export-baseline-activation-history");
    setError(undefined);
    try {
      const history = await refreshBaselineActivationHistory();
      downloadJson(
        history,
        `napier-quorum-baseline-activation-history-${history.contentSha256.slice(0, 12)}.json`,
      );
    } catch (historyError) {
      setError(toErrorMessage(historyError));
    } finally {
      setBusyId(undefined);
    }
  }

  async function verifyBaselineActivationHistoryFile(
    file: File | undefined,
  ): Promise<void> {
    if (!file) return;
    setBusyId("verify-baseline-activation-history");
    setError(undefined);
    setBaselineActivationHistoryVerification(undefined);
    try {
      if (file.size > MAX_TRUSTED_RECEIPT_FILE_BYTES) {
        throw new Error(copy.lab.trust.errors.tooLarge);
      }
      const history = JSON.parse(await file.text()) as unknown;
      const verification =
        await verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory({
          history,
        });
      setBaselineActivationHistoryVerification(verification);
    } catch (historyError) {
      setError(toErrorMessage(historyError));
    } finally {
      setBusyId(undefined);
    }
  }

  function upsertDirectorySubscription(
    subscription: ReceiptTrustAnchorDirectorySubscription,
  ): void {
    setDirectorySubscriptions((current) =>
      [
        ...current.filter((candidate) => candidate.id !== subscription.id),
        subscription,
      ].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  function upsertCheckpointSubscription(
    subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  ): void {
    setCheckpointSubscriptions((current) =>
      [
        ...current.filter((candidate) => candidate.id !== subscription.id),
        subscription,
      ].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  function upsertPromotionBaseline(
    baseline: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  ): void {
    setPromotionBaselines((current) =>
      [
        ...current.filter((candidate) => candidate.id !== baseline.id),
        baseline,
      ].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    );
  }

  function clearBaselineActivationEvidence(): void {
    setBaselineVerification(undefined);
    setBaselineImportResult(undefined);
    setBaselineActivationDecision(undefined);
    setBaselineActivationHistoryVerification(undefined);
    setBaselineActivationSelectionDriftAudit(undefined);
    setBaselineActivationRotationReview(undefined);
    setBaselineActivationSelectionCheckpoint(undefined);
    setBaselineActivationSelectionCheckpointVerification(undefined);
    setBaselineActivationSelectionCheckpointEnvelope(undefined);
    setBaselineActivationSelectionCheckpointDiscovery(undefined);
  }

  function clearExternalDirectory(): void {
    setExternalDirectory(undefined);
    setExternalDirectoryPolicy(undefined);
    setExternalDirectorySubscriptionId(undefined);
    setDirectoryDiscovery(undefined);
    setDirectoryVerification(undefined);
    setDirectoryMetadataVerification(undefined);
    setVerification(undefined);
  }

  return (
    <section
      className="receipt-trust-panel"
      aria-labelledby="receipt-trust-title"
    >
      <header>
        <div>
          <span>{copy.lab.trust.eyebrow}</span>
          <h4 id="receipt-trust-title">{copy.lab.trust.title}</h4>
        </div>
        <KeyRound size={15} aria-hidden="true" />
      </header>
      <p>{copy.lab.trust.body}</p>

      <div className="receipt-trust-grid">
        <section className="receipt-anchor-register">
          <header>
            <strong>{copy.lab.trust.anchors}</strong>
            <code>{anchors.length.toString().padStart(2, "0")}</code>
          </header>
          {anchors.length ? (
            <ol>
              {anchors.map((anchor) => {
                const signing = Boolean(anchor.signingSource);
                const selected = selectedAnchorId === anchor.id;
                return (
                  <li
                    key={anchor.id}
                    className={`receipt-anchor receipt-anchor-${anchor.status}`}
                  >
                    <label>
                      <input
                        type="radio"
                        name="receipt-signing-anchor"
                        checked={selected}
                        disabled={!signing || anchor.status !== "trusted"}
                        onChange={() => onSelect(anchor.id)}
                      />
                      <span>
                        <strong>{anchor.label}</strong>
                        <small>
                          {signing
                            ? copy.lab.trust.signing
                            : copy.lab.trust.verifyOnly}
                        </small>
                      </span>
                    </label>
                    <code title={anchor.keyId}>
                      {anchor.keyId.slice(0, 16)}
                    </code>
                    <span
                      className={`receipt-anchor-state state-${anchor.status}`}
                    >
                      {copy.lab.trust.statuses[anchor.status]}
                    </span>
                    {anchor.status === "trusted" ? (
                      pendingRevokeId === anchor.id ? (
                        <span className="receipt-anchor-confirm">
                          <button
                            type="button"
                            disabled={Boolean(busyId)}
                            onClick={() => void revokeAnchor(anchor.id)}
                          >
                            <Ban size={10} aria-hidden="true" />
                            {copy.lab.trust.confirmRevoke}
                          </button>
                          <button
                            type="button"
                            aria-label={copy.lab.trust.cancel}
                            disabled={Boolean(busyId)}
                            onClick={() => setPendingRevokeId(undefined)}
                          >
                            <X size={10} aria-hidden="true" />
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={Boolean(busyId)}
                          onClick={() => setPendingRevokeId(anchor.id)}
                        >
                          {copy.lab.trust.revoke}
                        </button>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="receipt-trust-empty">{copy.lab.trust.empty}</p>
          )}
        </section>

        <form
          className="receipt-anchor-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void createAnchor();
          }}
        >
          <strong>{copy.lab.trust.add}</strong>
          <label>
            <span>{copy.lab.trust.label}</span>
            <input
              type="text"
              maxLength={100}
              value={label}
              placeholder={copy.lab.trust.labelPlaceholder}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label>
            <span>{copy.lab.trust.source}</span>
            <select
              value={sourceType}
              onChange={(event) =>
                setSourceType(
                  event.target.value as CreateReceiptTrustAnchorSource["type"],
                )
              }
            >
              <option value="environment">{copy.lab.trust.environment}</option>
              <option value="public_key">{copy.lab.trust.publicKey}</option>
            </select>
          </label>
          {sourceType === "environment" ? (
            <label>
              <span>{copy.lab.trust.environmentVariable}</span>
              <input
                type="text"
                spellCheck="false"
                value={environmentVariable}
                placeholder="NAPIER_RELEASE_SIGNING_KEY"
                onChange={(event) =>
                  setEnvironmentVariable(event.target.value.toUpperCase())
                }
              />
            </label>
          ) : (
            <label>
              <span>{copy.lab.trust.publicKeySpki}</span>
              <textarea
                rows={3}
                maxLength={4096}
                spellCheck="false"
                value={publicKeySpki}
                placeholder={copy.lab.trust.publicKeyPlaceholder}
                onChange={(event) => setPublicKeySpki(event.target.value)}
              />
            </label>
          )}
          <button type="submit" disabled={!canCreate}>
            <Plus size={11} aria-hidden="true" />
            {busyId === "create" ? copy.lab.trust.adding : copy.lab.trust.add}
          </button>
        </form>
      </div>

      <section className="receipt-verifier">
        <div>
          <strong>{copy.lab.trust.verifier}</strong>
          <small>
            {externalDirectory
              ? copy.lab.trust.externalDirectoryActive
              : copy.lab.trust.verifierBody}
          </small>
        </div>
        <form
          className="receipt-directory-discovery"
          onSubmit={(event) => {
            event.preventDefault();
            void discoverDirectory();
          }}
        >
          <label>
            <span>{copy.lab.trust.subscriptionLabel}</span>
            <input
              type="text"
              maxLength={100}
              value={directorySubscriptionLabel}
              placeholder={copy.lab.trust.subscriptionLabelPlaceholder}
              onChange={(event) =>
                setDirectorySubscriptionLabel(event.target.value)
              }
            />
          </label>
          <label>
            <span>{copy.lab.trust.directorySource}</span>
            <input
              type="url"
              maxLength={2048}
              spellCheck="false"
              value={directorySourceUrl}
              placeholder={copy.lab.trust.directorySourcePlaceholder}
              onChange={(event) => setDirectorySourceUrl(event.target.value)}
            />
          </label>
          <label>
            <span>{copy.lab.trust.expectedAnchorSet}</span>
            <input
              type="text"
              maxLength={64}
              spellCheck="false"
              value={expectedAnchorSetSha256}
              placeholder={copy.lab.trust.expectedAnchorSetPlaceholder}
              onChange={(event) =>
                setExpectedAnchorSetSha256(event.target.value)
              }
            />
          </label>
          <span className="receipt-directory-actions">
            <button type="submit" disabled={!canDiscover}>
              <ShieldCheck size={11} aria-hidden="true" />
              {busyId === "discover-directory"
                ? copy.lab.trust.discoveringDirectory
                : copy.lab.trust.discoverDirectory}
            </button>
            <button
              type="button"
              disabled={!canSubscribe}
              onClick={() => void createDirectorySubscription()}
            >
              <Plus size={11} aria-hidden="true" />
              {busyId === "subscribe-directory"
                ? copy.lab.trust.subscribingDirectory
                : copy.lab.trust.subscribeDirectory}
            </button>
          </span>
        </form>
        {directorySubscriptions.length ? (
          <section
            className="receipt-directory-subscriptions"
            aria-labelledby="receipt-directory-subscriptions-title"
          >
            <header>
              <strong id="receipt-directory-subscriptions-title">
                {copy.lab.trust.directorySubscriptions}
              </strong>
              <button
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => void evaluateDirectoryQuorum()}
              >
                <ShieldCheck size={10} aria-hidden="true" />
                {busyId === "directory-quorum"
                  ? copy.lab.trust.evaluatingQuorum
                  : copy.lab.trust.evaluateQuorum}
              </button>
              <code>
                {directorySubscriptions.length.toString().padStart(2, "0")}
              </code>
            </header>
            <ol>
              {directorySubscriptions.map((subscription) => {
                const selected =
                  externalDirectorySubscriptionId === subscription.id;
                return (
                  <li
                    key={subscription.id}
                    className={`directory-subscription state-${subscription.status}`}
                  >
                    <span>
                      <strong>{subscription.label}</strong>
                      <small>
                        {
                          copy.lab.trust.subscriptionStatuses[
                            subscription.status
                          ]
                        }{" "}
                        {subscription.lastRefreshStatus
                          ? `· ${
                              copy.lab.trust.subscriptionRefreshStatuses[
                                subscription.lastRefreshStatus
                              ]
                            } `
                          : ""}
                        · {copy.lab.trust.nextRefresh}{" "}
                        {subscription.nextRefreshAt
                          .slice(0, 16)
                          .replace("T", " ")}
                      </small>
                    </span>
                    <code title={subscription.sourceUrlSha256}>
                      {subscription.sourceUrlSha256.slice(0, 12)}
                    </code>
                    {subscription.transparencyTailSha256 ? (
                      <code title={subscription.transparencyTailSha256}>
                        {copy.lab.trust.transparencyTail}{" "}
                        {subscription.transparencyTailSha256.slice(0, 8)}
                      </code>
                    ) : null}
                    <span className="receipt-directory-actions">
                      <button
                        type="button"
                        disabled={
                          Boolean(busyId) ||
                          selected ||
                          !subscription.lastGoodDiscovery?.directory
                        }
                        aria-pressed={selected}
                        onClick={() => activateSubscription(subscription)}
                      >
                        <ShieldCheck size={10} aria-hidden="true" />
                        {selected
                          ? copy.lab.trust.subscriptionInUse
                          : copy.lab.trust.useSubscription}
                      </button>
                      <button
                        type="button"
                        aria-label={copy.lab.trust.refreshSubscription}
                        disabled={Boolean(busyId)}
                        onClick={() =>
                          void refreshDirectorySubscription(subscription)
                        }
                      >
                        <RefreshCw size={10} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={
                          subscription.status === "active"
                            ? copy.lab.trust.pauseSubscription
                            : copy.lab.trust.resumeSubscription
                        }
                        disabled={Boolean(busyId)}
                        onClick={() =>
                          void toggleDirectorySubscription(subscription)
                        }
                      >
                        {subscription.status === "active" ? (
                          <Pause size={10} aria-hidden="true" />
                        ) : (
                          <Play size={10} aria-hidden="true" />
                        )}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
            {directoryQuorum ? (
              <output
                className={`receipt-directory-quorum quorum-${directoryQuorum.status}`}
                aria-live="polite"
              >
                <ShieldCheck size={11} aria-hidden="true" />
                <span>
                  <strong>
                    {copy.lab.trust.quorumStatuses[directoryQuorum.status]}
                  </strong>
                  <small>
                    {directoryQuorum.agreementCount}/
                    {directoryQuorum.sourceCount}{" "}
                    {copy.lab.trust.quorumAgreement} ·{" "}
                    {directoryQuorum.agreementWeight}{" "}
                    {copy.lab.trust.quorumWeight} ·{" "}
                    {directoryQuorum.agreementMetadataPublisherCount}{" "}
                    {copy.lab.trust.quorumPublishers}
                  </small>
                </span>
                {directoryQuorum.selectedAnchorSetSha256 ? (
                  <code title={directoryQuorum.selectedAnchorSetSha256}>
                    {directoryQuorum.selectedAnchorSetSha256.slice(0, 12)}
                  </code>
                ) : null}
                <code title={directoryQuorum.contentSha256}>
                  {directoryQuorum.contentSha256.slice(0, 12)}
                </code>
              </output>
            ) : null}
          </section>
        ) : null}
        <section
          className="receipt-baseline-workbench"
          aria-labelledby="receipt-baseline-workbench-title"
        >
          <header>
            <span>
              <strong id="receipt-baseline-workbench-title">
                {copy.lab.trust.baselineWorkbench}
              </strong>
              <small>{copy.lab.trust.baselineWorkbenchBody}</small>
            </span>
            <code>
              {baselineActivation.baselineCount.toString().padStart(2, "0")}
            </code>
          </header>
          {latestBaseline ? (
            <>
              <output className="receipt-baseline-latest" aria-live="polite">
                <ShieldCheck size={11} aria-hidden="true" />
                <span>
                  <strong>{copy.lab.trust.latestBaseline}</strong>
                  <small>
                    {baselineActivation.alignedSourceCount}/
                    {baselineActivation.selectedSourceOriginSha256s.length}{" "}
                    {copy.lab.trust.baselineSourcesAligned} ·{" "}
                    {baselineActivation.metadataPublisherSha256s.length}{" "}
                    {copy.lab.trust.quorumPublishers}
                  </small>
                </span>
                <code title={latestBaseline.contentSha256}>
                  {latestBaseline.contentSha256.slice(0, 12)}
                </code>
                <code title={latestBaseline.selectedDirectorySha256}>
                  {latestBaseline.selectedDirectorySha256.slice(0, 12)}
                </code>
              </output>
              <div className="receipt-baseline-actions">
                <button
                  type="button"
                  disabled={Boolean(busyId)}
                  onClick={() => void verifyLatestBaseline()}
                >
                  <ShieldCheck size={10} aria-hidden="true" />
                  {busyId === "verify-quorum-baseline"
                    ? copy.lab.trust.verifyingBaseline
                    : copy.lab.trust.verifyBaseline}
                </button>
                <label>
                  <Upload size={10} aria-hidden="true" />
                  <span>
                    {busyId === "import-quorum-baseline"
                      ? copy.lab.trust.importingBaseline
                      : copy.lab.trust.importBaseline}
                  </span>
                  <input
                    type="file"
                    accept="application/json,.json"
                    disabled={Boolean(busyId)}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      void importQuorumBaselineFile(file);
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={!canSignActivationDecision}
                  onClick={() => void signBaselineActivationDecision()}
                >
                  <ShieldCheck size={10} aria-hidden="true" />
                  {busyId === "sign-quorum-baseline-activation"
                    ? copy.lab.trust.signingBaselineActivation
                    : copy.lab.trust.signBaselineActivation}
                </button>
              </div>
              {baselineActivation.sourceProjections.length ? (
                <ol className="receipt-baseline-sources">
                  {baselineActivation.sourceProjections.map((source) => (
                    <li
                      key={source.sourceOriginSha256}
                      className={`baseline-source source-${source.status}`}
                    >
                      <span>
                        <strong>
                          {source.subscriptionLabel ??
                            copy.lab.trust.baselineUnknownSource}
                        </strong>
                        <small>
                          {copy.lab.trust.baselineSourceStatuses[source.status]}
                        </small>
                      </span>
                      <code title={source.sourceOriginSha256}>
                        {source.sourceOriginSha256.slice(0, 12)}
                      </code>
                      {source.currentDirectorySha256 ? (
                        <code title={source.currentDirectorySha256}>
                          {source.currentDirectorySha256.slice(0, 8)}
                        </code>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : null}
              {baselineVerification ? (
                <output
                  className={`receipt-verification verification-${baselineVerification.status}`}
                  aria-live="polite"
                >
                  {baselineVerification.status === "trusted" ? (
                    <Check size={11} aria-hidden="true" />
                  ) : (
                    <ShieldCheck size={11} aria-hidden="true" />
                  )}
                  <span>
                    <strong>
                      {
                        copy.lab.trust.baselineVerificationStatuses[
                          baselineVerification.status
                        ]
                      }
                    </strong>
                    <small>
                      {baselineVerification.diagnostics.length > 0
                        ? baselineVerification.diagnostics.join(", ")
                        : copy.lab.trust.noDiagnostics}
                    </small>
                  </span>
                  <code title={baselineVerification.contentSha256}>
                    {baselineVerification.contentSha256.slice(0, 12)}
                  </code>
                  {baselineVerification.keyId ? (
                    <code title={baselineVerification.keyId}>
                      {baselineVerification.keyId.slice(0, 12)}
                    </code>
                  ) : null}
                </output>
              ) : null}
              {baselineImportResult?.policyReview ? (
                <output
                  className={`receipt-baseline-policy policy-${baselineImportResult.policyReview.status}`}
                  aria-live="polite"
                >
                  <ShieldCheck size={11} aria-hidden="true" />
                  <span>
                    <strong>
                      {
                        copy.lab.trust.baselinePolicyStatuses[
                          baselineImportResult.policyReview.status
                        ]
                      }
                    </strong>
                    <small>
                      {baselineImportResult.policyReview.diagnostics.length > 0
                        ? baselineImportResult.policyReview.diagnostics.join(
                            ", ",
                          )
                        : copy.lab.trust.noDiagnostics}
                    </small>
                  </span>
                  <code title={baselineImportResult.policyReview.policySha256}>
                    {baselineImportResult.policyReview.policySha256.slice(
                      0,
                      12,
                    )}
                  </code>
                  <code title={baselineImportResult.policyReview.contentSha256}>
                    {baselineImportResult.policyReview.contentSha256.slice(
                      0,
                      12,
                    )}
                  </code>
                </output>
              ) : null}
              {baselineActivationDecision ? (
                <output
                  className={`receipt-baseline-policy policy-${baselineActivationDecision.envelope.receipt.decision}`}
                  aria-live="polite"
                >
                  <ShieldCheck size={11} aria-hidden="true" />
                  <span>
                    <strong>
                      {
                        copy.lab.trust.baselineActivationDecisionStatuses[
                          baselineActivationDecision.envelope.receipt.decision
                        ]
                      }
                    </strong>
                    <small>
                      {baselineActivationDecision.envelope.receipt.diagnostics
                        .length > 0
                        ? baselineActivationDecision.envelope.receipt.diagnostics.join(
                            ", ",
                          )
                        : copy.lab.trust.noDiagnostics}
                    </small>
                  </span>
                  <code
                    title={
                      baselineActivationDecision.envelope.receipt.contentSha256
                    }
                  >
                    {baselineActivationDecision.envelope.receipt.contentSha256.slice(
                      0,
                      12,
                    )}
                  </code>
                  <code
                    title={baselineActivationDecision.envelope.contentSha256}
                  >
                    {baselineActivationDecision.envelope.contentSha256.slice(
                      0,
                      12,
                    )}
                  </code>
                </output>
              ) : null}
            </>
          ) : (
            <>
              <p className="receipt-trust-empty">
                {copy.lab.trust.baselineWorkbenchEmpty}
              </p>
              <div className="receipt-baseline-actions">
                <label>
                  <Upload size={10} aria-hidden="true" />
                  <span>
                    {busyId === "import-quorum-baseline"
                      ? copy.lab.trust.importingBaseline
                      : copy.lab.trust.importBaseline}
                  </span>
                  <input
                    type="file"
                    accept="application/json,.json"
                    disabled={Boolean(busyId)}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      void importQuorumBaselineFile(file);
                    }}
                  />
                </label>
              </div>
            </>
          )}
          <form
            className="receipt-directory-discovery"
            onSubmit={(event) => {
              event.preventDefault();
              void discoverActivationSelectionTransparencyCheckpoint();
            }}
          >
            <label>
              <span>{copy.lab.trust.checkpointSubscriptionLabel}</span>
              <input
                type="text"
                maxLength={100}
                value={checkpointSubscriptionLabel}
                placeholder={
                  copy.lab.trust.checkpointSubscriptionLabelPlaceholder
                }
                onChange={(event) =>
                  setCheckpointSubscriptionLabel(event.target.value)
                }
              />
            </label>
            <label>
              <span>{copy.lab.trust.activationSelectionCheckpointSource}</span>
              <input
                type="url"
                maxLength={2048}
                spellCheck="false"
                value={checkpointSourceUrl}
                placeholder={
                  copy.lab.trust.activationSelectionCheckpointSourcePlaceholder
                }
                onChange={(event) => setCheckpointSourceUrl(event.target.value)}
              />
            </label>
            <label>
              <span>{copy.lab.trust.expectedActivationSelectionCheckpoint}</span>
              <input
                type="text"
                maxLength={64}
                spellCheck="false"
                value={expectedCheckpointSha256}
                placeholder={
                  copy.lab.trust.expectedActivationSelectionCheckpointPlaceholder
                }
                onChange={(event) =>
                  setExpectedCheckpointSha256(event.target.value)
                }
              />
            </label>
            <span className="receipt-directory-actions">
              <button
                type="submit"
                disabled={!canDiscoverActivationSelectionCheckpoint}
              >
                <ShieldCheck size={10} aria-hidden="true" />
                {busyId === "discover-activation-selection-checkpoint"
                  ? copy.lab.trust.discoveringActivationSelectionCheckpoint
                  : copy.lab.trust.discoverActivationSelectionCheckpoint}
              </button>
              <button
                type="button"
                disabled={!canSubscribeActivationSelectionCheckpoint}
                onClick={() => void createCheckpointSubscription()}
              >
                <Plus size={10} aria-hidden="true" />
                {busyId === "subscribe-activation-selection-checkpoint"
                  ? copy.lab.trust.subscribingActivationSelectionCheckpoint
                  : copy.lab.trust.subscribeActivationSelectionCheckpoint}
              </button>
            </span>
          </form>
          <div className="receipt-baseline-actions">
            <button
              type="button"
              disabled={!canApplyActivationSelection}
              onClick={() => void applyBaselineActivationSelection()}
            >
              <ShieldCheck size={10} aria-hidden="true" />
              {busyId === "apply-baseline-activation-selection"
                ? copy.lab.trust.applyingBaselineActivation
                : copy.lab.trust.applyBaselineActivation}
            </button>
            <button
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => void refreshActivationSelectionDriftAudit()}
            >
              <RefreshCw size={10} aria-hidden="true" />
              {busyId === "refresh-activation-selection-drift"
                ? copy.lab.trust.refreshingActivationSelectionDrift
                : copy.lab.trust.refreshActivationSelectionDrift}
            </button>
            <button
              type="button"
              disabled={!canReviewActivationSelectionRotation}
              onClick={() => void reviewActivationSelectionRotation()}
            >
              <ShieldCheck size={10} aria-hidden="true" />
              {busyId === "review-activation-selection-rotation"
                ? copy.lab.trust.reviewingActivationSelectionRotation
                : copy.lab.trust.reviewActivationSelectionRotation}
            </button>
            <button
              type="button"
              disabled={Boolean(busyId)}
              onClick={() =>
                void exportActivationSelectionTransparencyCheckpoint()
              }
            >
              <Download size={10} aria-hidden="true" />
              {busyId === "export-activation-selection-checkpoint"
                ? copy.lab.trust.exportingActivationSelectionCheckpoint
                : copy.lab.trust.exportActivationSelectionCheckpoint}
            </button>
            <button
              type="button"
              disabled={!canSignActivationSelectionCheckpoint}
              onClick={() =>
                void signActivationSelectionTransparencyCheckpoint()
              }
            >
              <ShieldCheck size={10} aria-hidden="true" />
              {busyId === "sign-activation-selection-checkpoint"
                ? copy.lab.trust.signingActivationSelectionCheckpoint
                : copy.lab.trust.signActivationSelectionCheckpoint}
            </button>
            <label>
              <Upload size={10} aria-hidden="true" />
              <span>
                {busyId === "verify-activation-selection-checkpoint"
                  ? copy.lab.trust.verifyingActivationSelectionCheckpoint
                  : copy.lab.trust.verifyActivationSelectionCheckpoint}
              </span>
              <input
                type="file"
                accept="application/json,.json"
                disabled={Boolean(busyId)}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  void verifyActivationSelectionTransparencyCheckpointFile(
                    file,
                  );
                }}
              />
            </label>
            <button
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => void exportBaselineActivationHistory()}
            >
              <Download size={10} aria-hidden="true" />
              {busyId === "export-baseline-activation-history"
                ? copy.lab.trust.exportingBaselineActivationHistory
                : copy.lab.trust.exportBaselineActivationHistory}
            </button>
            <label>
              <Upload size={10} aria-hidden="true" />
              <span>
                {busyId === "verify-baseline-activation-history"
                  ? copy.lab.trust.verifyingBaselineActivationHistory
                  : copy.lab.trust.verifyBaselineActivationHistory}
              </span>
              <input
                type="file"
                accept="application/json,.json"
                disabled={Boolean(busyId)}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  void verifyBaselineActivationHistoryFile(file);
                }}
              />
            </label>
          </div>
          {baselineActivationSelectionState?.selection ? (
            <output className="receipt-baseline-policy" aria-live="polite">
              <Check size={11} aria-hidden="true" />
              <span>
                <strong>{copy.lab.trust.activeBaselineActivation}</strong>
                <small>
                  {copy.lab.trust.activeBaselineActivationBody} ·{" "}
                  {
                    baselineActivationSelectionState.selection.selectedDirectory
                      .trustedCount
                  }{" "}
                  {copy.lab.trust.externalTrustedKeys}
                </small>
              </span>
              <code
                title={baselineActivationSelectionState.selection.contentSha256}
              >
                {baselineActivationSelectionState.selection.contentSha256.slice(
                  0,
                  12,
                )}
              </code>
              <code
                title={
                  baselineActivationSelectionState.selection
                    .selectedDirectorySha256
                }
              >
                {baselineActivationSelectionState.selection.selectedDirectorySha256.slice(
                  0,
                  12,
                )}
              </code>
            </output>
          ) : null}
          {baselineActivationSelectionCheckpoint ? (
            <output className="receipt-baseline-policy" aria-live="polite">
              <ShieldCheck size={11} aria-hidden="true" />
              <span>
                <strong>
                  {copy.lab.trust.activationSelectionCheckpoint}
                </strong>
                <small>
                  {baselineActivationSelectionCheckpoint.selectionCount}{" "}
                  {copy.lab.trust.activationSelectionCheckpointEntries} ·{" "}
                  {
                    copy.lab.trust.activationSelectionDriftStatuses[
                      baselineActivationSelectionCheckpoint.driftStatus
                    ]
                  }
                </small>
              </span>
              <code title={baselineActivationSelectionCheckpoint.contentSha256}>
                {baselineActivationSelectionCheckpoint.contentSha256.slice(
                  0,
                  12,
                )}
              </code>
              {baselineActivationSelectionCheckpoint.selectionChainTailSha256 ? (
                <code
                  title={
                    baselineActivationSelectionCheckpoint.selectionChainTailSha256
                  }
                >
                  {baselineActivationSelectionCheckpoint.selectionChainTailSha256.slice(
                    0,
                    12,
                  )}
                </code>
              ) : null}
              <code
                title={baselineActivationSelectionCheckpoint.selectionSetSha256}
              >
                {baselineActivationSelectionCheckpoint.selectionSetSha256.slice(
                  0,
                  12,
                )}
              </code>
            </output>
          ) : null}
          {baselineActivationSelectionCheckpointDiscovery ? (
            <output
              className={`receipt-baseline-policy policy-${
                baselineActivationSelectionCheckpointDiscovery.status ===
                "valid"
                  ? "approved"
                  : "rejected"
              }`}
              aria-live="polite"
            >
              {baselineActivationSelectionCheckpointDiscovery.status ===
              "valid" ? (
                <Check size={11} aria-hidden="true" />
              ) : (
                <ShieldCheck size={11} aria-hidden="true" />
              )}
              <span>
                <strong>
                  {
                    copy.lab.trust
                      .activationSelectionCheckpointDiscoveryStatuses[
                      baselineActivationSelectionCheckpointDiscovery.status
                    ]
                  }
                </strong>
                <small>
                  {baselineActivationSelectionCheckpointDiscovery.diagnostics
                    .length > 0
                    ? baselineActivationSelectionCheckpointDiscovery.diagnostics.join(
                        ", ",
                      )
                    : copy.lab.trust.hashOnlyRemoteSource}
                </small>
              </span>
              <code
                title={
                  baselineActivationSelectionCheckpointDiscovery.sourceUrlSha256
                }
              >
                {baselineActivationSelectionCheckpointDiscovery.sourceUrlSha256.slice(
                  0,
                  12,
                )}
              </code>
              <code
                title={
                  baselineActivationSelectionCheckpointDiscovery.responseBodySha256
                }
              >
                {baselineActivationSelectionCheckpointDiscovery.responseBodySha256.slice(
                  0,
                  12,
                )}
              </code>
              <code
                title={baselineActivationSelectionCheckpointDiscovery.policySha256}
              >
                {baselineActivationSelectionCheckpointDiscovery.policySha256.slice(
                  0,
                  12,
                )}
              </code>
              {baselineActivationSelectionCheckpointDiscovery.checkpointSha256 ? (
                <code
                  title={
                    baselineActivationSelectionCheckpointDiscovery.checkpointSha256
                  }
                >
                  {baselineActivationSelectionCheckpointDiscovery.checkpointSha256.slice(
                    0,
                    12,
                  )}
                </code>
              ) : null}
            </output>
          ) : null}
          {checkpointSubscriptions.length > 0 ? (
            <div className="receipt-subscriptions">
              <span>
                <strong>{copy.lab.trust.checkpointSubscriptions}</strong>
                <button
                  type="button"
                  disabled={Boolean(busyId)}
                  onClick={() => void evaluateCheckpointRegistryQuorum()}
                >
                  <ShieldCheck size={10} aria-hidden="true" />
                  {busyId === "evaluate-checkpoint-registry-quorum"
                    ? copy.lab.trust.evaluatingCheckpointRegistryQuorum
                    : copy.lab.trust.evaluateCheckpointRegistryQuorum}
                </button>
              </span>
              {checkpointSubscriptions.map((subscription) => (
                <article key={subscription.id}>
                  <span>
                    <strong>{subscription.label}</strong>
                    <small>
                      {
                        copy.lab.trust.subscriptionStatuses[
                          subscription.status
                        ]
                      }{" "}
                      · {subscription.lastRefreshStatus ?? "pending"} ·{" "}
                      {subscription.transparencyEntryCount}{" "}
                      {copy.lab.trust.transparencyTail}
                    </small>
                  </span>
                  <code title={subscription.sourceUrlSha256}>
                    {subscription.sourceUrlSha256.slice(0, 12)}
                  </code>
                  {subscription.lastGoodDiscovery?.checkpointSha256 ? (
                    <code
                      title={subscription.lastGoodDiscovery.checkpointSha256}
                    >
                      {subscription.lastGoodDiscovery.checkpointSha256.slice(
                        0,
                        12,
                      )}
                    </code>
                  ) : null}
                  <button
                    type="button"
                    disabled={Boolean(busyId)}
                    onClick={() => void refreshCheckpointSubscription(subscription)}
                  >
                    <RefreshCw size={10} aria-hidden="true" />
                    {busyId ===
                    `refresh-checkpoint-subscription:${subscription.id}`
                      ? copy.lab.trust.refreshingCheckpointSubscription
                      : copy.lab.trust.refreshCheckpointSubscription}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busyId)}
                    onClick={() => void toggleCheckpointSubscription(subscription)}
                  >
                    {subscription.status === "active" ? (
                      <Pause size={10} aria-hidden="true" />
                    ) : (
                      <Play size={10} aria-hidden="true" />
                    )}
                    {busyId ===
                    `toggle-checkpoint-subscription:${subscription.id}`
                      ? copy.lab.trust.updatingCheckpointSubscription
                      : subscription.status === "active"
                        ? copy.lab.trust.pauseSubscription
                        : copy.lab.trust.resumeSubscription}
                  </button>
                </article>
              ))}
            </div>
          ) : null}
          {checkpointRegistryQuorum ? (
            <output
              className={`receipt-baseline-policy policy-${
                checkpointRegistryQuorum.status === "agreed"
                  ? "approved"
                  : "rejected"
              }`}
              aria-live="polite"
            >
              {checkpointRegistryQuorum.status === "agreed" ? (
                <Check size={11} aria-hidden="true" />
              ) : (
                <ShieldCheck size={11} aria-hidden="true" />
              )}
              <span>
                <strong>
                  {
                    copy.lab.trust.checkpointRegistryQuorumStatuses[
                      checkpointRegistryQuorum.status
                    ]
                  }
                </strong>
                <small>
                  {checkpointRegistryQuorum.diagnostics.length > 0
                    ? checkpointRegistryQuorum.diagnostics.join(", ")
                    : `${checkpointRegistryQuorum.agreementCount} ${copy.lab.trust.quorumAgreement}`}
                </small>
              </span>
              <code title={checkpointRegistryQuorum.contentSha256}>
                {checkpointRegistryQuorum.contentSha256.slice(0, 12)}
              </code>
              <code title={checkpointRegistryQuorum.policySha256}>
                {checkpointRegistryQuorum.policySha256.slice(0, 12)}
              </code>
              {checkpointRegistryQuorum.selectedCheckpointSha256 ? (
                <code title={checkpointRegistryQuorum.selectedCheckpointSha256}>
                  {checkpointRegistryQuorum.selectedCheckpointSha256.slice(
                    0,
                    12,
                  )}
                </code>
              ) : null}
            </output>
          ) : null}
          {baselineActivationSelectionCheckpointEnvelope ? (
            <output className="receipt-baseline-policy" aria-live="polite">
              <ShieldCheck size={11} aria-hidden="true" />
              <span>
                <strong>
                  {copy.lab.trust.signedActivationSelectionCheckpoint}
                </strong>
                <small>
                  {
                    baselineActivationSelectionCheckpointEnvelope.receiptKind
                  }{" "}
                  ·{" "}
                  {
                    baselineActivationSelectionCheckpointEnvelope.signature
                      .keyId
                  }
                </small>
              </span>
              <code
                title={baselineActivationSelectionCheckpointEnvelope.contentSha256}
              >
                {baselineActivationSelectionCheckpointEnvelope.contentSha256.slice(
                  0,
                  12,
                )}
              </code>
              <code
                title={
                  baselineActivationSelectionCheckpointEnvelope.signature
                    .receiptArtifactSha256
                }
              >
                {baselineActivationSelectionCheckpointEnvelope.signature.receiptArtifactSha256.slice(
                  0,
                  12,
                )}
              </code>
            </output>
          ) : null}
          {baselineActivationSelectionCheckpointVerification ? (
            <output
              className={`receipt-baseline-policy policy-${
                baselineActivationSelectionCheckpointVerification.status ===
                "valid"
                  ? "approved"
                  : "rejected"
              }`}
              aria-live="polite"
            >
              {baselineActivationSelectionCheckpointVerification.status ===
              "valid" ? (
                <Check size={11} aria-hidden="true" />
              ) : (
                <ShieldCheck size={11} aria-hidden="true" />
              )}
              <span>
                <strong>
                  {
                    copy.lab.trust
                      .activationSelectionCheckpointVerificationStatuses[
                      baselineActivationSelectionCheckpointVerification.status
                    ]
                  }
                </strong>
                <small>
                  {baselineActivationSelectionCheckpointVerification.diagnostics
                    .length > 0
                    ? baselineActivationSelectionCheckpointVerification.diagnostics.join(
                        ", ",
                      )
                    : copy.lab.trust.noDiagnostics}
                </small>
              </span>
              <code
                title={
                  baselineActivationSelectionCheckpointVerification.contentSha256
                }
              >
                {baselineActivationSelectionCheckpointVerification.contentSha256.slice(
                  0,
                  12,
                )}
              </code>
              <code
                title={
                  baselineActivationSelectionCheckpointVerification.currentContentSha256
                }
              >
                {baselineActivationSelectionCheckpointVerification.currentContentSha256.slice(
                  0,
                  12,
                )}
              </code>
            </output>
          ) : null}
          {baselineActivationSelectionDriftAudit ? (
            <output
              className={`receipt-baseline-policy policy-${
                baselineActivationSelectionDriftAudit.status === "aligned"
                  ? "approved"
                  : "rejected"
              }`}
              aria-live="polite"
            >
              {baselineActivationSelectionDriftAudit.status === "aligned" ? (
                <Check size={11} aria-hidden="true" />
              ) : (
                <ShieldCheck size={11} aria-hidden="true" />
              )}
              <span>
                <strong>
                  {copy.lab.trust.activationSelectionDriftAudit}
                </strong>
                <small>
                  {
                    copy.lab.trust.activationSelectionDriftStatuses[
                      baselineActivationSelectionDriftAudit.status
                    ]
                  }{" "}
                  ·{" "}
                  {baselineActivationSelectionDriftAudit.diagnostics.length > 0
                    ? baselineActivationSelectionDriftAudit.diagnostics.join(
                        ", ",
                      )
                    : copy.lab.trust.noDiagnostics}
                </small>
              </span>
              <code
                title={baselineActivationSelectionDriftAudit.contentSha256}
              >
                {baselineActivationSelectionDriftAudit.contentSha256.slice(
                  0,
                  12,
                )}
              </code>
              <code
                title={baselineActivationSelectionDriftAudit.currentQuorumSha256}
              >
                {baselineActivationSelectionDriftAudit.currentQuorumSha256.slice(
                  0,
                  12,
                )}
              </code>
              {baselineActivationSelectionDriftAudit.currentDirectorySha256 ? (
                <code
                  title={
                    baselineActivationSelectionDriftAudit.currentDirectorySha256
                  }
                >
                  {baselineActivationSelectionDriftAudit.currentDirectorySha256.slice(
                    0,
                    12,
                  )}
                </code>
              ) : null}
            </output>
          ) : null}
          {baselineActivationRotationReview ? (
            <output
              className={`receipt-baseline-policy policy-${
                baselineActivationRotationReview.status === "eligible"
                  ? "approved"
                  : "rejected"
              }`}
              aria-live="polite"
            >
              {baselineActivationRotationReview.status === "eligible" ? (
                <Check size={11} aria-hidden="true" />
              ) : (
                <ShieldCheck size={11} aria-hidden="true" />
              )}
              <span>
                <strong>
                  {copy.lab.trust.activationSelectionRotationReview}
                </strong>
                <small>
                  {
                    copy.lab.trust.activationSelectionRotationStatuses[
                      baselineActivationRotationReview.status
                    ]
                  }{" "}
                  ·{" "}
                  {baselineActivationRotationReview.diagnostics.length > 0
                    ? baselineActivationRotationReview.diagnostics.join(", ")
                    : copy.lab.trust.noDiagnostics}
                </small>
              </span>
              <code title={baselineActivationRotationReview.contentSha256}>
                {baselineActivationRotationReview.contentSha256.slice(0, 12)}
              </code>
              <code
                title={baselineActivationRotationReview.driftAudit.contentSha256}
              >
                {baselineActivationRotationReview.driftAudit.contentSha256.slice(
                  0,
                  12,
                )}
              </code>
            </output>
          ) : null}
          {baselineActivationHistory ? (
            <output className="receipt-baseline-policy" aria-live="polite">
              <ShieldCheck size={11} aria-hidden="true" />
              <span>
                <strong>{copy.lab.trust.baselineActivationHistory}</strong>
                <small>
                  {baselineActivationHistory.approvedCount}/
                  {baselineActivationHistory.decisionCount}{" "}
                  {copy.lab.trust.baselineActivationHistoryApproved} ·{" "}
                  {baselineActivationHistory.distinctBaselineCount}{" "}
                  {copy.lab.trust.baselineActivationHistoryBaselines}
                </small>
              </span>
              <code title={baselineActivationHistory.decisionSetSha256}>
                {baselineActivationHistory.decisionSetSha256.slice(0, 12)}
              </code>
              {baselineActivationHistory.latestDecisionAt ? (
                <code title={baselineActivationHistory.latestDecisionAt}>
                  {baselineActivationHistory.latestDecisionAt
                    .slice(0, 16)
                    .replace("T", " ")}
                </code>
              ) : null}
            </output>
          ) : null}
          {baselineActivationHistoryVerification ? (
            <output
              className={`receipt-baseline-policy policy-${
                baselineActivationHistoryVerification.status === "valid"
                  ? "approved"
                  : "rejected"
              }`}
              aria-live="polite"
            >
              {baselineActivationHistoryVerification.status === "valid" ? (
                <Check size={11} aria-hidden="true" />
              ) : (
                <ShieldCheck size={11} aria-hidden="true" />
              )}
              <span>
                <strong>
                  {
                    copy.lab.trust
                      .baselineActivationHistoryVerificationStatuses[
                      baselineActivationHistoryVerification.status
                    ]
                  }
                </strong>
                <small>
                  {baselineActivationHistoryVerification.diagnostics.length > 0
                    ? baselineActivationHistoryVerification.diagnostics.join(
                        ", ",
                      )
                    : copy.lab.trust.noDiagnostics}
                </small>
              </span>
              <code title={baselineActivationHistoryVerification.contentSha256}>
                {baselineActivationHistoryVerification.contentSha256.slice(
                  0,
                  12,
                )}
              </code>
              <code
                title={
                  baselineActivationHistoryVerification.currentContentSha256
                }
              >
                {baselineActivationHistoryVerification.currentContentSha256.slice(
                  0,
                  12,
                )}
              </code>
            </output>
          ) : null}
        </section>
        {externalDirectory ? (
          <output className="receipt-directory-active" aria-live="polite">
            <ShieldCheck size={11} aria-hidden="true" />
            <span>
              <strong>{copy.lab.trust.externalDirectoryReady}</strong>
              <small>
                {externalDirectory.trustedCount}{" "}
                {copy.lab.trust.externalTrustedKeys}
              </small>
            </span>
            <code title={externalDirectory.anchorSetSha256}>
              {externalDirectory.anchorSetSha256.slice(0, 12)}
            </code>
            <button
              type="button"
              aria-label={copy.lab.trust.clearExternalDirectory}
              disabled={Boolean(busyId)}
              onClick={clearExternalDirectory}
            >
              <X size={10} aria-hidden="true" />
            </button>
          </output>
        ) : null}
        <label>
          <Upload size={11} aria-hidden="true" />
          <span>
            {busyId === "verify"
              ? copy.lab.trust.verifying
              : copy.lab.trust.chooseReceipt}
          </span>
          <input
            type="file"
            accept="application/json,.json"
            disabled={Boolean(busyId)}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void verifyFile(file);
            }}
          />
        </label>
        <button
          type="button"
          disabled={Boolean(busyId)}
          onClick={() => void exportDirectory()}
        >
          <Download size={11} aria-hidden="true" />
          {busyId === "directory"
            ? copy.lab.trust.exportingDirectory
            : copy.lab.trust.exportDirectory}
        </button>
        <button
          type="button"
          disabled={!canSignDirectoryMetadata}
          onClick={() => void signDirectoryMetadata()}
        >
          <ShieldCheck size={11} aria-hidden="true" />
          {busyId === "sign-directory-metadata"
            ? copy.lab.trust.signingDirectoryMetadata
            : copy.lab.trust.signDirectoryMetadata}
        </button>
        <label>
          <Upload size={11} aria-hidden="true" />
          <span>
            {busyId === "verify-directory"
              ? copy.lab.trust.verifyingDirectory
              : copy.lab.trust.chooseDirectory}
          </span>
          <input
            type="file"
            accept="application/json,.json"
            disabled={Boolean(busyId)}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void verifyDirectoryFile(file);
            }}
          />
        </label>
        <label>
          <Upload size={11} aria-hidden="true" />
          <span>
            {busyId === "verify-directory-metadata"
              ? copy.lab.trust.verifyingDirectoryMetadata
              : copy.lab.trust.verifyDirectoryMetadata}
          </span>
          <input
            type="file"
            accept="application/json,.json"
            disabled={Boolean(busyId)}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void verifyDirectoryMetadataFile(file);
            }}
          />
        </label>
        {directoryDiscovery ? (
          <output
            className={`receipt-verification verification-${directoryDiscovery.status}`}
            aria-live="polite"
          >
            {directoryDiscovery.status === "valid" ? (
              <Check size={11} aria-hidden="true" />
            ) : (
              <ShieldCheck size={11} aria-hidden="true" />
            )}
            <span>
              <strong>
                {
                  copy.lab.trust.directoryDiscoveryStatuses[
                    directoryDiscovery.status
                  ]
                }
              </strong>
              <small>{copy.lab.trust.hashOnlyRemoteSource}</small>
            </span>
            <code title={directoryDiscovery.sourceUrlSha256}>
              {directoryDiscovery.sourceUrlSha256.slice(0, 12)}
            </code>
            <code title={directoryDiscovery.responseBodySha256}>
              {directoryDiscovery.responseBodySha256.slice(0, 12)}
            </code>
          </output>
        ) : null}
        {verification ? (
          <output
            className={`receipt-verification verification-${verification.status}`}
            aria-live="polite"
          >
            {verification.status === "trusted" ? (
              <Check size={11} aria-hidden="true" />
            ) : (
              <ShieldCheck size={11} aria-hidden="true" />
            )}
            <span>
              <strong>
                {copy.lab.trust.verificationStatuses[verification.status]}
              </strong>
              <small>{verification.reason}</small>
            </span>
            {verification.keyId ? (
              <code title={verification.keyId}>
                {verification.keyId.slice(0, 16)}
              </code>
            ) : null}
            {verification.anchorDirectorySource ? (
              <code title={verification.anchorDirectorySource}>
                {
                  copy.lab.trust.verificationDirectorySources[
                    verification.anchorDirectorySource
                  ]
                }
              </code>
            ) : null}
            {verification.anchorDirectorySha256 ? (
              <code title={verification.anchorDirectorySha256}>
                {verification.anchorDirectorySha256.slice(0, 12)}
              </code>
            ) : null}
          </output>
        ) : null}
        {directoryVerification ? (
          <output
            className={`receipt-verification verification-${directoryVerification.status}`}
            aria-live="polite"
          >
            {directoryVerification.status === "valid" ? (
              <Check size={11} aria-hidden="true" />
            ) : (
              <ShieldCheck size={11} aria-hidden="true" />
            )}
            <span>
              <strong>
                {
                  copy.lab.trust.directoryVerificationStatuses[
                    directoryVerification.status
                  ]
                }
              </strong>
              <small>
                {directoryVerification.diagnostics.length > 0
                  ? directoryVerification.diagnostics.join(", ")
                  : copy.lab.trust.noDiagnostics}
              </small>
            </span>
            <code title={directoryVerification.contentSha256}>
              {directoryVerification.contentSha256.slice(0, 16)}
            </code>
            {directoryVerification.directoryAgeMs !== undefined ? (
              <code
                title={
                  copy.lab.trust.directoryAge +
                  ": " +
                  directoryVerification.directoryAgeMs.toString()
                }
              >
                {formatDirectoryAge(directoryVerification.directoryAgeMs)}
              </code>
            ) : null}
            {directoryVerification.policySha256 ? (
              <code title={directoryVerification.policySha256}>
                {copy.lab.trust.policyHash}{" "}
                {directoryVerification.policySha256.slice(0, 8)}
              </code>
            ) : null}
          </output>
        ) : null}
        {directoryMetadataVerification ? (
          <output
            className={`receipt-verification verification-${directoryMetadataVerification.status}`}
            aria-live="polite"
          >
            {directoryMetadataVerification.status === "trusted" ? (
              <Check size={11} aria-hidden="true" />
            ) : (
              <ShieldCheck size={11} aria-hidden="true" />
            )}
            <span>
              <strong>
                {
                  copy.lab.trust.directoryMetadataVerificationStatuses[
                    directoryMetadataVerification.status
                  ]
                }
              </strong>
              <small>
                {directoryMetadataVerification.diagnostics.length > 0
                  ? directoryMetadataVerification.diagnostics.join(", ")
                  : directoryMetadataVerification.publisher}
              </small>
            </span>
            {directoryMetadataVerification.signerKeyId ? (
              <code title={directoryMetadataVerification.signerKeyId}>
                {directoryMetadataVerification.signerKeyId.slice(0, 12)}
              </code>
            ) : null}
            {directoryMetadataVerification.anchorSetSha256 ? (
              <code title={directoryMetadataVerification.anchorSetSha256}>
                {directoryMetadataVerification.anchorSetSha256.slice(0, 12)}
              </code>
            ) : null}
          </output>
        ) : null}
      </section>

      {error ? (
        <p className="receipt-trust-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="receipt-trust-safety">
        <ShieldCheck size={11} aria-hidden="true" />
        {copy.lab.trust.safety}
      </p>
    </section>
  );
}

function toErrorMessage(error: unknown): string {
  return formatApiErrorMessage(error);
}

function formatDirectoryAge(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return seconds.toString() + "s";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes.toString() + "m";
  return Math.floor(minutes / 60).toString() + "h";
}

function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
