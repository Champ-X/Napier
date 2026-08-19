import { useEffect, useMemo } from "react";

import type {
  InboundChannel,
  InboundDeadLetterRetryHistory,
} from "@napier/contracts";

import { getInboundDeadLetterRetryHistory } from "./automation-api";

export function useDeadLetterHistoryPreload(
  channels: InboundChannel[],
  onHistory: (channelId: string, value: InboundDeadLetterRetryHistory) => void,
): void {
  const channelKey = useMemo(
    () =>
      channels
        .map((channel) => channel.id)
        .sort()
        .join(","),
    [channels],
  );
  useEffect(() => {
    if (!channelKey) return;
    let cancelled = false;
    void loadHistories(channelKey.split(","))
      .then((loaded) => {
        if (!cancelled) {
          for (const [channelId, history] of Object.entries(loaded)) {
            onHistory(channelId, history);
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [channelKey, onHistory]);
}

async function loadHistories(
  channelIds: string[],
): Promise<Record<string, InboundDeadLetterRetryHistory>> {
  const results = await Promise.all(
    channelIds.map(async (channelId) => ({
      channelId,
      history: await getInboundDeadLetterRetryHistory(channelId),
    })),
  );
  return Object.fromEntries(
    results.map(({ channelId, history }) => [channelId, history]),
  );
}
