import type { BrowserInteractionConfirmation } from "@napier/contracts/browser-interaction-confirmation";
import { Check, MousePointerClick, X } from "lucide-react";

import { browserLiveCopy } from "./browser-live-copy";
import { getLocale } from "./locale";
import "./browser-interaction-confirmation.css";

export interface BrowserInteractionConfirmationPanelProps {
  confirmation: BrowserInteractionConfirmation;
  busy: boolean;
  onDecision: (decision: "approve" | "reject") => Promise<void>;
}

export function BrowserInteractionConfirmationPanel({
  confirmation,
  busy,
  onDecision,
}: BrowserInteractionConfirmationPanelProps) {
  const copy = browserLiveCopy.confirmation;
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
          <span>{copy.eyebrow}</span>
          <strong id={`browser-confirmation-${confirmation.id}`}>
            {copy.confirm} {copy.actions[confirmation.action]}
          </strong>
        </div>
        <code title={confirmation.requestSha256}>
          {confirmation.requestSha256.slice(0, 12)}
        </code>
      </header>
      <p>{copy.description}</p>
      <dl>
        <div>
          <dt>{copy.labels.action}</dt>
          <dd>{copy.actions[confirmation.action]}</dd>
        </div>
        {confirmation.preview.effect ? (
          <div>
            <dt>{copy.labels.effect}</dt>
            <dd>{copy.effects[confirmation.preview.effect]}</dd>
          </div>
        ) : null}
        <div>
          <dt>{copy.labels.arguments}</dt>
          <dd title={confirmation.argumentsSha256}>
            {confirmation.argumentsSha256.slice(0, 12)}
          </dd>
        </div>
        {confirmation.preview.targetSha256 ? (
          <div>
            <dt>
              {copy.labels.target} {confirmation.preview.targetKind}
            </dt>
            <dd title={confirmation.preview.targetSha256}>
              {confirmation.preview.targetSha256.slice(0, 12)}
            </dd>
          </div>
        ) : null}
        {confirmation.preview.textSha256 ? (
          <div>
            <dt>
              {copy.labels.text} · {String(confirmation.preview.textBytes ?? 0)}{" "}
              {copy.labels.bytes}
            </dt>
            <dd title={confirmation.preview.textSha256}>
              {confirmation.preview.textSha256.slice(0, 12)}
            </dd>
          </div>
        ) : null}
        {confirmation.preview.valueSetSha256 ? (
          <div>
            <dt>
              {copy.labels.values} ·{" "}
              {String(confirmation.preview.valueCount ?? 0)}
            </dt>
            <dd title={confirmation.preview.valueSetSha256}>
              {confirmation.preview.valueSetSha256.slice(0, 12)}
            </dd>
          </div>
        ) : null}
        {confirmation.preview.pathSha256 ? (
          <div>
            <dt>{copy.labels.workspacePath}</dt>
            <dd title={confirmation.preview.pathSha256}>
              {confirmation.preview.pathSha256.slice(0, 12)}
            </dd>
          </div>
        ) : null}
        {confirmation.preview.fileSha256 ? (
          <div>
            <dt>
              {copy.labels.file} · {String(confirmation.preview.fileBytes ?? 0)}{" "}
              {copy.labels.bytes}
            </dt>
            <dd title={confirmation.preview.fileSha256}>
              {confirmation.preview.fileSha256.slice(0, 12)}
            </dd>
          </div>
        ) : null}
        {confirmation.preview.pageStateSha256 ? (
          <div>
            <dt>{copy.labels.pageState}</dt>
            <dd title={confirmation.preview.pageStateSha256}>
              {confirmation.preview.pageStateSha256.slice(0, 12)}
            </dd>
          </div>
        ) : null}
        {confirmation.preview.sourceImageSha256 ? (
          <div>
            <dt>{copy.labels.sourceImage}</dt>
            <dd title={confirmation.preview.sourceImageSha256}>
              {confirmation.preview.sourceImageSha256.slice(0, 12)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{copy.labels.expires}</dt>
          <dd>
            {new Date(confirmation.expiresAt).toLocaleTimeString(
              getLocale() === "zh" ? "zh-CN" : "en",
            )}
          </dd>
        </div>
        <div>
          <dt>{copy.labels.crossOrigin}</dt>
          <dd>
            {confirmation.preview.crossOriginAuthorized
              ? copy.authorized
              : copy.unauthorized}
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
          {copy.reject}
        </button>
        <button
          type="button"
          className="browser-confirmation-approve"
          disabled={busy}
          onClick={() => void onDecision("approve")}
        >
          <Check size={12} aria-hidden="true" />
          {copy.approve}
        </button>
      </footer>
    </section>
  );
}
