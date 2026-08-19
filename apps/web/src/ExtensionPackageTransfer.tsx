import type { ReactNode } from "react";
import { Check, Download, ShieldCheck, Upload } from "lucide-react";

import { extensionCopy as copy } from "./extension-copy";
import type { ExtensionPackageReceipt } from "./extension-package-types";

export interface ExtensionPackageTransferProps {
  busyId: string | undefined;
  signedPackageCount: number;
  receipt: ExtensionPackageReceipt | undefined;
  onVerify(file: File): Promise<void>;
  onImport(file: File): Promise<void>;
  onExportLockfile(): Promise<void>;
}

export function ExtensionPackageTransfer({
  busyId,
  signedPackageCount,
  receipt,
  onVerify,
  onImport,
  onExportLockfile,
}: ExtensionPackageTransferProps) {
  const packageCopy = copy.packages;
  return (
    <section className="extension-package-transfer">
      <header>
        <div>
          <strong>{packageCopy.transferTitle}</strong>
          <small>{packageCopy.transferBody}</small>
        </div>
      </header>
      <div>
        <PackageFileAction
          label={
            busyId === "package:verify"
              ? packageCopy.verifying
              : packageCopy.verify
          }
          disabled={Boolean(busyId)}
          icon={<Check size={11} aria-hidden="true" />}
          onFile={onVerify}
        />
        <PackageFileAction
          label={
            busyId === "package:import"
              ? packageCopy.importing
              : packageCopy.import
          }
          disabled={Boolean(busyId)}
          icon={<Upload size={11} aria-hidden="true" />}
          onFile={onImport}
        />
        <button
          type="button"
          disabled={Boolean(busyId) || signedPackageCount === 0}
          onClick={() => void onExportLockfile()}
        >
          <Download size={11} aria-hidden="true" />
          {busyId === "package:lockfile-export"
            ? packageCopy.exportingLockfile
            : packageCopy.exportLockfile}
        </button>
      </div>
      {receipt ? (
        <output
          className={`extension-package-receipt verification-${receipt.status}`}
          aria-live="polite"
        >
          <ShieldCheck size={12} aria-hidden="true" />
          <span>
            <strong>
              {packageCopy.actions[receipt.action]} ·{" "}
              {packageCopy.verificationStatuses[receipt.status]}
            </strong>
            <small>{receipt.reason}</small>
          </span>
          <span className="extension-package-receipt-hashes">
            {receipt.keyId ? (
              <code title={receipt.keyId}>
                {packageCopy.keyHash} {receipt.keyId.slice(0, 12)}
              </code>
            ) : null}
            {receipt.manifestSha256 ? (
              <code title={receipt.manifestSha256}>
                {packageCopy.manifestHash} {receipt.manifestSha256.slice(0, 12)}
              </code>
            ) : null}
            {receipt.envelopeSha256 ? (
              <code title={receipt.envelopeSha256}>
                {receipt.action.startsWith("channel_index")
                  ? packageCopy.indexEnvelopeHash
                  : receipt.action.startsWith("lockfile") ||
                      receipt.action.startsWith("rollout")
                    ? packageCopy.lockfileHash
                    : packageCopy.envelopeHash}{" "}
                {receipt.envelopeSha256.slice(0, 12)}
              </code>
            ) : null}
            {receipt.indexSha256 ? (
              <code title={receipt.indexSha256}>
                {packageCopy.indexHash} {receipt.indexSha256.slice(0, 12)}
              </code>
            ) : null}
            {receipt.channelCount !== undefined ? (
              <code>
                {receipt.channelCount} {packageCopy.channelCount}
              </code>
            ) : null}
          </span>
        </output>
      ) : null}
    </section>
  );
}

function PackageFileAction({
  label,
  disabled,
  icon,
  onFile,
}: {
  label: string;
  disabled: boolean;
  icon: ReactNode;
  onFile: (file: File) => Promise<void>;
}) {
  return (
    <label aria-disabled={disabled}>
      {icon}
      <span>{label}</span>
      <input
        type="file"
        accept="application/json,.json"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onFile(file);
        }}
      />
    </label>
  );
}
