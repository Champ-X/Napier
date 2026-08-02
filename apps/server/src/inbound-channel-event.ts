import type { JsonValue } from "@napier/contracts";
import { createId, type LocalStore } from "@napier/runtime";

type InboundChannelEventStore = Pick<LocalStore, "appendEvent">;

export async function appendInboundChannelEvent(
  store: InboundChannelEventStore,
  threadId: string,
  type: string,
  payload: Record<string, JsonValue>,
): Promise<void> {
  await store.appendEvent({
    threadId,
    runId: createId("runctl"),
    type,
    category: "channel",
    visibility: "user",
    payload,
  });
}
