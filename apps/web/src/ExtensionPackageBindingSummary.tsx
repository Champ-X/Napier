import { ShieldCheck } from "lucide-react";

import type {
  ExtensionPackageVerificationStatus,
  ExtensionRecord,
} from "@napier/contracts";

import { extensionCopy as copy } from "./extension-copy";

export interface ExtensionPackageBindingSummaryProps {
  extension: ExtensionRecord;
  status: ExtensionPackageVerificationStatus;
}

export function ExtensionPackageBindingSummary({
  extension,
  status,
}: ExtensionPackageBindingSummaryProps) {
  const binding = extension.packageBinding;
  if (!binding) return null;
  const { envelope } = binding;
  return (
    <>
      <div className="extension-package-binding">
        <ShieldCheck size={12} aria-hidden="true" />
        <dl>
          <div>
            <dt>{copy.packages.packageTrust}</dt>
            <dd>{copy.packages.verificationStatuses[status]}</dd>
          </div>
          <div>
            <dt>{copy.packages.publisher}</dt>
            <dd>{envelope.manifest.publisher}</dd>
          </div>
          <div>
            <dt>{copy.packages.packageRevision}</dt>
            <dd>{(extension.packageHistory?.length ?? 0) + 1}</dd>
          </div>
          <div>
            <dt>{copy.packages.packageHistory}</dt>
            <dd>{extension.packageHistory?.length ?? 0}</dd>
          </div>
          <div>
            <dt>{copy.packages.dependencies}</dt>
            <dd>{envelope.manifest.dependencies?.length ?? 0}</dd>
          </div>
          <HashFact
            label={copy.packages.publisherKey}
            value={envelope.signature.keyId}
          />
          <HashFact
            label={copy.packages.manifest}
            value={envelope.manifest.contentSha256}
          />
          {envelope.manifest.executable ? (
            <HashFact
              label={copy.packages.executable}
              value={envelope.manifest.executable.sha256}
            />
          ) : null}
        </dl>
      </div>
      {status !== "trusted" ? (
        <p className="extension-package-warning" role="status">
          <ShieldCheck size={11} aria-hidden="true" />
          {copy.packages.verificationStatuses[status]}
        </p>
      ) : null}
    </>
  );
}

export interface HashFactProps {
  label: string;
  value: string;
}

function HashFact({ label, value }: HashFactProps) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <code title={value}>{value.slice(0, 12)}</code>
      </dd>
    </div>
  );
}
