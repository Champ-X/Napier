import type { ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription } from "@napier/contracts";

import { copy } from "./copy";
import type { ReceiptTrustActionContext } from "./receipt-trust-action-context";
import {
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  evaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
  importReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  promoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  refreshReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  updateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
} from "./receipt-trust-api";
import {
  downloadReceiptTrustJson,
  MAX_TRUSTED_RECEIPT_FILE_BYTES,
  readReceiptTrustJson,
} from "./receipt-trust-helpers";
import { upsertCheckpointSubscriptionState } from "./receipt-trust-state-actions";

export async function createCheckpointSubscription(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const request = context.projection.checkpointSubscriptionRequest;
  if (!request || !context.projection.canSubscribeActivationSelectionCheckpoint)
    return;
  const subscription = await context.operation.run(
    "subscribe-activation-selection-checkpoint",
    () =>
      createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
        request,
      ),
  );
  if (!subscription) return;
  context.update((current) => ({
    ...upsertCheckpointSubscriptionState(current, subscription),
    checkpointRegistryQuorum: undefined,
    baselineActivationSelectionCheckpointDiscovery:
      subscription.lastGoodDiscovery,
    ...(subscription.lastGoodDiscovery?.envelope
      ? {
          baselineActivationSelectionCheckpointEnvelope:
            subscription.lastGoodDiscovery.envelope,
          baselineActivationSelectionCheckpoint:
            subscription.lastGoodDiscovery.envelope.receipt,
        }
      : {}),
    checkpointSubscriptionLabel: "",
  }));
}

export async function refreshCheckpointSubscription(
  context: ReceiptTrustActionContext,
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
): Promise<void> {
  const result = await context.operation.run(
    `refresh-checkpoint-subscription:${subscription.id}`,
    () =>
      refreshReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
        subscription.id,
        subscription.auditThreadId,
        subscription.revision,
      ),
  );
  if (!result) return;
  context.update((current) => {
    const discovery = result.discovery;
    return {
      ...upsertCheckpointSubscriptionState(current, result.subscription),
      checkpointRegistryQuorum: undefined,
      ...(discovery
        ? {
            baselineActivationSelectionCheckpointDiscovery: discovery,
            baselineActivationSelectionCheckpointVerification:
              discovery.checkpointVerification,
            ...(discovery.envelope
              ? {
                  baselineActivationSelectionCheckpointEnvelope:
                    discovery.envelope,
                }
              : {}),
            ...(discovery.status === "valid" && discovery.envelope
              ? {
                  baselineActivationSelectionCheckpoint:
                    discovery.envelope.receipt,
                }
              : {}),
          }
        : {}),
    };
  });
}

export async function toggleCheckpointSubscription(
  context: ReceiptTrustActionContext,
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
): Promise<void> {
  const updated = await context.operation.run(
    `toggle-checkpoint-subscription:${subscription.id}`,
    () =>
      updateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription(
        subscription.id,
        {
          threadId: subscription.auditThreadId,
          expectedRevision: subscription.revision,
          status: subscription.status === "active" ? "paused" : "active",
        },
      ),
  );
  if (!updated) return;
  context.update((current) => ({
    ...upsertCheckpointSubscriptionState(current, updated),
    checkpointRegistryQuorum: undefined,
  }));
}

export async function evaluateCheckpointRegistryQuorum(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const quorum = await context.operation.run(
    "evaluate-checkpoint-registry-quorum",
    evaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
  );
  if (quorum) context.patch({ checkpointRegistryQuorum: quorum });
}

export async function promoteCheckpointRegistryQuorumBaseline(
  context: ReceiptTrustActionContext,
): Promise<void> {
  if (!context.projection.canPromoteCheckpointRegistryQuorum) return;
  context.patch({
    checkpointRegistryQuorumBaselineVerification: undefined,
    checkpointRegistryQuorumBaselineImportResult: undefined,
  });
  const result = await context.operation.run(
    "promote-checkpoint-registry-quorum-baseline",
    () =>
      promoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
        {
          threadId: context.props.threadId,
          trustAnchorId: context.props.selectedAnchorId,
        },
      ),
  );
  if (!result) return;
  context.patch({
    checkpointRegistryQuorumBaseline: result.baseline,
    checkpointRegistryQuorum: result.baseline.envelope.receipt,
  });
  downloadReceiptTrustJson(
    result.baseline,
    `napier-checkpoint-registry-quorum-baseline-${result.baseline.contentSha256.slice(0, 12)}.json`,
  );
}

export async function verifyCheckpointRegistryQuorumBaseline(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const baseline = context.state.checkpointRegistryQuorumBaseline;
  if (!baseline) return;
  context.patch({ checkpointRegistryQuorumBaselineVerification: undefined });
  const verification = await context.operation.run(
    "verify-checkpoint-registry-quorum-baseline",
    () =>
      verifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
        withTrustDirectory(context, { baseline }),
      ),
  );
  if (verification)
    context.patch({
      checkpointRegistryQuorumBaselineVerification: verification,
    });
}

export async function importCheckpointRegistryQuorumBaselineFile(
  context: ReceiptTrustActionContext,
  file: File | undefined,
): Promise<void> {
  if (!file) return;
  context.patch({
    checkpointRegistryQuorumBaselineImportResult: undefined,
    checkpointRegistryQuorumBaselineVerification: undefined,
  });
  const result = await context.operation.run(
    "import-checkpoint-registry-quorum-baseline",
    async () => {
      if (file.size > MAX_TRUSTED_RECEIPT_FILE_BYTES)
        throw new Error(copy.lab.trust.errors.tooLarge);
      return importReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
        withTrustDirectory(context, {
          baseline: await readReceiptTrustJson(file),
          threadId: context.props.threadId,
          expectedCurrentBaselineSha256:
            context.state.checkpointRegistryQuorumBaseline?.contentSha256 ?? "",
        }),
      );
    },
  );
  if (!result) return;
  context.patch({
    checkpointRegistryQuorumBaselineImportResult: result,
    checkpointRegistryQuorumBaselineVerification: result.verification,
    ...(result.imported ||
    !context.state.checkpointRegistryQuorumBaseline ||
    result.baseline.contentSha256 ===
      context.state.checkpointRegistryQuorumBaseline.contentSha256
      ? {
          checkpointRegistryQuorumBaseline: result.baseline,
          checkpointRegistryQuorum: result.baseline.envelope.receipt,
        }
      : {}),
  });
}

function withTrustDirectory<T extends object>(
  context: ReceiptTrustActionContext,
  input: T,
): T & Record<string, unknown> {
  const directory = context.state.externalDirectory;
  const policy = context.state.externalDirectoryPolicy;
  return {
    ...input,
    ...(directory
      ? {
          trustDirectory: directory,
          ...(policy ? { trustDirectoryPolicy: policy } : {}),
        }
      : {}),
  };
}
