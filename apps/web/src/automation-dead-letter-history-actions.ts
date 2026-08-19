import type {
  InboundDeadLetterRetryHistory,
  InboundDeadLetterRetryHistoryVerification,
} from "@napier/contracts";

import {
  getInboundDeadLetterRetryHistory,
  verifyInboundDeadLetterRetryHistory,
} from "./automation-api";
import { automationCopy as copy } from "./automation-copy";
import {
  downloadDeadLetterRetryHistoryArtifact,
  MAX_DEAD_LETTER_EXPORT_FILE_BYTES,
  readAutomationJsonFile,
} from "./automation-panel-helpers";
import type { AutomationOperationController } from "./use-automation-operation";

export interface DeadLetterHistoryActionContext {
  operation: AutomationOperationController;
  histories: Record<string, InboundDeadLetterRetryHistory>;
  onHistory: (channelId: string, value: InboundDeadLetterRetryHistory) => void;
  onVerification: (
    channelId: string,
    value: InboundDeadLetterRetryHistoryVerification,
  ) => void;
  onVerificationCleared: (channelId: string) => void;
}

export async function verifyDeadLetterHistory(
  context: DeadLetterHistoryActionContext,
  channelId: string,
): Promise<void> {
  const result = await context.operation.run(
    `verify-retry-history:${channelId}`,
    async () => {
      const history =
        context.histories[channelId] ??
        (await getInboundDeadLetterRetryHistory(channelId));
      const verification = await verifyInboundDeadLetterRetryHistory(
        channelId,
        { history },
      );
      return { history, verification };
    },
  );
  if (result.ok && result.value) {
    context.onHistory(channelId, result.value.history);
    context.onVerification(channelId, result.value.verification);
  }
}

export async function downloadDeadLetterHistory(
  context: DeadLetterHistoryActionContext,
  channelId: string,
): Promise<void> {
  const result = await context.operation.run(
    `download-retry-history:${channelId}`,
    () => getInboundDeadLetterRetryHistory(channelId),
  );
  if (result.ok && result.value) {
    downloadDeadLetterRetryHistoryArtifact(result.value);
    context.onHistory(channelId, result.value);
    context.onVerificationCleared(channelId);
  }
}

export async function verifyDeadLetterHistoryFile(
  context: DeadLetterHistoryActionContext,
  channelId: string,
  file: File,
): Promise<void> {
  if (file.size > MAX_DEAD_LETTER_EXPORT_FILE_BYTES) {
    context.operation.setError(copy.deadLetterRetryHistoryArtifactTooLarge);
    return;
  }
  const result = await context.operation.run(
    `verify-retry-history:${channelId}`,
    async () => {
      const history = await readAutomationJsonFile(file);
      const [verification, currentHistory] = await Promise.all([
        verifyInboundDeadLetterRetryHistory(channelId, { history }),
        getInboundDeadLetterRetryHistory(channelId),
      ]);
      return { verification, currentHistory };
    },
  );
  if (result.ok && result.value) {
    context.onHistory(channelId, result.value.currentHistory);
    context.onVerification(channelId, result.value.verification);
  }
}
