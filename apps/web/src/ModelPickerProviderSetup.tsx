import type { LiveReadyBootstrapResponse } from "@napier/contracts/default-run-model";
import type {
  ProviderSetupCandidate,
  ProviderSetupPreview,
} from "@napier/contracts/provider-setup";
import { KeyRound, LoaderCircle, RefreshCw, Settings2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { formatApiErrorMessage } from "./api-error";
import { getBootstrap } from "./bootstrap-api";
import {
  applyProviderSetup,
  getProviderSetupPreview,
} from "./provider-setup-api";

export interface ModelPickerSetupConfig {
  threadId?: string;
  onBootstrapUpdated(bootstrap: LiveReadyBootstrapResponse): void;
  onOpenSettings?(): void;
}

export interface ModelPickerSetupLabels {
  setupChecking: string;
  setupCheckingBody: string;
  setupTitle: string;
  setupBody: string;
  setupMissingTitle: string;
  setupMissingBody: string;
  enable: string;
  enabling: string;
  retrySetup: string;
  openSettings: string;
}

export function ModelPickerProviderSetup({
  config,
  labels,
  onEnabled,
}: {
  config: ModelPickerSetupConfig;
  labels: ModelPickerSetupLabels;
  onEnabled(modelKey: string): void;
}) {
  const [preview, setPreview] = useState<ProviderSetupPreview>();
  const [loading, setLoading] = useState(true);
  const [busyProviderId, setBusyProviderId] = useState<string>();
  const [error, setError] = useState<string>();

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setPreview(await getProviderSetupPreview());
    } catch (loadError) {
      setError(formatApiErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview, config.threadId]);

  const enable = useCallback(
    async (candidate: ProviderSetupCandidate) => {
      if (!preview || busyProviderId) return;
      setBusyProviderId(candidate.providerId);
      setError(undefined);
      try {
        const result = await applyProviderSetup({
          providerId: candidate.providerId,
          expectedPreviewSha256: preview.contentSha256,
        });
        const bootstrap = await getBootstrap(config.threadId);
        config.onBootstrapUpdated(bootstrap);
        onEnabled(`${result.model.provider}/${result.model.id}`);
      } catch (enableError) {
        setError(formatApiErrorMessage(enableError));
        await getProviderSetupPreview()
          .then(setPreview)
          .catch(() => undefined);
      } finally {
        setBusyProviderId(undefined);
      }
    },
    [busyProviderId, config, onEnabled, preview],
  );

  const available =
    preview?.candidates.filter(
      (candidate) => candidate.status === "available",
    ) ?? [];
  if (preview?.readyCount) return null;

  return (
    <section
      className={`model-picker-setup${available.length === 0 ? " is-quiet" : ""}`}
      aria-label={labels.setupTitle}
      aria-live="polite"
    >
      <span className="model-picker-setup-mark" aria-hidden="true">
        {loading ? (
          <LoaderCircle className="model-picker-setup-spinner" size={15} />
        ) : (
          <KeyRound size={15} />
        )}
      </span>
      <span className="model-picker-setup-copy">
        <strong>
          {loading
            ? labels.setupChecking
            : available.length > 0
              ? labels.setupTitle
              : labels.setupMissingTitle}
        </strong>
        <small>
          {loading
            ? labels.setupCheckingBody
            : error
              ? error
              : available.length > 0
                ? labels.setupBody
                : labels.setupMissingBody}
        </small>
      </span>
      {!loading && available.length > 0 ? (
        <span className="model-picker-setup-actions">
          {available.map((candidate) => (
            <button
              type="button"
              key={candidate.providerId}
              aria-busy={busyProviderId === candidate.providerId}
              disabled={Boolean(busyProviderId)}
              onClick={() => void enable(candidate)}
            >
              {busyProviderId === candidate.providerId ? (
                <LoaderCircle
                  className="model-picker-setup-spinner"
                  size={13}
                  aria-hidden="true"
                />
              ) : null}
              {busyProviderId === candidate.providerId
                ? labels.enabling
                : `${labels.enable} ${candidate.providerName}`}
            </button>
          ))}
        </span>
      ) : null}
      {!loading && available.length === 0 ? (
        <span className="model-picker-setup-actions">
          {error ? (
            <button type="button" onClick={() => void loadPreview()}>
              <RefreshCw size={13} aria-hidden="true" />
              {labels.retrySetup}
            </button>
          ) : config.onOpenSettings ? (
            <button type="button" onClick={config.onOpenSettings}>
              <Settings2 size={13} aria-hidden="true" />
              {labels.openSettings}
            </button>
          ) : null}
        </span>
      ) : null}
    </section>
  );
}
