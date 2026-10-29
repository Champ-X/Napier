import { ToolExecutionClaimError } from "./durable-tool-execution.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { ToolOperationJournalStore } from "./tool-operation-model.js";
import { assertToolOperationParentCallId } from "./tool-operation-ledger-support.js";

/** Provider call IDs are local to a child execution. Infrastructure receives a
 * stable owned ID; the original ID remains available for transcript correlation.
 * Existing unscoped child claims remain fenced when an old ledger is reopened. */
export function createSubagentToolCallScope(input: {
  store: ToolOperationJournalStore;
  runId: string;
  taskId: string;
  executionId?: string;
  inheritedProviderCallIds?: readonly string[];
}) {
  const { store, runId, taskId, executionId } = input;
  const inherited = new Set(input.inheritedProviderCallIds);
  let legacy: Promise<ReadonlySet<string>> | undefined;
  const legacyCalls = () => {
    legacy ??= store.listRunEvents(runId, 0, [
      "tool.admitted", "tool.started", "tool.completed", "tool.failed",
    ]).then((events) => new Set(events.flatMap((event) => {
      const value = event.payload;
      if (!value || typeof value !== "object" || Array.isArray(value) ||
          value["subagentTaskId"] !== taskId || value["subagentCallIdentityVersion"] === 1 ||
          typeof value["callId"] !== "string") return [];
      return [value["callId"]];
    }))).catch((error: unknown) => { legacy = undefined; throw error; });
    return legacy;
  };
  return async (providerCallId: string) => {
    assertToolOperationParentCallId(providerCallId);
    if (inherited.has(providerCallId)) {
      throw new ToolExecutionClaimError(providerCallId, "rejected",
        "Subagent tool call was inherited from a previous execution and cannot be replayed");
    }
    if ((await legacyCalls()).has(providerCallId)) {
      throw new ToolExecutionClaimError(providerCallId, "rejected",
        "Legacy subagent tool call already has durable execution evidence");
    }
    const identity = {
      kind: "napier.subagent-tool-call", schemaVersion: 1,
      runId, taskId, executionId: executionId ?? null, providerCallId,
    };
    return {
      callId: `subcall_${sha256(canonicalJson(identity))}`,
      providerCallId,
      subagentTaskId: taskId,
      ...(executionId ? { subagentExecutionId: executionId } : {}),
      subagentCallIdentityVersion: 1,
    };
  };
}

export type SubagentToolCallIdentity = Awaited<ReturnType<ReturnType<typeof createSubagentToolCallScope>>>;
