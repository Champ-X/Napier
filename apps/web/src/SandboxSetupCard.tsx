import type {
  SandboxSetupPreview,
  SandboxUninstallPreview,
} from "@napier/contracts/sandbox-setup";
import { Box, Check, RefreshCw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatApiErrorMessage } from "./api-error";
import {
  applySandboxSetup,
  applySandboxUninstall,
  getSandboxSetupPreview,
  getSandboxUninstallPreview,
} from "./sandbox-setup-api";
import { environmentSetupCopy } from "./environment-setup-copy";
import { SandboxSetupLedger } from "./SandboxSetupLedger";
import {
  sandboxSetupCopy,
  sandboxSetupReady,
} from "./sandbox-setup-view-model";
import "./sandbox-setup.css";
import { SANDBOX_READY_EVENT } from "./use-agent-capability-projection";

export interface SandboxSetupCardProps {
  onActivated?: () => void | Promise<void>;
  reviewInvalidBinding?: boolean;
}

export function SandboxSetupCard({
  onActivated,
  reviewInvalidBinding = false,
}: SandboxSetupCardProps) {
  const sandboxCopy = environmentSetupCopy.sandbox;
  const [preview, setPreview] = useState<SandboxSetupPreview>();
  const [busy, setBusy] = useState<
    "loading" | "applying" | "uninstalling" | undefined
  >("loading");
  const [removal, setRemoval] = useState<SandboxUninstallPreview>();
  const [error, setError] = useState<string>();
  const invalidReviewStarted = useRef(false);

  const loadPreview = useCallback(async () => {
    setBusy("loading");
    setError(undefined);
    try {
      setPreview(await getSandboxSetupPreview());
    } catch (loadError) {
      setError(formatApiErrorMessage(loadError));
    } finally {
      setBusy(undefined);
    }
  }, []);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const apply = useCallback(async () => {
    if (!preview) return;
    const statusCopy = sandboxSetupCopy(preview);
    if (!statusCopy.actionable) return;
    setBusy("applying");
    setError(undefined);
    try {
      await applySandboxSetup({
        expectedPreviewSha256: preview.contentSha256,
      });
      const refreshed = await getSandboxSetupPreview();
      setPreview(refreshed);
      window.dispatchEvent(new Event(SANDBOX_READY_EVENT));
      await onActivated?.();
    } catch (applyError) {
      setError(formatApiErrorMessage(applyError));
      await getSandboxSetupPreview()
        .then(setPreview)
        .catch(() => undefined);
    } finally {
      setBusy(undefined);
    }
  }, [onActivated, preview]);

  const reviewRemoval = useCallback(async () => {
    setBusy("loading");
    setError(undefined);
    try {
      setRemoval(await getSandboxUninstallPreview());
    } catch (reviewError) {
      setError(formatApiErrorMessage(reviewError));
    } finally {
      setBusy(undefined);
    }
  }, []);

  useEffect(() => {
    if (!reviewInvalidBinding) {
      invalidReviewStarted.current = false;
      return;
    }
    if (invalidReviewStarted.current) return;
    invalidReviewStarted.current = true;
    void reviewRemoval();
  }, [reviewInvalidBinding, reviewRemoval]);

  const uninstall = useCallback(async () => {
    if (!removal || removal.status === "not_installed") return;
    setBusy("uninstalling");
    setError(undefined);
    try {
      await applySandboxUninstall({
        expectedPreviewSha256: removal.contentSha256,
      });
      setRemoval(undefined);
      setPreview(await getSandboxSetupPreview());
      window.dispatchEvent(new Event(SANDBOX_READY_EVENT));
      await onActivated?.();
    } catch (uninstallError) {
      setError(formatApiErrorMessage(uninstallError));
      await getSandboxUninstallPreview()
        .then(setRemoval)
        .catch(() => undefined);
    } finally {
      setBusy(undefined);
    }
  }, [onActivated, removal]);

  const statusCopy = preview ? sandboxSetupCopy(preview) : undefined;
  const imageReady = sandboxSetupReady(preview);
  const ready = imageReady;

  return (
    <section
      className={`sandbox-setup-card state-${preview?.status ?? "loading"}${ready ? " is-ready" : ""}`}
      aria-labelledby="sandbox-setup-title"
    >
      <header>
        <div className="sandbox-setup-mark" aria-hidden="true">
          {ready ? <Check size={18} /> : <Box size={18} />}
        </div>
        <div>
          <span>{sandboxCopy.eyebrow}</span>
          <h3 id="sandbox-setup-title">
            {ready ? sandboxCopy.title.ready : sandboxCopy.title.pending}
          </h3>
        </div>
        {busy === "loading" ? (
          <RefreshCw
            className="sandbox-setup-spinner"
            size={14}
            aria-label={sandboxCopy.checkingAria}
          />
        ) : null}
      </header>

      {preview && statusCopy ? (
        <>
          <SandboxSetupLedger
            preview={preview}
            ready={ready}
            statusTitle={statusCopy.title}
            statusDetail={statusCopy.detail}
          />
          {removal ? (
            <div className="sandbox-uninstall-preview" role="status">
              <strong>{sandboxCopy.removalTitle}</strong>
              <span>
                {sandboxCopy.fallback} · {removal.fallbackSandbox} ·{" "}
                {sandboxCopy.imageRetained}
              </span>
              <code>{removal.contentSha256.slice(0, 12)}</code>
            </div>
          ) : null}
          <footer>
            <span className="sandbox-setup-boundary">
              {preview.status === "runtime_unavailable" ? (
                <ShieldAlert size={12} aria-hidden="true" />
              ) : (
                <Check size={12} aria-hidden="true" />
              )}
              {sandboxCopy.boundary}
            </span>
            {removal ? (
              <div className="sandbox-setup-actions">
                {removal.status !== "not_installed" && removal.bindingSha256 ? (
                  <>
                    <button
                      type="button"
                      className="secondary"
                      disabled={Boolean(busy)}
                      onClick={() => setRemoval(undefined)}
                    >
                      {sandboxCopy.keepActive}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      aria-busy={busy === "uninstalling"}
                      disabled={Boolean(busy)}
                      onClick={() => void uninstall()}
                    >
                      {busy === "uninstalling"
                        ? sandboxCopy.removing
                        : sandboxCopy.remove}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setRemoval(undefined)}
                  >
                    {removal.status === "not_installed"
                      ? sandboxCopy.noBindingClose
                      : sandboxCopy.cannotRemoveClose}
                  </button>
                )}
              </div>
            ) : ready ? (
              <div className="sandbox-setup-actions">
                <span className="provider-setup-ready" role="status">
                  <Check size={13} aria-hidden="true" />
                  {sandboxCopy.ready}
                </span>
                <button
                  type="button"
                  className="secondary"
                  aria-busy={busy === "loading"}
                  disabled={Boolean(busy)}
                  onClick={() => void reviewRemoval()}
                >
                  {sandboxCopy.reviewRemoval}
                </button>
              </div>
            ) : (
              <div className="sandbox-setup-actions">
                <button
                  type="button"
                  className="secondary"
                  aria-busy={busy === "loading"}
                  disabled={Boolean(busy)}
                  onClick={() => void reviewRemoval()}
                >
                  {sandboxCopy.reviewSavedBinding}
                </button>
                <button
                  type="button"
                  aria-busy={busy === "applying"}
                  disabled={!statusCopy.actionable || busy === "applying"}
                  onClick={() => void apply()}
                >
                  {busy === "applying"
                    ? sandboxCopy.applying
                    : statusCopy.action}
                </button>
              </div>
            )}
          </footer>
        </>
      ) : error ? (
        <button
          className="provider-setup-retry"
          type="button"
          onClick={() => void loadPreview()}
        >
          {sandboxCopy.retry}
        </button>
      ) : (
        <p className="sandbox-setup-detail" role="status">
          {sandboxCopy.checking}
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

export default SandboxSetupCard;
