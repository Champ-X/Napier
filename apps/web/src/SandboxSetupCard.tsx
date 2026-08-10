import type { SandboxSetupPreview } from "@napier/contracts/sandbox-setup";
import { Box, Check, RefreshCw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { formatApiErrorMessage } from "./api-error";
import { applySandboxSetup, getSandboxSetupPreview } from "./sandbox-setup-api";
import {
  sandboxSetupCopy,
  sandboxSetupReady,
} from "./sandbox-setup-view-model";
import { SANDBOX_READY_EVENT } from "./use-agent-capability-projection";

export function SandboxSetupCard({
  onActivated,
}: {
  onActivated?: () => void | Promise<void>;
}) {
  const [preview, setPreview] = useState<SandboxSetupPreview>();
  const [busy, setBusy] = useState<"loading" | "applying" | undefined>(
    "loading",
  );
  const [error, setError] = useState<string>();

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
          <footer>
            <span className="sandbox-setup-boundary">
              {preview.status === "runtime_unavailable" ? (
                <ShieldAlert size={12} aria-hidden="true" />
              ) : (
                <Check size={12} aria-hidden="true" />
              )}
              Local daemon · no remote endpoint
            </span>
            {ready ? (
              <span className="provider-setup-ready" role="status">
                <Check size={13} aria-hidden="true" />
                Coding runtime ready
              </span>
            ) : (
              <button
                type="button"
                disabled={!copy.actionable || busy === "applying"}
                onClick={() => void apply()}
              >
                {busy === "applying" ? "Verifying toolchain…" : copy.action}
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

export default SandboxSetupCard;
