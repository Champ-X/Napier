import { copy } from "./copy";
import type { ReceiptTrustActionContext } from "./receipt-trust-action-context";
import {
  applyReceiptTrustAnchorDirectoryQuorumActivationSelection,
  getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
  getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
} from "./receipt-trust-api";
import {
  downloadReceiptTrustJson,
  MAX_TRUSTED_RECEIPT_FILE_BYTES,
  readReceiptTrustJson,
} from "./receipt-trust-helpers";

export async function refreshActivationSelectionDriftAudit(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const audit = await context.operation.run(
    "refresh-activation-selection-drift",
    getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit,
  );
  if (audit) context.patch({ baselineActivationSelectionDriftAudit: audit });
}

export async function applyBaselineActivationSelection(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const record = context.projection.latestApprovedActivationRecord;
  if (!record || !context.projection.canApplyActivationSelection) return;
  const result = await context.operation.run(
    "apply-baseline-activation-selection",
    () =>
      applyReceiptTrustAnchorDirectoryQuorumActivationSelection({
        threadId: context.props.threadId,
        activationDecisionRecordId: record.id,
        expectedCurrentSelectionSha256:
          context.state.baselineActivationSelectionState
            ?.currentSelectionSha256 ?? "",
        ...(context.state.baselineActivationRotationProposalEnvelope
          ? {
              rotationProposalEnvelope:
                context.state.baselineActivationRotationProposalEnvelope,
            }
          : {}),
      }),
  );
  if (!result) return;
  context.patch({
    baselineActivationSelectionState: result.selectionState,
    baselineActivationRotationReview: undefined,
    baselineActivationRotationProposal: undefined,
    baselineActivationRotationProposalEnvelope: undefined,
    baselineActivationRotationProposalPreflight: undefined,
  });
  await refreshSelectionEvidence(context);
}

export async function exportBaselineActivationHistory(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const history = await context.operation.run(
    "export-baseline-activation-history",
    getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  );
  if (!history) return;
  context.patch({ baselineActivationHistory: history });
  downloadReceiptTrustJson(
    history,
    `napier-quorum-baseline-activation-history-${history.contentSha256.slice(0, 12)}.json`,
  );
}

export async function verifyBaselineActivationHistoryFile(
  context: ReceiptTrustActionContext,
  file: File | undefined,
): Promise<void> {
  if (!file) return;
  context.patch({ baselineActivationHistoryVerification: undefined });
  const verification = await context.operation.run(
    "verify-baseline-activation-history",
    async () => {
      if (file.size > MAX_TRUSTED_RECEIPT_FILE_BYTES)
        throw new Error(copy.lab.trust.errors.tooLarge);
      return verifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory({
        history: await readReceiptTrustJson(file),
      });
    },
  );
  if (verification)
    context.patch({ baselineActivationHistoryVerification: verification });
}

async function refreshSelectionEvidence(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const evidence = await context.operation.run(
    "refresh-activation-selection-evidence",
    async () => {
      const [driftAudit, checkpoint] = await Promise.all([
        getReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit(),
        getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(),
      ]);
      return { driftAudit, checkpoint };
    },
  );
  if (!evidence) return;
  context.patch({
    baselineActivationSelectionDriftAudit: evidence.driftAudit,
    baselineActivationSelectionCheckpoint: evidence.checkpoint,
  });
}
