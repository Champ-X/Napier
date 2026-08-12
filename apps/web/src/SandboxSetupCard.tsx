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
import {
  sandboxSetupCopy,
  sandboxSetupReady,
} from "./sandbox-setup-view-model";
import { SANDBOX_READY_EVENT } from "./use-agent-capability-projection";

export function SandboxSetupCard({
  onActivated,
  reviewInvalidBinding = false,
}: {
  onActivated?: () => void | Promise<void>;
  reviewInvalidBinding?: boolean;
}) {
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
    const copy = sandboxSetupCopy(preview);
    if (!copy.actionable) return;
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

  const copy = preview ? sandboxSetupCopy(preview) : undefined;
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
          <span>PROCESS PLANE · PINNED OCI</span>
          <h3 id="sandbox-setup-title">
            {ready ? "Sandbox active" : "Enable coding runtime"}
          </h3>
        </div>
        {busy === "loading" ? (
          <RefreshCw
            className="provider-setup-spinner"
            size={14}
            aria-label="Checking Sandbox runtime"
          />
        ) : null}
      </header>

      {preview && copy ? (
        <>
          <div className="sandbox-setup-ledger">
            <div>
              <span>STATUS</span>
              <strong>{ready ? "ACTIVE" : copy.title}</strong>
            </div>
            <div>
              <span>IMAGE</span>
              <code>{preview.imageReference}</code>
            </div>
            <div>
              <span>SOURCE</span>
              <strong>{sandboxAcquisitionLabel(preview.acquisition)}</strong>
            </div>
            {preview.releaseDigest ? (
              <div>
                <span>RELEASE</span>
                <code>{preview.releaseDigest.slice(0, 19)}</code>
              </div>
            ) : null}
            <div>
              <span>TOOLCHAIN</span>
              <strong>NODE · PY · GIT · LSP · DAP</strong>
            </div>
            <div>
              <span>PREVIEW</span>
              <code>{preview.contentSha256.slice(0, 12)}</code>
            </div>
          </div>
          <p className="sandbox-setup-detail">
            {ready
              ? "The current Web Runtime now routes new process work through the verified immutable image."
              : copy.detail}
          </p>
          {removal ? (
            <div className="sandbox-uninstall-preview" role="status">
              <strong>Remove Napier binding?</strong>
              <span>
                Fallback · {removal.fallbackSandbox} · image retained locally
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
              Local daemon · no remote endpoint
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
                      Keep active
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void uninstall()}
                    >
                      {busy === "uninstalling"
                        ? "Removing binding…"
                        : "Remove binding"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setRemoval(undefined)}
                  >
                    {removal.status === "not_installed"
                      ? "No binding · close"
                      : "Cannot safely remove · close"}
                  </button>
                )}
              </div>
            ) : ready ? (
              <div className="sandbox-setup-actions">
                <span className="provider-setup-ready" role="status">
                  <Check size={13} aria-hidden="true" />
                  Coding runtime ready
                </span>
                <button
                  type="button"
                  className="secondary"
                  disabled={Boolean(busy)}
                  onClick={() => void reviewRemoval()}
                >
                  Review removal
                </button>
              </div>
            ) : (
              <div className="sandbox-setup-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={Boolean(busy)}
                  onClick={() => void reviewRemoval()}
                >
                  Review saved binding
                </button>
                <button
                  type="button"
                  disabled={!copy.actionable || busy === "applying"}
                  onClick={() => void apply()}
                >
                  {busy === "applying"
                    ? "Verifying · repairing drift if needed…"
                    : copy.action}
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
          Retry Sandbox check
        </button>
      ) : (
        <p className="sandbox-setup-detail" role="status">
          Inspecting the local Docker runtime and pinned image…
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

function sandboxAcquisitionLabel(
  acquisition: SandboxSetupPreview["acquisition"],
): string {
  if (acquisition === "external_release") return "SIGNED RELEASE";
  if (acquisition === "packaged_source") return "PINNED SOURCE";
  return "LOCAL VERIFIED";
}

export default SandboxSetupCard;
