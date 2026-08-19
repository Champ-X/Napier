import { copy } from "./copy";
import { ReceiptTrustEvidence } from "./ReceiptTrustEvidence";
import type { ReceiptTrustController } from "./use-receipt-trust-controller";

export interface ReceiptTrustBaselineEvidenceProps {
  controller: ReceiptTrustController;
}

export function ReceiptTrustBaselineEvidence({
  controller,
}: ReceiptTrustBaselineEvidenceProps) {
  const { projection, state } = controller;
  const verification = state.baselineVerification;
  const decision = state.baselineActivationDecision?.envelope.receipt;
  return (
    <div className="receipt-trust-evidence-grid">
      <ReceiptTrustEvidence
        title={copy.lab.trust.latestBaseline}
        facts={
          projection.latestBaseline
            ? [
                `${projection.baselineActivation.alignedSourceCount}/${projection.baselineActivation.selectedSourceOriginSha256s.length} ${copy.lab.trust.baselineSourcesAligned}`,
                projection.latestBaseline.contentSha256.slice(0, 12),
              ]
            : []
        }
        value={projection.latestBaseline}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.verifyBaseline}
        status={
          verification
            ? copy.lab.trust.baselineVerificationStatuses[verification.status]
            : undefined
        }
        facts={verification?.diagnostics ?? []}
        value={verification}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.importBaseline}
        status={
          state.baselineImportResult?.policyReview
            ? copy.lab.trust.baselinePolicyStatuses[
                state.baselineImportResult.policyReview.status
              ]
            : undefined
        }
        facts={state.baselineImportResult?.policyReview?.diagnostics ?? []}
        value={state.baselineImportResult}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.signBaselineActivation}
        status={
          decision
            ? copy.lab.trust.baselineActivationDecisionStatuses[
                decision.decision
              ]
            : undefined
        }
        facts={decision?.diagnostics ?? []}
        value={state.baselineActivationDecision}
      />
      <SelectionEvidence controller={controller} />
      <RotationEvidence controller={controller} />
    </div>
  );
}

function SelectionEvidence({
  controller,
}: {
  controller: ReceiptTrustController;
}) {
  const { state } = controller;
  const selection = state.baselineActivationSelectionState?.selection;
  const audit = state.baselineActivationSelectionDriftAudit;
  const history = state.baselineActivationHistory;
  const historyVerification = state.baselineActivationHistoryVerification;
  return (
    <>
      <ReceiptTrustEvidence
        title={copy.lab.trust.activeBaselineActivation}
        facts={
          selection
            ? [
                copy.lab.trust.activeBaselineActivationBody,
                `${selection.selectedDirectory.trustedCount} ${copy.lab.trust.externalTrustedKeys}`,
              ]
            : []
        }
        value={state.baselineActivationSelectionState}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.activationSelectionDriftAudit}
        status={
          audit
            ? copy.lab.trust.activationSelectionDriftStatuses[audit.status]
            : undefined
        }
        facts={audit?.diagnostics ?? []}
        value={audit}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.baselineActivationHistory}
        facts={
          history
            ? [
                `${history.approvedCount}/${history.decisionCount} ${copy.lab.trust.baselineActivationHistoryApproved}`,
                `${history.distinctBaselineCount} ${copy.lab.trust.baselineActivationHistoryBaselines}`,
              ]
            : []
        }
        value={history}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.verifyBaselineActivationHistory}
        status={
          historyVerification
            ? copy.lab.trust.baselineActivationHistoryVerificationStatuses[
                historyVerification.status
              ]
            : undefined
        }
        facts={historyVerification?.diagnostics ?? []}
        value={historyVerification}
      />
    </>
  );
}

function RotationEvidence({
  controller,
}: {
  controller: ReceiptTrustController;
}) {
  const { state } = controller;
  const review = state.baselineActivationRotationReview;
  const proposal = state.baselineActivationRotationProposal;
  const preflight = state.baselineActivationRotationProposalPreflight;
  return (
    <>
      <ReceiptTrustEvidence
        title={copy.lab.trust.activationSelectionRotationReview}
        status={
          review
            ? copy.lab.trust.activationSelectionRotationStatuses[review.status]
            : undefined
        }
        facts={review?.diagnostics ?? []}
        value={review}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.activationSelectionRotationProposal}
        status={
          proposal
            ? copy.lab.trust.activationSelectionRotationProposalStatuses[
                proposal.status
              ]
            : undefined
        }
        facts={proposal?.diagnostics ?? []}
        value={proposal}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.signedActivationSelectionRotationProposal}
        value={state.baselineActivationRotationProposalEnvelope}
      />
      <ReceiptTrustEvidence
        title={copy.lab.trust.activationSelectionRotationProposalPreflight}
        status={
          preflight
            ? copy.lab.trust
                .activationSelectionRotationProposalPreflightStatuses[
                preflight.status
              ]
            : undefined
        }
        facts={preflight?.diagnostics ?? []}
        value={preflight}
      />
    </>
  );
}
