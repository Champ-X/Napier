import { copy } from "./copy";
import { ReceiptTrustEvidence } from "./ReceiptTrustEvidence";
import type { ReceiptTrustController } from "./use-receipt-trust-controller";

export interface ReceiptTrustCheckpointEvidenceProps {
  controller: ReceiptTrustController;
}

export function ReceiptTrustCheckpointEvidence({
  controller,
}: ReceiptTrustCheckpointEvidenceProps) {
  const { state } = controller;
  const checkpoint = state.baselineActivationSelectionCheckpoint;
  const discovery = state.baselineActivationSelectionCheckpointDiscovery;
  const verification = state.baselineActivationSelectionCheckpointVerification;
  return (
    <div className="receipt-trust-evidence-grid">
      <ReceiptTrustEvidence
        title={copy.lab.trust.activationSelectionCheckpoint}
        status={
          checkpoint
            ? copy.lab.trust.activationSelectionDriftStatuses[
                checkpoint.driftStatus
              ]
            : undefined
        }
        facts={
          checkpoint
            ? [
                `${checkpoint.selectionCount} ${copy.lab.trust.activationSelectionCheckpointEntries}`,
                checkpoint.contentSha256.slice(0, 12),
              ]
            : []
        }
        value={checkpoint}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.discoverActivationSelectionCheckpoint}
        status={
          discovery
            ? copy.lab.trust.activationSelectionCheckpointDiscoveryStatuses[
                discovery.status
              ]
            : undefined
        }
        facts={discovery?.diagnostics ?? []}
        value={discovery}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.verifyActivationSelectionCheckpoint}
        status={
          verification
            ? copy.lab.trust.activationSelectionCheckpointVerificationStatuses[
                verification.status
              ]
            : undefined
        }
        facts={verification?.diagnostics ?? []}
        value={verification}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.signedActivationSelectionCheckpoint}
        value={state.baselineActivationSelectionCheckpointEnvelope}
      />
      <CheckpointRegistryEvidence controller={controller} />
    </div>
  );
}

function CheckpointRegistryEvidence({
  controller,
}: {
  controller: ReceiptTrustController;
}) {
  const { state } = controller;
  const quorum = state.checkpointRegistryQuorum;
  const verification = state.checkpointRegistryQuorumBaselineVerification;
  const importResult = state.checkpointRegistryQuorumBaselineImportResult;
  return (
    <>
      <ReceiptTrustEvidence
        title={copy.lab.trust.evaluateCheckpointRegistryQuorum}
        status={
          quorum
            ? copy.lab.trust.checkpointRegistryQuorumStatuses[quorum.status]
            : undefined
        }
        facts={
          quorum
            ? [
                `${quorum.agreementCount}/${quorum.sourceCount} ${copy.lab.trust.quorumAgreement}`,
              ]
            : []
        }
        value={quorum}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.checkpointRegistryQuorumBaseline}
        facts={
          state.checkpointRegistryQuorumBaseline
            ? [
                state.checkpointRegistryQuorumBaseline.contentSha256.slice(
                  0,
                  12,
                ),
              ]
            : []
        }
        value={state.checkpointRegistryQuorumBaseline}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.verifyCheckpointRegistryQuorumBaseline}
        status={
          verification
            ? copy.lab.trust.baselineVerificationStatuses[verification.status]
            : undefined
        }
        facts={verification?.diagnostics ?? []}
        value={verification}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.importCheckpointRegistryQuorumBaseline}
        status={
          importResult
            ? importResult.imported
              ? copy.lab.trust.checkpointRegistryQuorumBaselineImported
              : copy.lab.trust.checkpointRegistryQuorumBaselineAlreadyImported
            : undefined
        }
        value={importResult}
      />
    </>
  );
}
