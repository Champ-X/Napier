import type { ReceiptTrustAnchorDirectoryQuorumPromotionBaseline } from "@napier/contracts";

import { copy } from "./copy";
import type { ReceiptTrustActionContext } from "./receipt-trust-action-context";
import {
  evaluateReceiptTrustAnchorDirectoryQuorum,
  getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  importReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  signReceiptTrustAnchorDirectoryQuorumActivationDecision,
  verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
} from "./receipt-trust-api";
import {
  downloadReceiptTrustJson,
  MAX_TRUSTED_RECEIPT_FILE_BYTES,
  readReceiptTrustJson,
} from "./receipt-trust-helpers";
import { upsertPromotionBaselineState } from "./receipt-trust-state-actions";
import { buildReceiptTrustDirectoryBaselineImportPolicy } from "./receipt-trust-view-model";

export async function evaluateDirectoryQuorum(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const directoryQuorum = await context.operation.run(
    "directory-quorum",
    evaluateReceiptTrustAnchorDirectoryQuorum,
  );
  if (directoryQuorum) context.patch({ directoryQuorum });
}

export async function verifyLatestBaseline(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const baseline = context.projection.latestBaseline;
  if (!baseline) return;
  context.patch({ baselineVerification: undefined });
  const baselineVerification = await context.operation.run(
    "verify-quorum-baseline",
    () =>
      verifyReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
        withTrustDirectory(context, { baseline }),
      ),
  );
  if (baselineVerification) context.patch({ baselineVerification });
}

export async function importQuorumBaselineFile(
  context: ReceiptTrustActionContext,
  file: File | undefined,
): Promise<void> {
  if (!file) return;
  context.patch({
    baselineImportResult: undefined,
    baselineVerification: undefined,
  });
  const result = await context.operation.run(
    "import-quorum-baseline",
    async () => {
      if (file.size > MAX_TRUSTED_RECEIPT_FILE_BYTES)
        throw new Error(copy.lab.trust.errors.tooLarge);
      const baseline = (await readReceiptTrustJson(
        file,
      )) as ReceiptTrustAnchorDirectoryQuorumPromotionBaseline;
      return importReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
        withTrustDirectory(context, {
          baseline,
          threadId: context.props.threadId,
          expectedCurrentBaselineSha256:
            context.projection.latestBaseline?.contentSha256 ?? "",
          importPolicy: buildReceiptTrustDirectoryBaselineImportPolicy(
            baseline,
            context.state.directorySubscriptions,
            context.state.externalDirectory,
          ),
        }),
      );
    },
  );
  if (!result) return;
  context.update((current) => ({
    ...upsertPromotionBaselineState(current, result.baseline),
    baselineImportResult: result,
    baselineActivationDecision: undefined,
    baselineVerification: result.verification,
  }));
}

export async function signBaselineActivationDecision(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const baseline = context.projection.latestBaseline;
  if (!baseline || !context.projection.canSignActivationDecision) return;
  context.patch({
    baselineActivationDecision: undefined,
    baselineActivationHistoryVerification: undefined,
  });
  const result = await context.operation.run(
    "sign-quorum-baseline-activation",
    () =>
      signReceiptTrustAnchorDirectoryQuorumActivationDecision(
        withTrustDirectory(context, {
          threadId: context.props.threadId,
          trustAnchorId: context.props.selectedAnchorId,
          baselineId: baseline.id,
          importPolicy: buildReceiptTrustDirectoryBaselineImportPolicy(
            baseline,
            context.state.directorySubscriptions,
            context.state.externalDirectory,
          ),
        }),
      ),
  );
  if (!result) return;
  context.patch({
    baselineActivationDecision: result,
    baselineVerification: result.verification,
  });
  downloadReceiptTrustJson(
    result.envelope,
    `napier-quorum-baseline-activation-${result.envelope.receipt.contentSha256.slice(0, 12)}.json`,
  );
  await refreshBaselineActivationHistory(context);
}

export async function refreshBaselineActivationHistory(
  context: ReceiptTrustActionContext,
): Promise<void> {
  const baselineActivationHistory = await context.operation.run(
    "refresh-baseline-activation-history",
    getReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory,
  );
  if (baselineActivationHistory) context.patch({ baselineActivationHistory });
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
