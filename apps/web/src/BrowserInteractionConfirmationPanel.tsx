import type { BrowserInteractionConfirmation } from "@napier/contracts/browser-interaction-confirmation";
import { Check, MousePointerClick, X } from "lucide-react";

export function BrowserInteractionConfirmationPanel({
  confirmation,
  busy,
  onDecision,
}: {
  confirmation: BrowserInteractionConfirmation;
  busy: boolean;
  onDecision: (decision: "approve" | "reject") => Promise<void>;
}) {
  return (
    <section
      className="browser-interaction-confirmation"
      aria-labelledby={`browser-confirmation-${confirmation.id}`}
      aria-live="assertive"
      aria-busy={busy}
    >
      <header>
        <MousePointerClick size={17} aria-hidden="true" />
        <div>
          <span>BROWSER ACTION</span>
          <strong id={`browser-confirmation-${confirmation.id}`}>
            Confirm {confirmation.action}
          </strong>
        </div>
        <code title={confirmation.requestSha256}>
          {confirmation.requestSha256.slice(0, 12)}
        </code>
      </header>
      <p>
        This one action is paused before execution. Approval is bound to the
        exact validated arguments and cannot be reused.
      </p>
      <dl>
        <div>
          <dt>Action</dt>
          <dd>{confirmation.action}</dd>
        </div>
        <div>
          <dt>Arguments</dt>
          <dd title={confirmation.argumentsSha256}>
            {confirmation.argumentsSha256.slice(0, 12)}
          </dd>
        </div>
        {confirmation.preview.targetSha256 ? (
          <div>
            <dt>Target {confirmation.preview.targetKind}</dt>
            <dd title={confirmation.preview.targetSha256}>
              {confirmation.preview.targetSha256.slice(0, 12)}
            </dd>
          </div>
        ) : null}
        {confirmation.preview.textSha256 ? (
          <div>
            <dt>Text · {String(confirmation.preview.textBytes ?? 0)} bytes</dt>
            <dd title={confirmation.preview.textSha256}>
              {confirmation.preview.textSha256.slice(0, 12)}
            </dd>
          </div>
        ) : null}
        {confirmation.preview.valueSetSha256 ? (
          <div>
            <dt>Values · {String(confirmation.preview.valueCount ?? 0)}</dt>
            <dd title={confirmation.preview.valueSetSha256}>
              {confirmation.preview.valueSetSha256.slice(0, 12)}
            </dd>
          </div>
        ) : null}
        {confirmation.preview.pathSha256 ? (
          <div>
            <dt>Workspace path</dt>
            <dd title={confirmation.preview.pathSha256}>
              {confirmation.preview.pathSha256.slice(0, 12)}
            </dd>
          </div>
        ) : null}
        {confirmation.preview.fileSha256 ? (
          <div>
            <dt>File · {String(confirmation.preview.fileBytes ?? 0)} bytes</dt>
            <dd title={confirmation.preview.fileSha256}>
              {confirmation.preview.fileSha256.slice(0, 12)}
            </dd>
          </div>
        ) : null}
        {confirmation.preview.pageStateSha256 ? (
          <div>
            <dt>Page state</dt>
            <dd title={confirmation.preview.pageStateSha256}>
              {confirmation.preview.pageStateSha256.slice(0, 12)}
            </dd>
          </div>
        ) : null}
        {confirmation.preview.sourceImageSha256 ? (
          <div>
            <dt>Source image</dt>
            <dd title={confirmation.preview.sourceImageSha256}>
              {confirmation.preview.sourceImageSha256.slice(0, 12)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Expires</dt>
          <dd>{new Date(confirmation.expiresAt).toLocaleTimeString()}</dd>
        </div>
        <div>
          <dt>Cross-origin</dt>
          <dd>
            {confirmation.preview.crossOriginAuthorized ? "authorized" : "no"}
          </dd>
        </div>
      </dl>
      <footer>
        <button
          type="button"
          className="browser-confirmation-reject"
          disabled={busy}
          onClick={() => void onDecision("reject")}
        >
          <X size={12} aria-hidden="true" />
          Reject
        </button>
        <button
          type="button"
          className="browser-confirmation-approve"
          disabled={busy}
          onClick={() => void onDecision("approve")}
        >
          <Check size={12} aria-hidden="true" />
          Approve once
        </button>
      </footer>
    </section>
  );
}
