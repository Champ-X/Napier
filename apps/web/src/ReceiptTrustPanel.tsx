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
  ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification,
  ReceiptTrustAnchorDirectorySubscription,
  ReceiptTrustAnchorDirectoryVerification,
  ReceiptTrustAnchorDirectoryVerificationPolicy,
  ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult,
  TrustedReceiptVerification,
} from "@napier/contracts";

import { copy } from "./copy";
import {
  createReceiptTrustAnchor,
  createReceiptTrustAnchorDirectorySubscription,
  discoverReceiptTrustAnchorDirectory,
  evaluateReceiptTrustAnchorDirectoryQuorum,
  getSignedReceiptTrustAnchorDirectoryMetadata,
  getReceiptTrustAnchorDirectory,
  importReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  listReceiptTrustAnchorDirectoryQuorumPromotionBaselines,
  listReceiptTrustAnchorDirectorySubscriptions,
  refreshReceiptTrustAnchorDirectorySubscription,
  revokeReceiptTrustAnchor,
  updateReceiptTrustAnchorDirectorySubscription,
  verifyReceiptTrustAnchorDirectory,
  verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  verifyReceiptTrustAnchorDirectoryMetadata,
  verifyTrustedReceipt,
} from "./receipt-trust-api";
import { formatApiErrorMessage } from "./api-error";
import {
  qualifyReceiptTrustAnchorDirectoryDiscoveryRequest,
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
  const [expectedAnchorSetSha256, setExpectedAnchorSetSha256] = useState("");
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

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listReceiptTrustAnchorDirectorySubscriptions(),
      listReceiptTrustAnchorDirectoryQuorumPromotionBaselines(),
    ])
      .then(([subscriptions, baselines]) => {
        if (cancelled) return;
        setDirectorySubscriptions(subscriptions);
        setPromotionBaselines(baselines);
        const active = subscriptions
          .filter(
            (subscription) =>
              subscription.status === "active" &&
              Boolean(subscription.lastGoodDiscovery?.directory),
          )
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .at(0);
        if (active) activateSubscription(active);
      })
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

  async function importQuorumBaselineFile(file: File | undefined): Promise<void> {
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
      setBaselineVerification(result.verification);
      upsertPromotionBaseline(result.baseline);
    } catch (importError) {
      setError(toErrorMessage(importError));
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
            <code>{baselineActivation.baselineCount.toString().padStart(2, "0")}</code>
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
                          {
                            copy.lab.trust.baselineSourceStatuses[
                              source.status
                            ]
                          }
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
