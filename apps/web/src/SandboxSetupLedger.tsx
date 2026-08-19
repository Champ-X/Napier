import type { SandboxSetupPreview } from "@napier/contracts/sandbox-setup";

import { environmentSetupCopy } from "./environment-setup-copy";

export interface SandboxSetupLedgerProps {
  preview: SandboxSetupPreview;
  ready: boolean;
  statusTitle: string;
  statusDetail: string;
}

export function SandboxSetupLedger({
  preview,
  ready,
  statusTitle,
  statusDetail,
}: SandboxSetupLedgerProps) {
  const sandboxCopy = environmentSetupCopy.sandbox;
  return (
    <>
      <div className="sandbox-setup-ledger">
        <div>
          <span>{sandboxCopy.labels.status}</span>
          <strong>{ready ? sandboxCopy.active : statusTitle}</strong>
        </div>
        <div>
          <span>{sandboxCopy.labels.image}</span>
          <code>{preview.imageReference}</code>
        </div>
        <div>
          <span>{sandboxCopy.labels.source}</span>
          <strong>{sandboxAcquisitionLabel(preview.acquisition)}</strong>
        </div>
        {preview.releaseDigest ? (
          <div>
            <span>{sandboxCopy.labels.release}</span>
            <code>{preview.releaseDigest.slice(0, 19)}</code>
          </div>
        ) : null}
        <div>
          <span>{sandboxCopy.labels.toolchain}</span>
          <strong>{sandboxCopy.toolchain}</strong>
        </div>
        <div>
          <span>{sandboxCopy.labels.preview}</span>
          <code>{preview.contentSha256.slice(0, 12)}</code>
        </div>
      </div>
      <p className="sandbox-setup-detail">
        {ready ? sandboxCopy.readyDetail : statusDetail}
      </p>
    </>
  );
}

function sandboxAcquisitionLabel(
  acquisition: SandboxSetupPreview["acquisition"],
): string {
  const copy = environmentSetupCopy.sandbox.acquisitions;
  if (acquisition === "external_release") return copy.external_release;
  if (acquisition === "packaged_source") return copy.packaged_source;
  return copy.local_verified;
}
