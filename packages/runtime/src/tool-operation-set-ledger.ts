import type { JsonObject, JsonValue } from "@napier/contracts";

import { DurableToolOperationJournal } from "./tool-operation-durable-journal.js";
import type {
  ToolOperationJournalStore,
  ToolOperationOwner,
} from "./tool-operation-model.js";

export async function toolOperationSetLedgerProjection(
  store: ToolOperationJournalStore,
  owner: ToolOperationOwner,
  parentCallId: string,
): Promise<Record<string, JsonValue>> {
  const receipt = await new DurableToolOperationJournal(
    store,
    owner,
  ).operationSet(parentCallId);
  return receipt.operationCount > 0
    ? {
        operationSetSha256: receipt.operationSetSha256,
        toolOperationSet: receipt as unknown as JsonObject,
      }
    : {};
}
