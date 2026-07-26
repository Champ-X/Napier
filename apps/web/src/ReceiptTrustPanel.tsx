import { useState } from "react";
import {
  Ban,
  Check,
  KeyRound,
  Plus,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";

import type {
  CreateReceiptTrustAnchorSource,
  ReceiptTrustAnchor,
  TrustedReceiptVerification,
} from "@napier/contracts";

import { copy } from "./copy";
import {
  createReceiptTrustAnchor,
  revokeReceiptTrustAnchor,
  verifyTrustedReceipt,
} from "./receipt-trust-api";
import { formatApiErrorMessage } from "./api-error";

const MAX_TRUSTED_RECEIPT_FILE_BYTES = 10 * 1024 * 1024 + 64 * 1024;

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
  const [error, setError] = useState<string>();
  const canCreate =
    Boolean(label.trim()) &&
    (sourceType === "environment"
      ? /^[A-Z_][A-Z0-9_]{1,127}$/.test(environmentVariable.trim())
      : Boolean(publicKeySpki.trim())) &&
    !busyId;

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
      setVerification(await verifyTrustedReceipt(envelope));
    } catch (verifyError) {
      setError(toErrorMessage(verifyError));
    } finally {
      setBusyId(undefined);
    }
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
          <small>{copy.lab.trust.verifierBody}</small>
        </div>
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
