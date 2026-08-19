import type {
  InboundDeadLetterExport,
  InboundDeadLetterExportVerification,
  InboundDeadLetterRetryApplyResult,
  InboundDeadLetterRetryHistory,
  InboundDeadLetterRetryPreview,
  InboundDelivery,
} from "@napier/contracts";

import {
  applyInboundDeadLetterRetry,
  exportInboundDeadLetters,
  getInboundDeadLetterRetryHistory,
  getInboundDeliveries,
  previewInboundDeadLetterRetry,
  verifyInboundDeadLetterExport,
} from "./automation-api";
import { automationCopy as copy } from "./automation-copy";
import {
  downloadDeadLetterArtifact,
  MAX_DEAD_LETTER_EXPORT_FILE_BYTES,
  readAutomationJsonFile,
} from "./automation-panel-helpers";
import type { AutomationOperationController } from "./use-automation-operation";

export interface DeadLetterArtifactActionContext {
  operation: AutomationOperationController;
  refresh: () => Promise<void>;
  artifacts: Record<string, unknown>;
  previews: Record<string, InboundDeadLetterRetryPreview>;
  onInspected: (
    channelId: string,
    artifact: unknown,
    verification: InboundDeadLetterExportVerification,
    preview: InboundDeadLetterRetryPreview,
  ) => void;
  onExported: (channelId: string, artifact: InboundDeadLetterExport) => void;
  onApplied: (
    channelId: string,
    result: InboundDeadLetterRetryApplyResult,
    preview: InboundDeadLetterRetryPreview,
  ) => void;
  onDeliveries: (channelId: string, value: InboundDelivery[]) => void;
  onHistory: (channelId: string, value: InboundDeadLetterRetryHistory) => void;
  onHistoryChanged: (channelId: string) => void;
}

export async function inspectDeadLetterArtifact(
  context: DeadLetterArtifactActionContext,
  channelId: string,
  artifact: unknown,
): Promise<void> {
  const [verification, preview] = await Promise.all([
    verifyInboundDeadLetterExport(channelId, { artifact }),
    previewInboundDeadLetterRetry(channelId, { artifact }),
  ]);
  context.onInspected(channelId, artifact, verification, preview);
}

export async function downloadDeadLetters(
  context: DeadLetterArtifactActionContext,
  channelId: string,
): Promise<void> {
  const result = await context.operation.run(
    `dead-letters:${channelId}`,
    async () => {
      const artifact = await exportInboundDeadLetters(channelId);
      downloadDeadLetterArtifact(artifact);
      await inspectDeadLetterArtifact(context, channelId, artifact);
      return artifact;
    },
  );
  if (result.ok && result.value) context.onExported(channelId, result.value);
}

export async function verifyDeadLetterFile(
  context: DeadLetterArtifactActionContext,
  channelId: string,
  file: File,
): Promise<void> {
  if (file.size > MAX_DEAD_LETTER_EXPORT_FILE_BYTES) {
    context.operation.setError(copy.deadLetterArtifactTooLarge);
    return;
  }
  await context.operation.run(`verify-dead-letters:${channelId}`, async () => {
    const artifact = await readAutomationJsonFile(file);
    await inspectDeadLetterArtifact(context, channelId, artifact);
  });
}

export async function applyDeadLetterRetry(
  context: DeadLetterArtifactActionContext,
  channelId: string,
): Promise<void> {
  const artifact = context.artifacts[channelId];
  const preview = context.previews[channelId];
  if (!artifact || !preview) {
    context.operation.setError(copy.deadLetterRetryPreviewMissing);
    return;
  }
  const result = await context.operation.run(
    `apply-dead-letters:${channelId}`,
    async () => {
      const applied = await applyInboundDeadLetterRetry(channelId, {
        artifact,
        expectedPreviewSha256: preview.contentSha256,
        confirmReplay: true,
      });
      const [nextPreview, deliveries, history] = await Promise.all([
        previewInboundDeadLetterRetry(channelId, { artifact }),
        getInboundDeliveries(channelId),
        getInboundDeadLetterRetryHistory(channelId),
      ]);
      await context.refresh();
      return { applied, nextPreview, deliveries, history };
    },
  );
  if (!result.ok || !result.value) return;
  context.onApplied(channelId, result.value.applied, result.value.nextPreview);
  context.onDeliveries(channelId, result.value.deliveries);
  context.onHistory(channelId, result.value.history);
  context.onHistoryChanged(channelId);
}
