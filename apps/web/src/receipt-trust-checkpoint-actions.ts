import { copy } from "./copy";
import type { ReceiptTrustActionContext } from "./receipt-trust-action-context";
import {
  discoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  signReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
} from "./receipt-trust-api";
import {
  downloadReceiptTrustJson,
  MAX_TRUSTED_RECEIPT_FILE_BYTES,
  readReceiptTrustJson,
} from "./receipt-trust-helpers";

export async function exportActivationSelectionTransparencyCheckpoint(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const checkpoint = await context.operation.run(
    "export-activation-selection-checkpoint",
    getReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint,
  );
  if (!checkpoint) return;
  context.patch({ baselineActivationSelectionCheckpoint: checkpoint });
  downloadReceiptTrustJson(
    checkpoint,
    `napier-quorum-activation-selection-checkpoint-${checkpoint.contentSha256.slice(0, 12)}.json`,
  );
}

export async function verifyActivationSelectionTransparencyCheckpointFile(
  context: ReceiptTrustActionContext,
  file: File | undefined,
): Promise<void> {
  if (!file) return;
  context.patch({
    baselineActivationSelectionCheckpointVerification: undefined,
  });
  const verification = await context.operation.run(
    "verify-activation-selection-checkpoint",
    async () => {
      if (file.size > MAX_TRUSTED_RECEIPT_FILE_BYTES)
        throw new Error(copy.lab.trust.errors.tooLarge);
      return verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
        { checkpoint: await readReceiptTrustJson(file) },
      );
    },
  );
  if (verification)
    context.patch({
      baselineActivationSelectionCheckpointVerification: verification,
    });
}

export async function signActivationSelectionTransparencyCheckpoint(
  context: ReceiptTrustActionContext,
): Promise<void> {
  if (!context.projection.canSignActivationSelectionCheckpoint) return;
  context.patch({ baselineActivationSelectionCheckpointEnvelope: undefined });
  const envelope = await context.operation.run(
    "sign-activation-selection-checkpoint",
    () =>
      signReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
        {
          threadId: context.props.threadId,
          trustAnchorId: context.props.selectedAnchorId,
        },
      ),
  );
  if (!envelope) return;
  context.patch({
    baselineActivationSelectionCheckpoint: envelope.receipt,
    baselineActivationSelectionCheckpointEnvelope: envelope,
  });
  downloadReceiptTrustJson(
    envelope,
    `napier-signed-quorum-activation-selection-checkpoint-${envelope.contentSha256.slice(0, 12)}.json`,
  );
}

export async function discoverActivationSelectionTransparencyCheckpoint(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const request = context.projection.checkpointDiscoveryRequest;
  if (!request || !context.projection.canDiscoverActivationSelectionCheckpoint)
    return;
  context.patch({
    baselineActivationSelectionCheckpointDiscovery: undefined,
  });
  const discovery = await context.operation.run(
    "discover-activation-selection-checkpoint",
    () =>
      discoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint(
        request,
      ),
  );
  if (!discovery) return;
  context.patch({
    baselineActivationSelectionCheckpointDiscovery: discovery,
    baselineActivationSelectionCheckpointVerification:
      discovery.checkpointVerification,
    ...(discovery.envelope
      ? { baselineActivationSelectionCheckpointEnvelope: discovery.envelope }
      : {}),
    ...(discovery.status === "valid" && discovery.envelope?.receipt
      ? { baselineActivationSelectionCheckpoint: discovery.envelope.receipt }
      : {}),
  });
}
