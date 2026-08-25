import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import type {
  ProviderSetupCandidate,
  ProviderSetupPreview,
} from "@napier/contracts/provider-setup";
import { Check, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { formatApiErrorMessage } from "./api-error";
import { getBootstrap } from "./bootstrap-api";
import { environmentSetupCopy } from "./environment-setup-copy";
import {
  applyProviderSetup,
  getProviderSetupPreview,
} from "./provider-setup-api";
import {
  providerSetupEnableCandidate,
  providerSetupReadyCandidate,
  providerSetupStatusCopy,
} from "./provider-setup-view-model";
import "./provider-setup.css";

export interface ProviderSetupCardProps {
  onBootstrapUpdated(bootstrap: LiveReadyBootstrapResponse): void;
  threadId: string | undefined;
}

export function ProviderSetupCard({
  onBootstrapUpdated,
  threadId,
}: ProviderSetupCardProps) {
  const providerCopy = environmentSetupCopy.provider;
  const [preview, setPreview] = useState<ProviderSetupPreview>();
  const [busy, setBusy] = useState<"loading" | "applying" | undefined>(
    "loading",
  );
  const [error, setError] = useState<string>();

  const loadPreview = useCallback(async () => {
    setBusy("loading");
    setError(undefined);
    try {
      setPreview(await getProviderSetupPreview());
    } catch (loadError) {
      setError(formatApiErrorMessage(loadError));
    } finally {
      setBusy(undefined);
    }
  }, []);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const enableCandidate = preview
    ? providerSetupEnableCandidate(preview)
    : undefined;
  const readyCandidate = preview
    ? providerSetupReadyCandidate(preview)
    : undefined;

  const enable = useCallback(async () => {
    if (!preview || !enableCandidate) return;
    setBusy("applying");
    setError(undefined);
    try {
      await applyProviderSetup({
        providerId: enableCandidate.providerId,
        expectedPreviewSha256: preview.contentSha256,
      });
      const [refreshedPreview, bootstrap] = await Promise.all([
        getProviderSetupPreview(),
        getBootstrap(threadId),
      ]);
      setPreview(refreshedPreview);
      onBootstrapUpdated(bootstrap);
    } catch (applyError) {
      setError(formatApiErrorMessage(applyError));
      await getProviderSetupPreview()
        .then(setPreview)
        .catch(() => undefined);
    } finally {
      setBusy(undefined);
    }
  }, [enableCandidate, onBootstrapUpdated, preview, threadId]);

  return (
    <section
      className={`provider-setup-card ${readyCandidate ? "is-ready" : ""}`}
      aria-labelledby="provider-setup-title"
    >
      <header>
        <div className="provider-setup-mark" aria-hidden="true">
          {readyCandidate ? <ShieldCheck size={18} /> : <KeyRound size={18} />}
        </div>
        <div>
          <span>{providerCopy.eyebrow}</span>
          <h3 id="provider-setup-title">
            {readyCandidate
              ? providerCopy.title.ready
              : providerCopy.title.pending}
          </h3>
        </div>
        {busy === "loading" ? (
          <RefreshCw
            className="provider-setup-spinner"
            size={14}
            aria-label={providerCopy.checkingAria}
          />
        ) : null}
      </header>

      {preview ? (
        <>
          <p className="provider-setup-intro">{providerCopy.intro}</p>
          <div className="provider-setup-candidates">
            {preview.candidates.map((candidate) => (
              <ProviderCandidate
                candidate={candidate}
                key={candidate.providerId}
              />
            ))}
          </div>
          <footer>
            <span className="provider-setup-proof">
              {providerCopy.preview} {preview.contentSha256.slice(0, 12)}
            </span>
            {readyCandidate ? (
              <span className="provider-setup-ready" role="status">
                <Check size={13} aria-hidden="true" />
                {readyCandidate.providerName} {providerCopy.readySuffix}
              </span>
            ) : (
              <button
                type="button"
                aria-busy={busy === "applying"}
                disabled={!enableCandidate || busy === "applying"}
                onClick={() => void enable()}
              >
                {busy === "applying"
                  ? providerCopy.applying
                  : enableCandidate
                    ? `${providerCopy.enable} ${enableCandidate.providerName}`
                    : providerCopy.noLocator}
              </button>
            )}
          </footer>
        </>
      ) : error ? (
        <button
          className="provider-setup-retry"
          type="button"
          onClick={() => void loadPreview()}
        >
          {providerCopy.retry}
        </button>
      ) : (
        <p className="provider-setup-intro" role="status">
          {providerCopy.checking}
        </p>
      )}

      {error ? (
        <p className="provider-setup-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function ProviderCandidate({
  candidate,
}: {
  candidate: ProviderSetupCandidate;
}) {
  const status = providerSetupStatusCopy(candidate.status);
  return (
    <div
      className={`provider-setup-candidate status-${candidate.status}`}
      title={status.detail}
    >
      <span className="provider-setup-provider">
        <strong>{candidate.providerName}</strong>
        <code>{candidate.environmentVariable}</code>
      </span>
      <span>{status.label}</span>
    </div>
  );
}
