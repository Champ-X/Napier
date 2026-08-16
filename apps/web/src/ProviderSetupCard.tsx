import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import type {
  ProviderSetupCandidate,
  ProviderSetupPreview,
} from "@napier/contracts/provider-setup";
import { Check, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { formatApiErrorMessage } from "./api-error";
import { getBootstrap } from "./bootstrap-api";
import {
  applyProviderSetup,
  getProviderSetupPreview,
} from "./provider-setup-api";
import {
  providerSetupEnableCandidate,
  providerSetupReadyCandidate,
  providerSetupStatusCopy,
} from "./provider-setup-view-model";

export function ProviderSetupCard({
  onBootstrapUpdated,
  threadId,
}: {
  onBootstrapUpdated: (bootstrap: LiveReadyBootstrapResponse) => void;
  threadId: string | undefined;
}) {
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
          <span>LIVE PROVIDER · EXPLICIT LOCATOR</span>
          <h3 id="provider-setup-title">
            {readyCandidate ? "Provider ready" : "Enable live reasoning"}
          </h3>
        </div>
        {busy === "loading" ? (
          <RefreshCw
            className="provider-setup-spinner"
            size={14}
            aria-label="Checking provider locators"
          />
        ) : null}
      </header>

      {preview ? (
        <>
          <p className="provider-setup-intro">
            Napier only registers the locator you approve. Secret values stay in
            the server environment and never appear here.
          </p>
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
              PREVIEW {preview.contentSha256.slice(0, 12)}
            </span>
            {readyCandidate ? (
              <span className="provider-setup-ready" role="status">
                <Check size={13} aria-hidden="true" />
                {readyCandidate.providerName} is available
              </span>
            ) : (
              <button
                type="button"
                disabled={!enableCandidate || busy === "applying"}
                onClick={() => void enable()}
              >
                {busy === "applying"
                  ? "Verifying locator…"
                  : enableCandidate
                    ? `Enable ${enableCandidate.providerName}`
                    : "No locator available"}
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
          Retry provider check
        </button>
      ) : (
        <p className="provider-setup-intro" role="status">
          Checking standard environment locators…
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

export default ProviderSetupCard;

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
