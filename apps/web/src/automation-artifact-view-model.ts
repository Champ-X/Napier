import type {
  InboundDeadLetterExport,
  InboundDeadLetterRetryHistory,
} from "@napier/contracts";

export function deadLetterExportFilename(
  artifact: Pick<InboundDeadLetterExport, "channel" | "contentSha256">,
): string {
  const safeChannelId = safeFilenameSegment(artifact.channel.id, "channel");
  return `napier-dead-letters-${safeChannelId}-${artifact.contentSha256.slice(0, 12)}.json`;
}

export function deadLetterRetryHistoryFilename(
  history: Pick<InboundDeadLetterRetryHistory, "channelId" | "contentSha256">,
): string {
  const safeChannelId = safeFilenameSegment(history.channelId, "channel");
  return `napier-dead-letter-retry-history-${safeChannelId}-${history.contentSha256.slice(0, 12)}.json`;
}

function safeFilenameSegment(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized.length > 0 ? normalized : fallback;
}
