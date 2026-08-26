import type {
  JsonValue,
  RegisteredRunEventTypeForCategory,
} from "@napier/contracts";
import { createId } from "@napier/runtime/core";
import { type LocalStore } from "@napier/runtime/store";

type InboundChannelEventStore = Pick<LocalStore, "appendEvent">;

export async function appendInboundChannelEvent(
  store: InboundChannelEventStore,
  threadId: string,
  type: RegisteredRunEventTypeForCategory<"channel">,
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
