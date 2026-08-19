import type { InboundChannelAdapterPreview } from "@napier/contracts";

import { automationCopy as copy } from "./automation-copy";

export interface AutomationAdapterPreviewReceiptProps {
  preview: InboundChannelAdapterPreview | undefined;
}

export function AutomationAdapterPreviewReceipt({
  preview,
}: AutomationAdapterPreviewReceiptProps) {
  if (!preview) return null;
  return (
    <div className="channel-preview-receipt" role="status">
      <strong>{copy.previewReceipt}</strong>
      <p>
        {copy.fingerprint}: {preview.idempotencyFingerprint} ·{" "}
        <code title={preview.contentSha256}>
          {copy.previewReceiptHash} {preview.contentSha256.slice(0, 12)}
        </code>{" "}
        ·{" "}
        <code title={preview.messageSha256}>
          {copy.previewMessageHash} {preview.messageSha256.slice(0, 12)}
        </code>
      </p>
      <blockquote>{preview.messagePreview}</blockquote>
    </div>
  );
}
