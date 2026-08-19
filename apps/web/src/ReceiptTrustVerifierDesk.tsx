import { Download, ShieldCheck } from "lucide-react";

import { copy } from "./copy";
import { ReceiptTrustEvidence } from "./ReceiptTrustEvidence";
import { ReceiptTrustFileAction } from "./ReceiptTrustFileAction";
import { formatDirectoryAge } from "./receipt-trust-helpers";
import type { ReceiptTrustController } from "./use-receipt-trust-controller";

export interface ReceiptTrustVerifierDeskProps {
  controller: ReceiptTrustController;
}

export function ReceiptTrustVerifierDesk({
  controller,
}: ReceiptTrustVerifierDeskProps) {
  const { busyId, projection, state } = controller;
  return (
    <section className="receipt-trust-card receipt-trust-verifier-desk">
      <header>
        <span>
          <strong>{copy.lab.trust.verifier}</strong>
          <small>
            {state.externalDirectory
              ? copy.lab.trust.externalDirectoryActive
              : copy.lab.trust.verifierBody}
          </small>
        </span>
      </header>
      <div className="receipt-trust-action-grid">
        <ReceiptTrustFileAction
          disabled={Boolean(busyId)}
          label={
            busyId === "verify"
              ? copy.lab.trust.verifying
              : copy.lab.trust.chooseReceipt
          }
          onFile={(file) =>
            void controller.actions.anchor.verifyReceiptFile(file)
          }
        />
        <button
          type="button"
          disabled={Boolean(busyId)}
          onClick={() => void controller.actions.anchor.exportDirectory()}
        >
          <Download size={14} aria-hidden="true" />
          {busyId === "directory"
            ? copy.lab.trust.exportingDirectory
            : copy.lab.trust.exportDirectory}
        </button>
        <button
          type="button"
          disabled={!projection.canSignDirectoryMetadata}
          onClick={() => void controller.actions.anchor.signDirectoryMetadata()}
        >
          <ShieldCheck size={14} aria-hidden="true" />
          {busyId === "sign-directory-metadata"
            ? copy.lab.trust.signingDirectoryMetadata
            : copy.lab.trust.signDirectoryMetadata}
        </button>
        <ReceiptTrustFileAction
          disabled={Boolean(busyId)}
          label={
            busyId === "verify-directory"
              ? copy.lab.trust.verifyingDirectory
              : copy.lab.trust.chooseDirectory
          }
          onFile={(file) =>
            void controller.actions.anchor.verifyDirectoryFile(file)
          }
        />
        <ReceiptTrustFileAction
          disabled={Boolean(busyId)}
          label={
            busyId === "verify-directory-metadata"
              ? copy.lab.trust.verifyingDirectoryMetadata
              : copy.lab.trust.verifyDirectoryMetadata
          }
          onFile={(file) =>
            void controller.actions.anchor.verifyDirectoryMetadataFile(file)
          }
        />
      </div>
      <VerifierEvidence controller={controller} />
    </section>
  );
}

function VerifierEvidence({
  controller,
}: {
  controller: ReceiptTrustController;
}) {
  const { state } = controller;
  return (
    <div className="receipt-trust-evidence-grid">
      <ReceiptTrustEvidence
        title={copy.lab.trust.chooseReceipt}
        status={
          state.verification
            ? copy.lab.trust.verificationStatuses[state.verification.status]
            : undefined
        }
        facts={
          state.verification
            ? [
                state.verification.reason,
                ...(state.verification.anchorDirectorySource
                  ? [
                      copy.lab.trust.verificationDirectorySources[
                        state.verification.anchorDirectorySource
                      ],
                    ]
                  : []),
              ]
            : []
        }
        value={state.verification}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.chooseDirectory}
        status={
          state.directoryVerification
            ? copy.lab.trust.directoryVerificationStatuses[
                state.directoryVerification.status
              ]
            : undefined
        }
        facts={directoryFacts(controller)}
        value={state.directoryVerification}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.verifyDirectoryMetadata}
        status={
          state.directoryMetadataVerification
            ? copy.lab.trust.directoryMetadataVerificationStatuses[
                state.directoryMetadataVerification.status
              ]
            : undefined
        }
        facts={state.directoryMetadataVerification?.diagnostics ?? []}
        value={state.directoryMetadataVerification}
      />
    </div>
  );
}

function directoryFacts(controller: ReceiptTrustController): string[] {
  const verification = controller.state.directoryVerification;
  if (!verification) return [];
  return [
    ...(verification.diagnostics ?? []),
    ...(typeof verification.directoryAgeMs === "number"
      ? [
          `${copy.lab.trust.directoryAge} ${formatDirectoryAge(
            verification.directoryAgeMs,
          )}`,
        ]
      : []),
  ];
}
