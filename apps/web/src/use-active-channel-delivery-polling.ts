import { useEffect, useMemo } from "react";

import type { InboundDelivery } from "@napier/contracts";

import { getInboundDeliveries } from "./automation-api";

export function useActiveChannelDeliveryPolling(
  deliveries: Record<string, InboundDelivery[]>,
  onDeliveries: (channelId: string, value: InboundDelivery[]) => void,
): void {
  const activeChannelKey = useMemo(
    () =>
      Object.entries(deliveries)
        .filter(([, items]) =>
          items.some((delivery) =>
            ["accepted", "running", "retrying"].includes(delivery.status),
          ),
        )
        .map(([channelId]) => channelId)
        .sort()
        .join(","),
    [deliveries],
  );
  useEffect(() => {
    if (!activeChannelKey) return;
    const channelIds = activeChannelKey.split(",");
    const controller = new AbortController();
    const stopPolling = channelIds.map((channelId) => {
      let timer: number;
      const refresh = async (): Promise<void> => {
        try {
          const value = await getInboundDeliveries(channelId, controller.signal);
          if (!controller.signal.aborted) onDeliveries(channelId, value);
        } catch {
          // Retry this channel without preventing other channels from updating.
        } finally {
          // Schedule after settling so a slow response cannot overlap a newer
          // request and overwrite it with stale delivery state.
          if (!controller.signal.aborted)
            timer = window.setTimeout(() => void refresh(), 2_000);
        }
      };
      timer = window.setTimeout(() => void refresh(), 2_000);
      return () => window.clearTimeout(timer);
    });
    return () => {
      controller.abort();
      for (const stop of stopPolling) stop();
    };
  }, [activeChannelKey, onDeliveries]);
}
