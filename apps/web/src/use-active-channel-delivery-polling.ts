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
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const results = await Promise.all(
          channelIds.map(async (channelId) => ({
            channelId,
            value: await getInboundDeliveries(channelId),
          })),
        );
        if (!cancelled) {
          for (const result of results)
            onDeliveries(result.channelId, result.value);
        }
      } catch {
        // The next interval or an explicit refresh can recover transient reads.
      }
    };
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeChannelKey, onDeliveries]);
}
