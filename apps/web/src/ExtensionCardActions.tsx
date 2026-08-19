import { Cable, Check, X } from "lucide-react";

import type { ExtensionRecord } from "@napier/contracts";

import { extensionCopy as copy } from "./extension-copy";

export interface ExtensionCardActionsProps {
  extension: ExtensionRecord;
  enabled: boolean;
  approvedToolCount: number;
  packageTrusted: boolean;
  busy: boolean;
  onReview(extensionId: string, action: "approve" | "reject"): void;
  onConnect(extensionId: string): void;
  onDisconnect(extensionId: string): void;
  onToggle(extensionId: string, enabled: boolean): void;
}

export function ExtensionCardActions({
  extension,
  enabled,
  approvedToolCount,
  packageTrusted,
  busy,
  onReview,
  onConnect,
  onDisconnect,
  onToggle,
}: ExtensionCardActionsProps) {
  const approved = extension.trustStatus === "approved";
  const connected = extension.connection.status === "ready";
  return (
    <div className="extension-actions">
      {!approved ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onReview(extension.id, "approve")}
        >
          <Check size={11} aria-hidden="true" />
          {copy.approve}
        </button>
      ) : null}
      {extension.trustStatus === "pending" ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onReview(extension.id, "reject")}
        >
          <X size={11} aria-hidden="true" />
          {copy.reject}
        </button>
      ) : null}
      {approved && !connected && packageTrusted ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onConnect(extension.id)}
        >
          <Cable size={11} aria-hidden="true" />
          {copy.connect}
        </button>
      ) : null}
      {approved && connected ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onDisconnect(extension.id)}
        >
          {copy.disconnect}
        </button>
      ) : null}
      {approved && approvedToolCount > 0 && packageTrusted ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onToggle(extension.id, !enabled)}
        >
          {enabled ? copy.disable : copy.enable}
        </button>
      ) : null}
    </div>
  );
}
