import { contextCopy } from "./context-copy";
import { PackageReceiptHashRow } from "./PackageReceiptHashRow";
import type { SkillPackageReceipt } from "./package-management-types";
import "./package-receipts.css";

export interface SkillPackageReceiptCardProps {
  receipt: SkillPackageReceipt;
}

export function SkillPackageReceiptCard({
  receipt,
}: SkillPackageReceiptCardProps) {
  return (
    <article className={`package-receipt status-${receipt.status}`}>
      <header>
        <span>{contextCopy.skillPackageReceiptActions[receipt.action]}</span>
        <strong>{contextCopy.skillPackageStatuses[receipt.status]}</strong>
      </header>
      <p>{receipt.reason}</p>
      <dl>
        {receipt.manifestSha256 ? (
          <PackageReceiptHashRow
            label={contextCopy.skillPackageManifestHash}
            value={receipt.manifestSha256}
          />
        ) : null}
        {receipt.envelopeSha256 ? (
          <PackageReceiptHashRow
            label={contextCopy.skillPackageEnvelopeHash}
            value={receipt.envelopeSha256}
          />
        ) : null}
        {"skillCatalogSha256" in receipt && receipt.skillCatalogSha256 ? (
          <PackageReceiptHashRow
            label={contextCopy.skillPackageCatalogHash}
            value={receipt.skillCatalogSha256}
          />
        ) : null}
        {"observedSkillCatalogSha256" in receipt &&
        receipt.observedSkillCatalogSha256 ? (
          <PackageReceiptHashRow
            label={contextCopy.skillPackageObservedCatalogHash}
            value={receipt.observedSkillCatalogSha256}
          />
        ) : null}
        {receipt.keyId ? (
          <PackageReceiptHashRow
            label={contextCopy.skillPackageKey}
            value={receipt.keyId}
          />
        ) : null}
        <div>
          <dt>{contextCopy.skillPackageCount}</dt>
          <dd>{receipt.skillCount}</dd>
        </div>
        {"installationId" in receipt ? (
          <PackageReceiptHashRow
            label={contextCopy.skillPackageInstallation}
            value={receipt.installationId}
          />
        ) : null}
        {"replacedInstallationId" in receipt &&
        receipt.replacedInstallationId ? (
          <PackageReceiptHashRow
            label={contextCopy.skillPackageReplaced}
            value={receipt.replacedInstallationId}
          />
        ) : null}
      </dl>
    </article>
  );
}
