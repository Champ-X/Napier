import { contextCopy } from "./context-copy";
import { PackageReceiptHashRow } from "./PackageReceiptHashRow";
import type { PromptPackageReceipt } from "./package-management-types";
import "./package-receipts.css";

export interface PromptPackageReceiptCardProps {
  receipt: PromptPackageReceipt;
}

export function PromptPackageReceiptCard({
  receipt,
}: PromptPackageReceiptCardProps) {
  return (
    <article className={`package-receipt status-${receipt.status}`}>
      <header>
        <span>{contextCopy.promptPackageReceiptActions[receipt.action]}</span>
        <strong>{contextCopy.promptPackageStatuses[receipt.status]}</strong>
      </header>
      <p>{receipt.reason}</p>
      <dl>
        {receipt.manifestSha256 ? (
          <PackageReceiptHashRow
            label={contextCopy.promptPackageManifestHash}
            value={receipt.manifestSha256}
          />
        ) : null}
        {receipt.envelopeSha256 ? (
          <PackageReceiptHashRow
            label={contextCopy.promptPackageEnvelopeHash}
            value={receipt.envelopeSha256}
          />
        ) : null}
        {"systemPromptSha256" in receipt && receipt.systemPromptSha256 ? (
          <PackageReceiptHashRow
            label={contextCopy.promptDigest}
            value={receipt.systemPromptSha256}
          />
        ) : null}
        {"observedSystemPromptSha256" in receipt &&
        receipt.observedSystemPromptSha256 ? (
          <PackageReceiptHashRow
            label={contextCopy.promptPackageObservedPromptHash}
            value={receipt.observedSystemPromptSha256}
          />
        ) : null}
        {receipt.keyId ? (
          <PackageReceiptHashRow
            label={contextCopy.promptPackageKey}
            value={receipt.keyId}
          />
        ) : null}
        {"agentRevision" in receipt ? (
          <div>
            <dt>{contextCopy.promptPackageAgentRevision}</dt>
            <dd>{receipt.agentRevision}</dd>
          </div>
        ) : null}
        {"observedAgentRevision" in receipt &&
        receipt.observedAgentRevision !== undefined ? (
          <div>
            <dt>{contextCopy.promptPackageObservedRevision}</dt>
            <dd>{receipt.observedAgentRevision}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}
